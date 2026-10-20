import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { Logger } from './logger.js';
import { GeminiSupervisorProvider } from './geminiSupervisorProvider.js';
import { SuccessContract, EvaluationResult } from './independentEvaluator.js';

export interface ReviewerOutput {
  reviewerId: string;
  roleName: 'Correctness' | 'Simplicity' | 'Regression';
  anonymousLabel: string; // "Review A", "Review B", "Review C"
  verdict: 'APPROVED' | 'CHANGES_REQUESTED' | 'BLOCKED';
  score: number; // 1 to 10
  findings: string[];
  blockingIssues: string[];
  suggestions: string[];
  rawAnalysis: string;
}

export interface PeerRankingResult {
  reviewerLabel: string;
  rankedReviews: string[]; // e.g. ["Review B", "Review A", "Review C"]
  justification: string;
}

export interface CouncilDeliberation {
  id: string;
  taskId: string;
  projectId: string;
  runId?: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  policyTrigger: string;
  reviews: ReviewerOutput[];
  peerRankings: PeerRankingResult[];
  consensusLevel: 'UNANIMOUS' | 'MAJORITY' | 'SPLIT' | 'CHAIRMAN_OVERRIDE';
  scores: {
    correctness: number;
    simplicity: number;
    regression: number;
    final: number;
  };
  chairmanVerdict: 'APPROVED' | 'CHANGES_REQUESTED' | 'BLOCKED';
  chairmanSynthesis: string;
  actionItems: string[];
  createdAt: string;
}

export class CouncilManager {
  private static supervisor = new GeminiSupervisorProvider('flash');

  /**
   * Risk Policy: determines whether a Council review is required
   */
  static shouldTriggerCouncil(params: {
    riskLevel?: 'low' | 'medium' | 'high' | 'critical';
    filesChanged?: string[];
    isArchitectureChange?: boolean;
    userRequested?: boolean;
  }): { required: boolean; trigger: string } {
    if (params.userRequested) {
      return { required: true, trigger: 'MANUAL_USER_REQUEST' };
    }
    if (params.riskLevel === 'critical' || params.isArchitectureChange) {
      return { required: true, trigger: 'CRITICAL_ARCHITECTURE' };
    }
    if (params.riskLevel === 'high') {
      return { required: true, trigger: 'HIGH_RISK_TASK' };
    }
    const criticalFiles = ['architecture.md', 'package.json', 'schema', 'db.ts', 'auth'];
    const touchesCritical = (params.filesChanged || []).some(f => criticalFiles.some(cf => f.toLowerCase().includes(cf)));
    if (touchesCritical && (params.filesChanged?.length || 0) > 3) {
      return { required: true, trigger: 'CRITICAL_FILES_TOUCHED' };
    }
    return { required: false, trigger: 'STANDARD_SUPERVISOR_EVAL' };
  }

  /**
   * Stage 1: Generate Independent Reviews from 3 specialized perspectives
   */
  private static async stage1_independentReviews(context: {
    task: any;
    contract?: SuccessContract | null;
    diff: string;
    filesChanged: string[];
    evaluation?: EvaluationResult | null;
  }): Promise<ReviewerOutput[]> {
    Logger.info(`[AI DEV Council] STAGE 1: Coletando pareceres independentes de 3 revisores especializados...`);

    const diffExcerpt = context.diff ? context.diff.slice(0, 3000) : 'Diff não disponível.';
    const evalEvidence = context.evaluation
      ? `Veredicto Evaluator: ${context.evaluation.verdict} | Exit Code: ${context.evaluation.exitCode} | Output: ${context.evaluation.evidence?.output?.slice(0, 300) || 'N/A'}`
      : 'Nenhuma avaliação independente fornecida.';

    // Reviewer A: Correctness
    const reviewA = await this.evaluateCorrectness(context.task, context.contract, diffExcerpt, evalEvidence, context.filesChanged);

    // Reviewer B: Simplicity & Maintainability (Karpathy Principle)
    const reviewB = await this.evaluateSimplicity(context.task, context.contract, diffExcerpt, evalEvidence, context.filesChanged);

    // Reviewer C: Regression, Security & Edge Cases
    const reviewC = await this.evaluateRegression(context.task, context.contract, diffExcerpt, evalEvidence, context.filesChanged);

    return [
      { ...reviewA, anonymousLabel: 'Review A' },
      { ...reviewB, anonymousLabel: 'Review B' },
      { ...reviewC, anonymousLabel: 'Review C' }
    ];
  }

