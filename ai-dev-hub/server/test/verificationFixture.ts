import fs from 'node:fs';
import path from 'node:path';
import { IndependentEvaluator } from '../src/independentEvaluator.js';

/** An actual local assertion over executable code, replacing the old unconditional exit(0) fixtures. */
export function writeVerificationFixture(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'acceptance-feature.cjs'), 'exports.add=(a,b)=>{if(!Number.isFinite(a)||!Number.isFinite(b))throw new TypeError("invalid");return a+b;};');
  fs.writeFileSync(path.join(dir, 'acceptance-proof.cjs'), 'const assert=require("node:assert/strict");const {add}=require("./acceptance-feature.cjs");assert.equal(add(2,3),5);assert.equal(add(-1,1),0);assert.throws(()=>add(NaN,1),TypeError);');
  return 'node acceptance-proof.cjs';
}

export async function verifyFixtureTask(taskId:string,projectId:string,runId:string,dir:string) {
  const command=writeVerificationFixture(dir);
  const contract=IndependentEvaluator.createSuccessContract({taskId,projectId,runId,projectPath:dir,objective:'Soma verificada para fixture de aprovação',acceptanceCriteria:['Somar positivos e negativos e rejeitar valores inválidos'],verificationCommand:command});
  const result=await IndependentEvaluator.evaluate(contract.id,dir,{status:'success',filesChanged:['acceptance-feature.cjs'],implemented:['Soma e validação verificadas']});
  if(!result.taskIsDone)throw new Error('Independent fixture verification failed: '+result.actual);
}
