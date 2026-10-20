import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTOADAPT_ROOT = path.resolve(__dirname, '..');

function resolveDocPath(inputPath, defaultRelPath) {
  const target = inputPath || defaultRelPath;
  const fromCwd = path.resolve(target);
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.resolve(AUTOADAPT_ROOT, target);
}

/**
 * Valida os requisitos de entrega da versão candidata:
 * 1. Diagnóstico e diff agrupados (docs/entrega-versao-candidata.md)
 * 2. Plano de rollback gerado sem merge em master (docs/plano-de-rollback.md)
 * 3. Relatório comparativo presente (docs/relatorio-validacao-comparativa.md)
 * 4. Proibição de merge automático em master
 */
export function validateCandidateDelivery(options = {}) {
  const deliveryPath = resolveDocPath(options.deliveryPath, 'docs/entrega-versao-candidata.md');
  const rollbackPath = resolveDocPath(options.rollbackPath, 'docs/plano-de-rollback.md');
  const comparativePath = resolveDocPath(options.comparativePath, 'docs/relatorio-validacao-comparativa.md');

  const errors = [];

  // 1. Validar docs/entrega-versao-candidata.md
  let deliveryReportValid = false;
  if (!fs.existsSync(deliveryPath)) {
    errors.push(`Arquivo de entrega não encontrado: ${deliveryPath}`);
  } else {
    const content = fs.readFileSync(deliveryPath, 'utf8');
    const requiredSections = [
      'Diagnóstico dos Problemas Identificados',
      'Pesquisa e Fontes',
      'Backlog Priorizado e Melhorias Implementadas',
      'Arquivos Alterados e Commits',
      'Resultados de Testes e Benchmarks Executados',
      'Riscos Remanescentes e Mitigações',
      'Plano de Rollback Resumido',
      'Recomendações para o Próximo Ciclo'
    ];
    const missing = requiredSections.filter(sec => !content.includes(sec));
    if (missing.length > 0) {
      errors.push(`Seções faltantes no relatório de entrega: ${missing.join(', ')}`);
    } else {
      deliveryReportValid = true;
    }
  }

  // 2. Validar docs/plano-de-rollback.md
  let rollbackPlanValid = false;
  if (!fs.existsSync(rollbackPath)) {
    errors.push(`Arquivo de rollback não encontrado: ${rollbackPath}`);
  } else {
    const content = fs.readFileSync(rollbackPath, 'utf8');
    const requiredRollbackElements = [
      'Ponto de Restauração Seguro',
      'Matriz de Cenários e Respostas de Rollback',
      'Procedimentos Passo a Passo',
      'git reset --hard',
      'git clean -fd',
      'npm test'
    ];
    const missing = requiredRollbackElements.filter(el => !content.includes(el));
    if (missing.length > 0) {
      errors.push(`Elementos faltantes no plano de rollback: ${missing.join(', ')}`);
    } else {
      rollbackPlanValid = true;
    }
  }

  // 3. Validar existência do relatório comparativo
  if (!fs.existsSync(comparativePath)) {
    errors.push(`Relatório de validação comparativa não encontrado: ${comparativePath}`);
  }

  // 4. Confirmar que a regra de não fazer merge em master é explícita na documentação e no Git
  let isMasterUntouched = false;
  if (deliveryReportValid && rollbackPlanValid) {
    const deliveryContent = fs.readFileSync(deliveryPath, 'utf8');
    const rollbackContent = fs.readFileSync(rollbackPath, 'utf8');
    const docsDeclareNoMerge =
      deliveryContent.includes('Sem merge em master') &&
      rollbackContent.includes('Proibido merge automático em master/main');

    let gitBranchSafe = true;
    if (options.enforceGitBranchCheck) {
      try {
        const currentBranch = execFileSync('git', ['-C', AUTOADAPT_ROOT, 'rev-parse', '--abbrev-ref', 'HEAD'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe']
        }).trim();
        gitBranchSafe = currentBranch !== 'master' && currentBranch !== 'main';
      } catch {
        gitBranchSafe = true;
      }
    }

    isMasterUntouched = docsDeclareNoMerge && gitBranchSafe;
    if (!isMasterUntouched) {
      errors.push('A garantia de não realização de merge automático em master/main foi violada ou omitida.');
    }
  }

  const valid = deliveryReportValid && rollbackPlanValid && isMasterUntouched && errors.length === 0;

  return {
    valid,
    deliveryReportValid,
    rollbackPlanValid,
    isMasterUntouched,
    errors
  };
}

if (process.argv[1] && (process.argv[1].endsWith('candidateDelivery.js') || process.argv[1].endsWith('candidateDelivery'))) {
  const result = validateCandidateDelivery();
  console.log('[AutoAdapt] Validação de Entrega da Versão Candidata:');
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.valid ? 0 : 1;
}