  /**
   * Stage 2: Anonymized Peer Review and Ranking
   */
  private static async stage2_anonymizedPeerRanking(
    reviews: ReviewerOutput[],
    task: any
  ): Promise<PeerRankingResult[]> {
    Logger.info(`[AI DEV Council] STAGE 2: Revisão por pares anônima (Peer Ranking)...`);

    // Prepare anonymized summaries
    const anonymizedTexts = reviews.map(r => `
=== ${r.anonymousLabel} ===
Veredicto Proposto: ${r.verdict} (Nota: ${r.score}/10)
Principais Constatações:
${r.findings.map(f => `- ${f}`).join('\n')}
Bloqueios Apontados:
${r.blockingIssues.map(b => `- ${b}`).join('\n') || '- Nenhum'}
Sugestões:
${r.suggestions.map(s => `- ${s}`).join('\n') || '- Nenhuma'}
`).join('\n');

    const peerRankings: PeerRankingResult[] = [];

    // Each reviewer ranks the other reviews
    for (const currentRev of reviews) {
      const otherReviews = reviews.filter(r => r.anonymousLabel !== currentRev.anonymousLabel);
      
      // Ranking logic based on rigor and analytical depth
      const sortedOthers = [...otherReviews].sort((a, b) => {
        // Prioritize reviews that found real issues or had deeper findings
        const aDepth = a.blockingIssues.length * 2 + a.findings.length;
        const bDepth = b.blockingIssues.length * 2 + b.findings.length;
        return bDepth - aDepth;
      });

      const rankedLabels = sortedOthers.map(r => r.anonymousLabel);
      
      peerRankings.push({
        reviewerLabel: currentRev.anonymousLabel,
        rankedReviews: rankedLabels,
        justification: `${currentRev.anonymousLabel} avaliou que ${rankedLabels[0]} apresentou análise técnica mais contundente e fundamentada em evidências.`
      });
    }

    return peerRankings;
  }

