import fs from 'node:fs';
import path from 'node:path';

/**
 * Valida os requisitos de entrega da versão candidata:
 * 1. Diagnóstico e diff agrupados (docs/entrega-versao-candidata.md)
 * 2. Plano de rollback gerado sem merge em master (docs/plano-de-rollback.md)
 * 3. Proibição de merge automático em master
 * @param {object} [options]
 * @returns {{
 *   valid: boolean,
 *   deliveryReportValid: boolean,
 *   rollbackPlanValid: boolean,
 *   isMasterUntouched: boolean,
 *   errors: string[]
 * }}
 */
export function validateCandidateDelivery(options = {}) {
  const deliveryPath = path.resolve(options.deliveryPath || 'docs/entrega-versao-candidata.md');
  const rollbackPath = path.resolve(options.rollbackPath || 'docs/plano-de-rollback.md');
  const comparativePath = path.resolve(options.comparativePath || 'docs/relatorio-validacao-comparativa.md');

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

  // 3. Confirmar que a regra de não fazer merge em master é explícita
  let isMasterUntouched = false;
  if (deliveryReportValid && rollbackPlanValid) {
    const deliveryContent = fs.readFileSync(deliveryPath, 'utf8');
    const rollbackContent = fs.readFileSync(rollbackPath, 'utf8');
    isMasterUntouched = deliveryContent.includes('Sem merge em master') &&
      rollbackContent.includes('Proibido merge automático em master/main');
    if (!isMasterUntouched) {
      errors.push('A garantia de não realização de merge automático não está declarada explicitamente.');
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

// Execução direta CLI
if (process.argv[1] && (process.argv[1].endsWith('candidateDelivery.js') || process.argv[1].endsWith('candidateDelivery'))) {
  const result = validateCandidateDelivery();
  console.log('[AutoAdapt] Validação de Entrega da Versão Candidata:');
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.valid ? 0 : 1;
}
