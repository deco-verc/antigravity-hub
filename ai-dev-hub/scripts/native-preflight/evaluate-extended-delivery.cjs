'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),sandbox='C:/IA/DecoHUB-native-sandbox-20261009';
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const artifact=path.join(root,'dist-desktop-'+version,'win-unpacked/resources/app.asar.unpacked/server/dist');
const output=path.join(sandbox,'logs/full-system-qa');
process.env.AI_DEV_HUB_DATA_DIR=fs.mkdtempSync(path.join(output,'independent-evaluator-'));
process.env.DECOHUB_OFFLINE_MODE='true';process.env.DECOHUB_ALLOW_LIVE_AGENTAPI='false';
const {IndependentEvaluator}=require(path.join(artifact,'independentEvaluator.js'));
const {db}=require(path.join(artifact,'db.js'));
async function main(){
  const project=path.join(sandbox,'project');
  const contract=IndependentEvaluator.createSuccessContract({taskId:'extended-http-adversarial',projectId:'isolated-independent-evaluation',projectPath:project,objective:'API HTTP deve rejeitar entradas malformadas sem exceção não tratada',acceptanceCriteria:['URL malformada não derruba a API','Corpo limitado a 16 KiB em Content-Length e streaming'],protectedEvaluationFiles:['test/calculator.test.cjs','test/calculator-regression.test.cjs'],verificationSteps:[{name:'HTTP adversarial ampliado',checkType:'command',command:'node "'+path.join(__dirname,'verify-http-extended.cjs')+'" "'+project+'"'}]});
  const evaluation=await IndependentEvaluator.evaluate(contract.id,project,{status:'success',filesChanged:['src/server.cjs','test/server.test.cjs'],implemented:['API entregue pelo Worker existente; não alterada pelo controlador']},{expectedScopeFiles:['src/','test/']});
  const result={version,artifact,isolatedDb:process.env.AI_DEV_HUB_DATA_DIR,evaluation,realAgentApiCalls:0,workerImplementationModified:false};
  fs.writeFileSync(path.join(output,'packaged-'+version+'-extended-http-evaluation.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({verdict:evaluation.verdict,taskIsDone:evaluation.taskIsDone,exitCode:evaluation.exitCode,realAgentApiCalls:0}));
  if(evaluation.verdict!=='FAIL'||evaluation.taskIsDone)throw Error('EXPECTED_KNOWN_HTTP_FAILURE_NOT_DETECTED');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.close());