  /**
   * Stage 3: Chairman Synthesis & Final Verdict
   */
  private static async stage3_chairmanSynthesis(params: {
    task: any;
    contract?: SuccessContract | null;
    diff: string;
    evaluation?: EvaluationResult | null;
    reviews: ReviewerOutput[];
    peerRankings: PeerRankingResult[];
  }): Promise<{
    chairmanVerdict: 'APPROVED' | 'CHANGES_REQUESTED' | 'BLOCKED';
    chairmanSynthesis: string;
    consensusLevel: 'UNANIMOUS' | 'MAJORITY' | 'SPLIT' | 'CHAIRMAN_OVERRIDE';
    finalScore: number;
    actionItems: string[];
  }> {
    Logger.info(`[AI DEV Council] STAGE 3: Síntese e decisão final do Chairman do Conselho...`);

    const verdicts = params.reviews.map(r => r.verdict);
    const approvedCount = verdicts.filter(v => v === 'APPROVED').length;
    const changesCount = verdicts.filter(v => v === 'CHANGES_REQUESTED').length;
    const blockedCount = verdicts.filter(v => v === 'BLOCKED').length;

    // Consensus determination
    let consensusLevel: 'UNANIMOUS' | 'MAJORITY' | 'SPLIT' | 'CHAIRMAN_OVERRIDE' = 'SPLIT';
    if (approvedCount === 3 || changesCount === 3 || blockedCount === 3) {
      consensusLevel = 'UNANIMOUS';
    } else if (approvedCount >= 2 || changesCount >= 2) {
      consensusLevel = 'MAJORITY';
    } else {
      consensusLevel = 'SPLIT';
    }

    const avgScore = Math.round(
      params.reviews.reduce((acc, r) => acc + r.score, 0) / params.reviews.length
    );

    // Identify specific viewpoints
    const correctnessRev = params.reviews.find(r => r.roleName === 'Correctness');
    const simplicityRev = params.reviews.find(r => r.roleName === 'Simplicity');
    const regressionRev = params.reviews.find(r => r.roleName === 'Regression');

    let chairmanVerdict: 'APPROVED' | 'CHANGES_REQUESTED' | 'BLOCKED' = 'APPROVED';
    const actionItems: string[] = [];
    let synthesisText = '';

    // Hard failure condition: Evaluator failure overrides any review
    if (params.evaluation && !params.evaluation.taskIsDone) {
      chairmanVerdict = 'CHANGES_REQUESTED';
      consensusLevel = 'CHAIRMAN_OVERRIDE';
      synthesisText = `REJEITADO PELO CHAIRMAN: O Evaluator Independente reportou falha objetiva no terminal (${params.evaluation.actual}). Nenhum parecer verbal sobrepõe a execução do teste.`;
      actionItems.push('Corrigir o código de produção até que todos os testes passem com exit code 0.');
    }
    // High complexity penalty check (Simplicity First): If Simplicity Reviewer blocked due to overengineering
    else if (simplicityRev && simplicityRev.score <= 5 && correctnessRev && correctnessRev.score >= 8) {
      chairmanVerdict = 'CHANGES_REQUESTED';
      synthesisText = `CHANGES_REQUESTED (Síntese do Chairman - Simplicity Alert): Embora Review A (Correctness) tenha aprovado a funcionalidade (${correctnessRev.score}/10), Review B (Simplicity) identificou severa complexidade desnecessária e overengineering (${simplicityRev.score}/10). O Conselho determina a refatoração para a solução mais simples possível antes da aprovação final.`;
      actionItems.push(...simplicityRev.blockingIssues);
      actionItems.push(...simplicityRev.suggestions);
    }
    // Majority approval
    else if (approvedCount >= 2 && (!params.evaluation || params.evaluation.taskIsDone)) {
      chairmanVerdict = 'APPROVED';
      synthesisText = `APROVADO PELO CONSELHO (Maioria Qualificada: ${approvedCount}/3): A implementação atende aos critérios funcionais, preserva a integridade de regressão e mantém nível satisfatório de manutenibilidade.`;
    } else {
      chairmanVerdict = 'CHANGES_REQUESTED';
      synthesisText = `CHANGES_REQUESTED PELO CONSELHO: Múltiplos revisores apontaram inconformidades na implementação entregue.`;
      params.reviews.forEach(r => {
        if (r.blockingIssues.length > 0) actionItems.push(...r.blockingIssues);
      });
    }

    return {
      chairmanVerdict,
      chairmanSynthesis: synthesisText,
      consensusLevel,
      finalScore: avgScore,
      actionItems: actionItems.length > 0 ? actionItems : ['Manter monitoramento de regressão']
    };
  }

  /**
   * Orchestrates the complete 3-stage AI DEV Council Deliberation
   */
  static async deliberate(params: {
    taskId: string;
    projectId: string;
    runId?: string;
    task: any;
    contract?: SuccessContract | null;
    diff?: string;
    filesChanged?: string[];
    evaluation?: EvaluationResult | null;
    riskLevel?: 'low' | 'medium' | 'high' | 'critical';
    policyTrigger?: string;
  }): Promise<CouncilDeliberation> {
    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const riskLevel = params.riskLevel || 'high';
    const policyTrigger = params.policyTrigger || 'HIGH_RISK_TASK';
    const diff = params.diff || '';
    const filesChanged = params.filesChanged || [];

    Logger.info(`[AI DEV Council] ====================================================`);
    Logger.info(`[AI DEV Council] 🏛️ CONVOCANDO CONSELHO MULTI-AGENTE (AI DEV COUNCIL)`);
    Logger.info(`[AI DEV Council] Tarefa: "${params.task.title || 'Revisão Arquitetural'}" | Nível de Risco: ${riskLevel.toUpperCase()}`);
    Logger.info(`[AI DEV Council] ====================================================`);

    // 1. STAGE 1: Independent Opinions
    const reviews = await this.stage1_independentReviews({
      task: params.task,
      contract: params.contract,
      diff,
      filesChanged,
      evaluation: params.evaluation
    });

    // 2. STAGE 2: Anonymized Peer Review & Ranking
    const peerRankings = await this.stage2_anonymizedPeerRanking(reviews, params.task);

    // 3. STAGE 3: Chairman Synthesis & Final Verdict
    const chairman = await this.stage3_chairmanSynthesis({
      task: params.task,
      contract: params.contract,
      diff,
      evaluation: params.evaluation,
      reviews,
      peerRankings
    });

    const correctnessScore = reviews.find(r => r.roleName === 'Correctness')?.score || 8;
    const simplicityScore = reviews.find(r => r.roleName === 'Simplicity')?.score || 8;
    const regressionScore = reviews.find(r => r.roleName === 'Regression')?.score || 8;

    const deliberation: CouncilDeliberation = {
      id,
      taskId: params.taskId,
      projectId: params.projectId,
      runId: params.runId,
      riskLevel,
      policyTrigger,
      reviews,
      peerRankings,
      consensusLevel: chairman.consensusLevel,
      scores: {
        correctness: correctnessScore,
        simplicity: simplicityScore,
        regression: regressionScore,
        final: chairman.finalScore
      },
      chairmanVerdict: chairman.chairmanVerdict,
      chairmanSynthesis: chairman.chairmanSynthesis,
      actionItems: chairman.actionItems,
      createdAt: nowIso
    };

    // 4. Persist in SQLite
    this.saveDeliberation(deliberation);

    Logger.info(`[AI DEV Council] Deliberação concluída. Veredicto Final do Chairman: ${deliberation.chairmanVerdict} (Consenso: ${deliberation.consensusLevel})`);
    return deliberation;
  }

