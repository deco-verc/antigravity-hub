import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PolicyEngine } from '../src/policyEngine.js';

describe('PolicyEngine Security Matrix Suite', () => {
  test('should classify read-only or standard developer commands as GREEN', () => {
    const greenCommands = [
      'git status',
      'npm run build',
      'npm test',
      'node index.js',
      'ls -la'
    ];

    for (const cmd of greenCommands) {
      const evaluation = PolicyEngine.evaluateCommand(cmd);
      assert.strictEqual(evaluation.riskLevel, 'green', `Expected ${cmd} to be green`);
      assert.strictEqual(evaluation.requiresHumanApproval, false, `${cmd} should not require human approval`);
      assert.strictEqual(evaluation.isHardBlocked, false, `${cmd} should not be hard-blocked`);
    }
  });

  test('should classify low-impact changes or UI library additions as YELLOW', () => {
    const yellowCommands = [
      'npm install lucide-react',
      'npm i clsx tailwind-merge',
      'refactor endpoints for users'
    ];

    for (const cmd of yellowCommands) {
      const evaluation = PolicyEngine.evaluateCommand(cmd);
      assert.strictEqual(evaluation.riskLevel, 'yellow', `Expected ${cmd} to be yellow`);
      assert.strictEqual(evaluation.canSupervisorDecide, true, `${cmd} should be decidable by supervisor`);
      assert.strictEqual(evaluation.isHardBlocked, false);
    }
  });

  test('should classify destructive migrations and external billing services as ORANGE', () => {
    const orangeCommands = [
      'alter table users drop column age',
      'prisma migrate reset',
      'npm install openai'
    ];

    for (const cmd of orangeCommands) {
      const evaluation = PolicyEngine.evaluateCommand(cmd);
      assert.strictEqual(evaluation.riskLevel, 'orange', `Expected ${cmd} to be orange`);
      assert.strictEqual(evaluation.requiresHumanApproval, true, `${cmd} must require human approval`);
    }
  });

  test('should hard-block destructive red-line actions as RED', () => {
    const redCommands = [
      'rm -rf /var/data',
      'git push --force origin main',
      'drop database production',
      'cat credentials.json'
    ];

    for (const cmd of redCommands) {
      const evaluation = PolicyEngine.evaluateCommand(cmd);
      assert.strictEqual(evaluation.riskLevel, 'red', `Expected ${cmd} to be red`);
      assert.strictEqual(evaluation.requiresHumanApproval, true);
      assert.strictEqual(evaluation.isHardBlocked, true, `${cmd} must be hard-blocked`);
    }
  });
});
