import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { GitManager } from '../src/gitManager.js';

describe('GitManager Suite', () => {
  const currentRepoPath = path.resolve(__dirname, '../..');

  test('should detect current project as a valid git repository', () => {
    const gitInfo = GitManager.getGitInfo(currentRepoPath);
    assert.strictEqual(gitInfo.isGitRepo, true, 'Current project should be recognized as a Git repository');
    assert.strictEqual(typeof gitInfo.branch, 'string', 'Current branch should be a string');
    assert.ok(gitInfo.branch && gitInfo.branch.length > 0, 'Branch name must not be empty');
    assert.ok(gitInfo.lastCommit !== null, 'Last commit should be present after initial commit');
    assert.ok(typeof gitInfo.statusSummary.total === 'number', 'Status summary total must be numeric');
  });

  test('should correctly report non-git directory', () => {
    const tempEmptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-test-'));
    try {
      const gitInfo = GitManager.getGitInfo(tempEmptyDir);
      assert.strictEqual(gitInfo.isGitRepo, false, 'Temporary empty folder must not be a git repo');
      assert.strictEqual(gitInfo.branch, null);
      assert.strictEqual(gitInfo.lastCommit, null);
    } finally {
      fs.rmSync(tempEmptyDir, { recursive: true, force: true });
    }
  });

  test('should obtain unified diff structure without crashing', () => {
    const diffResult = GitManager.getUnifiedDiff(currentRepoPath);
    assert.ok(typeof diffResult.diff === 'string', 'diff should be a string');
    assert.ok(Array.isArray(diffResult.files), 'files should be an array');
    assert.ok(typeof diffResult.rawSummary === 'string', 'rawSummary should be a string');
  });
});