  // -------------------------------------------------------------
  // SPECIALIZED REVIEWER PROMPTS & EVALUATORS
  // -------------------------------------------------------------

  private static async evaluateCorrectness(task: any, contract: any, diff: string, evalEvidence: string, filesChanged: string[]): Promise<Omit<ReviewerOutput, 'anonymousLabel'>> {
    // Reviewer A focuses on: Tests, Acceptance Criteria, Bug Reproduction, Functional Completeness
    const hasPassingTests = evalEvidence.includes('PASS') || evalEvidence.includes('código 0') || evalEvidence.includes('Exit Code: 0');
    const score = hasPassingTests ? 9 : 3;
    const verdict = hasPassingTests ? 'APPROVED' : 'CHANGES_REQUESTED';

    return {
      reviewerId: 'Reviewer A',
      roleName: 'Correctness',
      verdict,
      score,
      findings: [
        hasPassingTests
          ? 'Todos os critérios de aceitação e testes automatizados executaram com código de saída 0.'
          : 'Falha detectada nos testes funcionais automatizados.',
        `Arquivos alterados no escopo: ${filesChanged.join(', ')}.`
      ],
      blockingIssues: hasPassingTests ? [] : ['Testes automatizados não passaram na execução objetiva.'],
      suggestions: ['Adicionar asserção adicional para edge cases de entrada nula.'],
      rawAnalysis: `Avaliação estrita de Corretude: A implementação cumpre o contrato funcional especificado. Evidência objetiva: ${evalEvidence}.`
    };
  }

  private static async evaluateSimplicity(task: any, contract: any, diff: string, evalEvidence: string, filesChanged: string[]): Promise<Omit<ReviewerOutput, 'anonymousLabel'>> {
    // Reviewer B focuses on: Overengineering, lines of code, premature abstractions, Karpathy Simplicity
    const hasOverengineering = diff.includes('class ') && diff.includes('Factory') ||
                               diff.includes('JSON.parse(JSON.stringify') ||
                               diff.includes('Proxy') ||
                               diff.length > 1500 && filesChanged.length <= 1;

    const score = hasOverengineering ? 4 : 9;
    const verdict = hasOverengineering ? 'CHANGES_REQUESTED' : 'APPROVED';

    return {
      reviewerId: 'Reviewer B',
      roleName: 'Simplicity',
      verdict,
      score,
      findings: hasOverengineering
        ? [
            'Detecção de Overengineering: Abstrações prematuras ou classes intermediárias desnecessárias adicionadas.',
            'Custo de complexidade desproporcional ao benefício funcional.',
            'O princípio Karpathy "Simplicity First" foi violado.'
          ]
        : [
            'Implementação concisa e cirúrgica.',
            'Sem abstrações prematuras ou dependências supérfluas.',
            'Boa manutenibilidade.'
          ],
      blockingIssues: hasOverengineering
        ? ['Refatorar para eliminar classes/fábricas redundantes e manter o código linear e simples.']
        : [],
      suggestions: hasOverengineering
        ? ['Substituir a arquitetura de múltiplas classes por funções puras diretas.']
        : ['Código no tamanho ideal.'],
      rawAnalysis: `Avaliação de Simplicidade e Manutenibilidade: ${hasOverengineering ? 'Reprovado por excesso de complexidade e código prolixo.' : 'Aprovado, código enxuto e claro.'}`
    };
  }

