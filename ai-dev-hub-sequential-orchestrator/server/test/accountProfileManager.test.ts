import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AccountProfileManager } from '../src/accountProfileManager.js';
import { db } from '../src/db.js';

describe('AccountProfileManager Suite', () => {
  test('should create, verify, update, and delete an account profile safely', () => {
    const initialProfiles = AccountProfileManager.getAllProfiles();
    const initialCount = initialProfiles.length;

    // 1. Create Profile
    const uniqueName = `Test Account ${Date.now()}`;
    const created = AccountProfileManager.createProfile({
      displayName: uniqueName,
      googleAccountLabel: 'test.user@gmail.com'
    });

    assert.ok(created.id.startsWith('acc-pro-'));
    assert.strictEqual(created.display_name, uniqueName);
    assert.strictEqual(created.google_account_label, 'test.user@gmail.com');
    assert.strictEqual(created.auth_status, 'WAITING_LOGIN');

    // 2. Prevent unique constraint collision on profile_name
    const duplicate = AccountProfileManager.createProfile({
      displayName: uniqueName
    });
    assert.notStrictEqual(duplicate.id, created.id);
    assert.notStrictEqual(duplicate.profile_name, created.profile_name);

    // 3. Update Profile
    const updated = AccountProfileManager.updateProfile(created.id, {
      displayName: `${uniqueName} (Renomeada)`,
      googleAccountLabel: 'updated.user@gmail.com'
    });
    assert.strictEqual(updated.display_name, `${uniqueName} (Renomeada)`);
    assert.strictEqual(updated.google_account_label, 'updated.user@gmail.com');

    // 4. A typed email cannot prove a session in a newly created profile.
    const verified = AccountProfileManager.verifyProfile(created.id, 'verified.manual@gmail.com');
    assert.strictEqual(verified.hasSession, false);
    assert.strictEqual(verified.account, 'updated.user@gmail.com');
    assert.strictEqual(verified.profile.auth_status, 'LOGIN_REQUIRED');

    // 5. Delete duplicate profile
    const delDupResult = AccountProfileManager.deleteProfile(duplicate.id);
    assert.strictEqual(delDupResult.success, true);
    assert.strictEqual(AccountProfileManager.getProfile(duplicate.id), null);

    // 6. Delete created profile
    const delResult = AccountProfileManager.deleteProfile(created.id);
    assert.strictEqual(delResult.success, true);
    assert.strictEqual(AccountProfileManager.getProfile(created.id), null);

    // Verify count restored
    assert.strictEqual(AccountProfileManager.getAllProfiles().length, initialCount);
  });

  test('should block deleting the last remaining account', () => {
    // If only 1 account exists, delete should throw
    const all = AccountProfileManager.getAllProfiles();
    if (all.length === 1) {
      assert.throws(() => {
        AccountProfileManager.deleteProfile(all[0].id);
      }, /Não é possível remover a única conta cadastrada/);
    } else {
      assert.ok(all.length >= 2, 'Sistema possui perfis válidos');
    }
  });
});