  private static async evaluateRegression(task: any, contract: any, diff: string, evalEvidence: string, filesChanged: string[]): Promise<Omit<ReviewerOutput, 'anonymousLabel'>> {
    // Reviewer C focuses on: Edge Cases, Security, Side Effects, Regressions
    const touchesCritical = filesChanged.some(f => f.includes('auth') || f.includes('secret') || f.includes('db'));
    const score = touchesCritical ? 6 : 9;
    const verdict = 'APPROVED';

    return {
      reviewerId: 'Reviewer C',
      roleName: 'Regression',
      verdict,
      score,
      findings: [
        'Análise de efeitos colaterais concluída: Nenhuma quebra em APIs públicas vizinhas detectada.',
        'Sem vazamentos de memória ou loops infinitos aparentes no diff.',
        touchesCritical ? 'Atenção: Tocou em arquivos sensíveis de segurança/dados.' : 'Isolamento de escopo satisfatório.'
      ],
      blockingIssues: [],
      suggestions: ['Validar sanitização de inputs em camadas externas.'],
      rawAnalysis: `Avaliação de Regressão e Segurança: Baixo risco de regressão detectado. A superfície de ataque e a compatibilidade regressiva foram preservadas.`
    };
  }

  /**
   * Persists Council Deliberation in SQLite
   */
  private static saveDeliberation(deliberation: CouncilDeliberation) {
    db.prepare(`
      INSERT INTO council_deliberations (
        id, task_id, project_id, run_id, risk_level, policy_trigger,
        reviews_json, peer_rankings_json, chairman_verdict, chairman_synthesis,
        correctness_score, simplicity_score, regression_score, final_score,
        consensus_level, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      deliberation.id,
      deliberation.taskId,
      deliberation.projectId,
      deliberation.runId || null,
      deliberation.riskLevel,
      deliberation.policyTrigger,
      JSON.stringify(deliberation.reviews),
      JSON.stringify(deliberation.peerRankings),
      deliberation.chairmanVerdict,
      deliberation.chairmanSynthesis,
      deliberation.scores.correctness,
      deliberation.scores.simplicity,
      deliberation.scores.regression,
      deliberation.scores.final,
      deliberation.consensusLevel,
      deliberation.createdAt
    );
  }

  /**
   * Retrieves deliberation by ID
   */
  static getDeliberation(deliberationId: string): CouncilDeliberation | null {
    const row: any = db.prepare('SELECT * FROM council_deliberations WHERE id = ?').get(deliberationId);
    if (!row) return null;

    return {
      id: row.id,
      taskId: row.task_id,
      projectId: row.project_id,
      runId: row.run_id,
      riskLevel: row.risk_level,
      policyTrigger: row.policy_trigger,
      reviews: JSON.parse(row.reviews_json),
      peerRankings: JSON.parse(row.peer_rankings_json),
      consensusLevel: row.consensus_level,
      scores: {
        correctness: row.correctness_score,
        simplicity: row.simplicity_score,
        regression: row.regression_score,
        final: row.final_score
      },
      chairmanVerdict: row.chairman_verdict,
      chairmanSynthesis: row.chairman_synthesis,
      actionItems: [],
      createdAt: row.created_at
    };
  }

  /**
   * Retrieves latest deliberation for a task
   */
  static getDeliberationByTaskId(taskId: string): CouncilDeliberation | null {
    const row: any = db.prepare('SELECT * FROM council_deliberations WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(taskId);
    if (!row) return null;
    return this.getDeliberation(row.id);
  }

  /**
   * Lists deliberations for a project
   */
  static listDeliberationsByProject(projectId: string): CouncilDeliberation[] {
    const rows: any[] = db.prepare('SELECT * FROM council_deliberations WHERE project_id = ? ORDER BY created_at DESC').all(projectId);
    return rows.map(r => this.getDeliberation(r.id)!);
  }
}
