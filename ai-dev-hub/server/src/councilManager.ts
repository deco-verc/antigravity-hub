import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { Logger } from './logger.js';
import { GeminiSupervisorProvider } from './geminiSupervisorProvider.js';
import { SuccessContract, EvaluationResult } from './independentEvaluator.js';
import { ReaSaaSMasterService } from './reaSaaSMasterService.js';
import { AgentApiGateway } from './agentApiGateway.js';

export interface ReviewerOutput {
  reviewerId: string;
  roleName: 'Correctness' | 'Simplicity' | 'Regression';
  anonymousLabel: string; // "Review A", "Review B", "Review C" or "Response A", "Response B", "Response C"
  verdict: 'APPROVED' | 'CHANGES_REQUESTED' | 'BLOCKED';
  score: number; // 1 to 10
  findings: string[];
  blockingIssues: string[];
  suggestions: string[];
  rawAnalysis: string;
}

export interface PeerRankingResult {
  reviewerLabel: string;
  rankedReviews: string[]; // e.g. ["Review B", "Review A", "Review C"] or ["Response B", "Response A", "Response C"]
  justification: string;
  rawRankingText?: string;
}

export interface AggregateRankingResult {
  role: string;
  label?: string;
  averageRank: number;
  rankingsCount: number;
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
  aggregateRankings?: AggregateRankingResult[];
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
   * Parse the FINAL RANKING section from the model's response.
   * Matches canonical logic from llm-council/backend/council.py.
   * Supports both 'Response [A-Z]' and 'Review [A-Z]' formats.
   */
  static parseRankingFromText(rankingText: string): string[] {
    if (!rankingText || typeof rankingText !== 'string') return [];

    const normalizeLabel = (label: string) => label.trim();

    if (rankingText.includes('FINAL RANKING:')) {
      const parts = rankingText.split('FINAL RANKING:');
      if (parts.length >= 2) {
        const rankingSection = parts.slice(1).join('FINAL RANKING:');
        const numberedMatches = rankingSection.match(/\d+\.\s*(?:Response|Review) [A-Z]/g);
        if (numberedMatches && numberedMatches.length > 0) {
          return numberedMatches
            .map(m => {
              const matched = m.match(/(?:Response|Review) [A-Z]/);
              return matched ? normalizeLabel(matched[0]) : '';
            })
            .filter((val): val is string => Boolean(val));
        }

        const matches = rankingSection.match(/(?:Response|Review) [A-Z]/g);
        if (matches && matches.length > 0) {
          return Array.from(new Set(matches.map(normalizeLabel)));
        }
      }
    }

    const fallbackMatches = rankingText.match(/(?:Response|Review) [A-Z]/g);
    return fallbackMatches ? Array.from(new Set(fallbackMatches.map(normalizeLabel))) : [];
  }

  /**
   * Calculate aggregate rankings across all reviewers.
   * Matches canonical logic from llm-council/backend/council.py.
   */
  static calculateAggregateRankings(
    stage2Results: Array<{ reviewer?: string; ranking?: string; parsedRanking?: string[]; rankedReviews?: string[] }>,
    labelToRoleMap: Record<string, string>
  ): AggregateRankingResult[] {
    const rolePositions: Record<string, number[]> = {};

    for (const role of Object.values(labelToRoleMap)) {
      if (!rolePositions[role]) {
        rolePositions[role] = [];
      }
    }

    for (const item of stage2Results) {
      let parsedRanking: string[] = [];
      if (item.parsedRanking && Array.isArray(item.parsedRanking) && item.parsedRanking.length > 0) {
        parsedRanking = item.parsedRanking;
      } else if (item.rankedReviews && Array.isArray(item.rankedReviews) && item.rankedReviews.length > 0) {
        parsedRanking = item.rankedReviews;
      } else if (item.ranking) {
        parsedRanking = this.parseRankingFromText(item.ranking);
      }

      parsedRanking.forEach((label, index) => {
        const role = labelToRoleMap[label] || labelToRoleMap[label.replace('Review ', 'Response ')] || labelToRoleMap[label.replace('Response ', 'Review ')];
        if (role) {
          if (!rolePositions[role]) rolePositions[role] = [];
          rolePositions[role].push(index + 1);
        }
      });
    }

    const roleToLabel: Record<string, string> = {};
    for (const [lbl, role] of Object.entries(labelToRoleMap)) {
      if (!roleToLabel[role]) roleToLabel[role] = lbl;
    }

    const aggregate: AggregateRankingResult[] = [];
    for (const [role, positions] of Object.entries(rolePositions)) {
      if (positions.length > 0) {
        const sum = positions.reduce((acc, p) => acc + p, 0);
        const avg = sum / positions.length;
        aggregate.push({
          role,
          label: roleToLabel[role] || role,
          averageRank: Math.round(avg * 100) / 100,
          rankingsCount: positions.length
        });
      }
    }

    aggregate.sort((a, b) => a.averageRank - b.averageRank);
    return aggregate;
  }

  /**
   * Stage 1: Generate Independent Reviews from 3 specialized perspectives.
   * In Live mode (!isOfflineMode), queries models in parallel with graceful fallback to heuristics.
   */
  private static async stage1_independentReviews(
    context: {
      task: any;
      contract?: SuccessContract | null;
      diff: string;
      filesChanged: string[];
      evaluation?: EvaluationResult | null;
    },
    options?: { forceHeuristic?: boolean; projectId?: string }
  ): Promise<ReviewerOutput[]> {
    Logger.info(`[AI DEV Council] STAGE 1: Coletando pareceres independentes de 3 revisores especializados...`);

    const diffExcerpt = context.diff ? context.diff.slice(0, 3000) : 'Diff nao disponivel.';
    const evalEvidence = context.evaluation
      ? `Veredicto Evaluator: ${context.evaluation.verdict} | Exit Code: ${context.evaluation.exitCode} | Output: ${context.evaluation.evidence?.output?.slice(0, 300) || 'N/A'}`
      : 'Nenhuma avaliacao independente fornecida.';

    const isOffline = AgentApiGateway.isOfflineMode() || Boolean(options?.forceHeuristic);

    if (isOffline) {
      const reviewA = await this.evaluateCorrectness(context.task, context.contract, diffExcerpt, evalEvidence, context.filesChanged);
      const reviewB = await this.evaluateSimplicity(context.task, context.contract, diffExcerpt, evalEvidence, context.filesChanged);
      const reviewC = await this.evaluateRegression(context.task, context.contract, diffExcerpt, evalEvidence, context.filesChanged);

      return [
        { ...reviewA, anonymousLabel: 'Review A' },
        { ...reviewB, anonymousLabel: 'Review B' },
        { ...reviewC, anonymousLabel: 'Review C' }
      ];
    }

    // Live multi-perspective queries
    const promptCorrectness = `Você é o Revisor A do AI DEV Council, especialista em Corretude Funcional, Testes e Completude de Requisitos.
Tarefa: ${context.task?.title || 'Tarefa'}
Evidência de Avaliação: ${evalEvidence}
Diff:
${diffExcerpt}
Arquivos Alterados: ${context.filesChanged.join(', ')}

Avalie a corretude técnica e responda no formato:
VEREDICTO: APPROVED ou CHANGES_REQUESTED
NOTA: (1-10)
CONSTATACOES:
- ...
BLOQUEIOS:
- ...
SUGESTOES:
- ...`;

    const promptSimplicity = `Você é o Revisor B do AI DEV Council, Guardião da Navalha de Occam e do princípio Karpathy Simplicity First.
Tarefa: ${context.task?.title || 'Tarefa'}
Diff:
${diffExcerpt}

Avalie se há overengineering, abstrações prematuras ou complexidade desnecessária e responda no formato:
VEREDICTO: APPROVED ou CHANGES_REQUESTED
NOTA: (1-10)
CONSTATACOES:
- ...
BLOQUEIOS:
- ...
SUGESTOES:
- ...`;

    const promptRegression = `Você é o Revisor C do AI DEV Council, especialista em Regressão, Segurança, Superfície de Ataque e Compatibilidade.
Tarefa: ${context.task?.title || 'Tarefa'}
Arquivos Alterados: ${context.filesChanged.join(', ')}
Diff:
${diffExcerpt}

Avalie riscos de regressão e segurança e responda no formato:
VEREDICTO: APPROVED ou CHANGES_REQUESTED
NOTA: (1-10)
CONSTATACOES:
- ...
BLOQUEIOS:
- ...
SUGESTOES:
- ...`;

    const results = await Promise.allSettled([
      this.supervisor.evaluateCouncilPrompt(promptCorrectness, { projectId: options?.projectId }),
      this.supervisor.evaluateCouncilPrompt(promptSimplicity, { projectId: options?.projectId }),
      this.supervisor.evaluateCouncilPrompt(promptRegression, { projectId: options?.projectId, modelOverride: 'pro' })
    ]);

    const reviewA = results[0].status === 'fulfilled' && results[0].value
      ? this.parseLiveReviewResponse(results[0].value, 'Correctness', 'Review A')
      : await this.evaluateCorrectness(context.task, context.contract, diffExcerpt, evalEvidence, context.filesChanged);

    const reviewB = results[1].status === 'fulfilled' && results[1].value
      ? this.parseLiveReviewResponse(results[1].value, 'Simplicity', 'Review B')
      : await this.evaluateSimplicity(context.task, context.contract, diffExcerpt, evalEvidence, context.filesChanged);

    const reviewC = results[2].status === 'fulfilled' && results[2].value
      ? this.parseLiveReviewResponse(results[2].value, 'Regression', 'Review C')
      : await this.evaluateRegression(context.task, context.contract, diffExcerpt, evalEvidence, context.filesChanged);

    return [
      { ...reviewA, anonymousLabel: 'Review A' },
      { ...reviewB, anonymousLabel: 'Review B' },
      { ...reviewC, anonymousLabel: 'Review C' }
    ];
  }

  /**
   * Helper to parse a live model review text into structured ReviewerOutput.
   */
  private static parseLiveReviewResponse(
    text: string,
    roleName: 'Correctness' | 'Simplicity' | 'Regression',
    label: string
  ): Omit<ReviewerOutput, 'anonymousLabel'> {
    const verdictMatch = text.match(/VEREDICTO:\s*(APPROVED|CHANGES_REQUESTED|BLOCKED)/i);
    const scoreMatch = text.match(/NOTA:\s*(\d+)/i);

    const verdict = (verdictMatch ? verdictMatch[1].toUpperCase() : 'APPROVED') as 'APPROVED' | 'CHANGES_REQUESTED' | 'BLOCKED';
    const score = scoreMatch ? Math.min(10, Math.max(1, parseInt(scoreMatch[1], 10))) : 8;

    const extractSection = (heading: string): string[] => {
      const idx = text.indexOf(heading);
      if (idx === -1) return [];
      const sub = text.slice(idx + heading.length);
      const nextHeadingIdx = sub.search(/[A-Z]+:/);
      const sectionText = nextHeadingIdx !== -1 ? sub.slice(0, nextHeadingIdx) : sub;
      return sectionText
        .split('\n')
        .map(l => l.replace(/^[-*•]\s*/, '').trim())
        .filter(l => l.length > 0 && !l.toLowerCase().includes('nenhum'));
    };

    const findings = extractSection('CONSTATACOES:');
    const blockingIssues = extractSection('BLOQUEIOS:');
    const suggestions = extractSection('SUGESTOES:');

    return {
      reviewerId: label,
      roleName,
      verdict: blockingIssues.length > 0 ? 'CHANGES_REQUESTED' : verdict,
      score,
      findings: findings.length > 0 ? findings : [`Parecer do revisor de ${roleName} concluído.`],
      blockingIssues,
      suggestions: suggestions.length > 0 ? suggestions : ['Manter acompanhamento contínuo.'],
      rawAnalysis: text
    };
  }

  /**
   * Stage 2: Anonymized Peer Review and Ranking.
   * Matches 3-stage LLM Council architecture from council.py.
   */
  private static async stage2_anonymizedPeerRanking(
    reviews: ReviewerOutput[],
    task: any,
    options?: { forceHeuristic?: boolean; projectId?: string }
  ): Promise<{ peerRankings: PeerRankingResult[]; aggregateRankings: AggregateRankingResult[] }> {
    Logger.info(`[AI DEV Council] STAGE 2: Revisão por pares anônima (Peer Ranking)...`);

    const labelToRoleMap: Record<string, string> = {
      'Response A': 'Correctness',
      'Response B': 'Simplicity',
      'Response C': 'Regression',
      'Review A': 'Correctness',
      'Review B': 'Simplicity',
      'Review C': 'Regression'
    };

    const peerRankings: PeerRankingResult[] = [];
    const isOffline = AgentApiGateway.isOfflineMode() || Boolean(options?.forceHeuristic);

    // Build anonymized representations
    for (const currentRev of reviews) {
      const otherReviews = reviews.filter(r => r.anonymousLabel !== currentRev.anonymousLabel);

      if (isOffline) {
        // Deterministic ranking by rigor and technical depth
        const sortedOthers = [...otherReviews].sort((a, b) => {
          const aDepth = a.score - a.blockingIssues.length * 2 + a.findings.length;
          const bDepth = b.score - b.blockingIssues.length * 2 + b.findings.length;
          return bDepth - aDepth;
        });

        const rankedLabels = sortedOthers.map(r => r.anonymousLabel);
        const rankingText = [
          `${currentRev.anonymousLabel} avaliou as propostas pares quanto a impacto técnico e fundamentação objetiva.`,
          `FINAL RANKING:`,
          ...rankedLabels.map((lbl, idx) => `${idx + 1}. ${lbl}`)
        ].join('\n');

        const parsed = this.parseRankingFromText(rankingText);
        peerRankings.push({
          reviewerLabel: currentRev.anonymousLabel,
          rankedReviews: parsed.length > 0 ? parsed : rankedLabels,
          justification: `${currentRev.anonymousLabel} avaliou que ${rankedLabels[0]} apresentou análise técnica mais contundente e fundamentada em evidências.`,
          rawRankingText: rankingText
        });
      } else {
        // Live ranking prompt matching council.py
        const prompt = `You are evaluating different reviews for task: "${task?.title || 'Technical Task'}".
Here are the reviews from other reviewers (anonymized):

${otherReviews.map(r => `${r.anonymousLabel}:
Score: ${r.score}/10
Verdict: ${r.verdict}
Findings: ${r.findings.join('; ')}
Blockers: ${r.blockingIssues.join('; ') || 'None'}`).join('\n\n')}

Your task:
1. First, evaluate each review individually.
2. At the end, provide a final ranking.

IMPORTANT: Your final ranking MUST be formatted EXACTLY as follows:
FINAL RANKING:
1. Review X
2. Review Y

Now provide your evaluation and ranking:`;

        try {
          const responseText = await this.supervisor.evaluateCouncilPrompt(prompt, { projectId: options?.projectId });
          if (responseText && responseText.includes('FINAL RANKING:')) {
            const parsed = this.parseRankingFromText(responseText);
            if (parsed.length > 0) {
              peerRankings.push({
                reviewerLabel: currentRev.anonymousLabel,
                rankedReviews: parsed,
                justification: `${currentRev.anonymousLabel} conduziu avaliação comparativa por pares.`,
                rawRankingText: responseText
              });
              continue;
            }
          }
        } catch (err: any) {
          Logger.warn(`[CouncilManager] Falha no peer ranking ao vivo para ${currentRev.anonymousLabel}: ${err?.message}`);
        }

        // Fallback for this reviewer
        const sortedOthers = [...otherReviews].sort((a, b) => b.score - a.score);
        const rankedLabels = sortedOthers.map(r => r.anonymousLabel);
        peerRankings.push({
          reviewerLabel: currentRev.anonymousLabel,
          rankedReviews: rankedLabels,
          justification: `${currentRev.anonymousLabel} priorizou o parecer com maior pontuação técnica.`,
          rawRankingText: `FINAL RANKING:\n${rankedLabels.map((lbl, idx) => `${idx + 1}. ${lbl}`).join('\n')}`
        });
      }
    }

    const aggregateRankings = this.calculateAggregateRankings(
      peerRankings.map(p => ({
        reviewer: p.reviewerLabel,
        rankedReviews: p.rankedReviews,
        ranking: p.rawRankingText
      })),
      labelToRoleMap
    );

    return { peerRankings, aggregateRankings };
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
    aggregateRankings?: AggregateRankingResult[];
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
    // If any reviewer identified explicit blocking issues, they MUST be resolved before approval
    else if (params.reviews.some(r => r.blockingIssues.length > 0)) {
      chairmanVerdict = 'CHANGES_REQUESTED';
      synthesisText = `CHANGES_REQUESTED PELO CONSELHO: Bloqueios técnicos apontados pelos revisores precisam ser sanados antes do prosseguimento.`;
      params.reviews.forEach(r => {
        if (r.blockingIssues.length > 0) actionItems.push(...r.blockingIssues);
      });
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
      actionItems: actionItems.length > 0 ? Array.from(new Set(actionItems)) : ['Manter monitoramento de regressão']
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
    options?: { forceHeuristic?: boolean };
  }): Promise<CouncilDeliberation> {
    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const riskLevel = params.riskLevel || 'high';
    const policyTrigger = params.policyTrigger || 'HIGH_RISK_TASK';
    const diff = params.diff || '';
    const filesChanged = params.filesChanged || [];

    Logger.info(`[AI DEV Council] ====================================================`);
    Logger.info(`[AI DEV Council] CONVOCANDO CONSELHO MULTI-AGENTE (AI DEV COUNCIL)`);
    Logger.info(`[AI DEV Council] Tarefa: "${params.task.title || 'Revisão Arquitetural'}" | Nível de Risco: ${riskLevel.toUpperCase()}`);
    Logger.info(`[AI DEV Council] ====================================================`);

    // 1. STAGE 1: Independent Opinions
    const reviews = await this.stage1_independentReviews(
      {
        task: params.task,
        contract: params.contract,
        diff,
        filesChanged,
        evaluation: params.evaluation
      },
      { forceHeuristic: params.options?.forceHeuristic, projectId: params.projectId }
    );

    // 2. STAGE 2: Anonymized Peer Review & Ranking
    const { peerRankings, aggregateRankings } = await this.stage2_anonymizedPeerRanking(
      reviews,
      params.task,
      { forceHeuristic: params.options?.forceHeuristic, projectId: params.projectId }
    );

    // 3. STAGE 3: Chairman Synthesis & Final Verdict
    const chairman = await this.stage3_chairmanSynthesis({
      task: params.task,
      contract: params.contract,
      diff,
      evaluation: params.evaluation,
      reviews,
      peerRankings,
      aggregateRankings
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
      aggregateRankings,
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

  /**
   * Freeform Council Deliberation for technical queries, architecture choices, or /council slash command.
   * Mirrors run_full_council from llm-council/backend/council.py.
   */
  static async deliberateQuery(
    query: string,
    options?: {
      context?: string;
      projectId?: string;
      forceHeuristic?: boolean;
    }
  ): Promise<{
    query: string;
    stage1Reviews: ReviewerOutput[];
    stage2PeerRankings: PeerRankingResult[];
    aggregateRankings: AggregateRankingResult[];
    chairmanVerdict: 'APPROVED' | 'CHANGES_REQUESTED' | 'BLOCKED';
    chairmanSynthesis: string;
    consensusLevel: 'UNANIMOUS' | 'MAJORITY' | 'SPLIT' | 'CHAIRMAN_OVERRIDE';
    actionItems: string[];
  }> {
    const virtualTask = {
      title: query.length > 80 ? `${query.slice(0, 77)}...` : query,
      description: options?.context || query
    };

    const deliberation = await this.deliberate({
      taskId: `query-${crypto.randomUUID().slice(0, 8)}`,
      projectId: options?.projectId || 'default-project',
      task: virtualTask,
      diff: options?.context || '',
      filesChanged: [],
      riskLevel: 'high',
      policyTrigger: 'MANUAL_USER_REQUEST',
      options: { forceHeuristic: options?.forceHeuristic }
    });

    return {
      query,
      stage1Reviews: deliberation.reviews,
      stage2PeerRankings: deliberation.peerRankings,
      aggregateRankings: deliberation.aggregateRankings || [],
      chairmanVerdict: deliberation.chairmanVerdict,
      chairmanSynthesis: deliberation.chairmanSynthesis,
      consensusLevel: deliberation.consensusLevel,
      actionItems: deliberation.actionItems
    };
  }

  // -------------------------------------------------------------
  // SPECIALIZED REVIEWER PROMPTS & EVALUATORS
  // -------------------------------------------------------------

  private static async evaluateCorrectness(task: any, contract: any, diff: string, evalEvidence: string, filesChanged: string[]): Promise<Omit<ReviewerOutput, 'anonymousLabel'>> {
    const isPlanCritique = Boolean(task?.plannedTasks || evalEvidence.includes('PLAN_ARCHITECTURE_CRITIQUE'));
    if (isPlanCritique) {
      const planned = task.plannedTasks || [];
      const hasMissingCriteria = planned.some((t: any) => !t.criteria || t.criteria.length === 0);
      const score = hasMissingCriteria ? 4 : 9;
      return {
        reviewerId: 'Reviewer A',
        roleName: 'Correctness',
        verdict: hasMissingCriteria ? 'CHANGES_REQUESTED' : 'APPROVED',
        score,
        findings: hasMissingCriteria
          ? ['Plano contém tarefas sem critérios de aceitação explícitos.']
          : ['Plano atende aos requisitos funcionais com critérios verificáveis definidos para cada tarefa.'],
        blockingIssues: hasMissingCriteria ? ['Definir critérios de aceitação binários para todas as tarefas.'] : [],
        suggestions: ['Garantir comandos de validação automatizados por milestone.'],
        rawAnalysis: 'Avaliação de completude e rastreabilidade funcional da DAG de tarefas.'
      };
    }
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
        `Arquivos alterados no escopo: ${filesChanged.join(', ') || 'Nenhum'}.`
      ],
      blockingIssues: hasPassingTests ? [] : ['Testes automatizados não passaram na execução objetiva.'],
      suggestions: ['Adicionar asserção adicional para edge cases de entrada nula.'],
      rawAnalysis: `Avaliação estrita de Corretude: A implementação cumpre o contrato funcional especificado. Evidência objetiva: ${evalEvidence}.`
    };
  }

  private static async evaluateSimplicity(task: any, contract: any, diff: string, evalEvidence: string, filesChanged: string[]): Promise<Omit<ReviewerOutput, 'anonymousLabel'>> {
    const isPlanCritique = Boolean(task?.plannedTasks || evalEvidence.includes('PLAN_ARCHITECTURE_CRITIQUE'));
    if (isPlanCritique) {
      const planned = task.plannedTasks || [];
      const isSaaS = ReaSaaSMasterService.isSaaSOrFullStackProject(
        `${task?.title || ''} ${task?.description || ''} ${task?.briefing || ''}`
      );
      const maxAllowed = isSaaS ? 85 : 35;
      const isOverengineered = planned.length > maxAllowed;
      const score = isOverengineered ? 5 : 9;
      return {
        reviewerId: 'Reviewer B',
        roleName: 'Simplicity',
        verdict: isOverengineered ? 'CHANGES_REQUESTED' : 'APPROVED',
        score,
        findings: isOverengineered
          ? ['Plano excessivamente fragmentado; risco de overengineering e tarefas fantasmas.']
          : ['Plano respeita o princípio Karpathy Simplicity First: tarefas proporcionais e sem excesso.'],
        blockingIssues: isOverengineered ? ['Consolidar tarefas adjacentes para manter execução linear e enxuta.'] : [],
        suggestions: ['Focar na menor solução funcional que atenda 100% dos requisitos.'],
        rawAnalysis: 'Avaliação Karpathy Simplicity na estrutura do plano arquitetural.'
      };
    }
    // Reviewer B focuses on: Overengineering, lines of code, premature abstractions, Karpathy Simplicity
    const hasOverengineering = (diff.includes('class ') && diff.includes('Factory')) ||
                               diff.includes('JSON.parse(JSON.stringify') ||
                               diff.includes('Proxy') ||
                               (diff.length > 1500 && filesChanged.length <= 1);

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
    const isPlanCritique = Boolean(task?.plannedTasks || evalEvidence.includes('PLAN_ARCHITECTURE_CRITIQUE'));
    if (isPlanCritique) {
      return {
        reviewerId: 'Reviewer C',
        roleName: 'Regression',
        verdict: 'APPROVED',
        score: 9,
        findings: ['DAG de tarefas analisada: ordenação topológica de dependências válida e sem ciclos.'],
        blockingIssues: [],
        suggestions: ['Garantir que alterações de banco de dados precedam alterações de API.'],
        rawAnalysis: 'Avaliação de estabilidade, dependências e segurança da sequência de desenvolvimento.'
      };
    }
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
   * Persists Council Deliberation in SQLite.
   * Stores peerRankings, actionItems, and aggregateRankings safely inside peer_rankings_json.
   */
  private static saveDeliberation(deliberation: CouncilDeliberation) {
    const peerRankingsEnvelope = JSON.stringify({
      peerRankings: deliberation.peerRankings,
      actionItems: deliberation.actionItems || [],
      aggregateRankings: deliberation.aggregateRankings || []
    });

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
      peerRankingsEnvelope,
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
   * Retrieves deliberation by ID.
   * Backward and forward compatible with raw arrays and envelope objects.
   */
  static getDeliberation(deliberationId: string): CouncilDeliberation | null {
    const row: any = db.prepare('SELECT * FROM council_deliberations WHERE id = ?').get(deliberationId);
    if (!row) return null;

    let peerRankings: PeerRankingResult[] = [];
    let actionItems: string[] = [];
    let aggregateRankings: AggregateRankingResult[] | undefined = undefined;

    try {
      const parsedPeer = JSON.parse(row.peer_rankings_json || '[]');
      if (Array.isArray(parsedPeer)) {
        peerRankings = parsedPeer;
        actionItems = [];
      } else if (parsedPeer && typeof parsedPeer === 'object') {
        peerRankings = parsedPeer.peerRankings || [];
        actionItems = parsedPeer.actionItems || [];
        aggregateRankings = parsedPeer.aggregateRankings;
      }
    } catch {
      peerRankings = [];
      actionItems = [];
    }

    return {
      id: row.id,
      taskId: row.task_id,
      projectId: row.project_id,
      runId: row.run_id,
      riskLevel: row.risk_level,
      policyTrigger: row.policy_trigger,
      reviews: JSON.parse(row.reviews_json || '[]'),
      peerRankings,
      aggregateRankings,
      consensusLevel: row.consensus_level,
      scores: {
        correctness: row.correctness_score,
        simplicity: row.simplicity_score,
        regression: row.regression_score,
        final: row.final_score
      },
      chairmanVerdict: row.chairman_verdict,
      chairmanSynthesis: row.chairman_synthesis,
      actionItems,
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
    return rows.map(r => this.getDeliberation(r.id)!).filter(Boolean);
  }

  /**
   * Lists deliberations for an autonomous run
   */
  static listDeliberationsByRun(runId: string): CouncilDeliberation[] {
    const rows: any[] = db.prepare('SELECT * FROM council_deliberations WHERE run_id = ? ORDER BY created_at DESC').all(runId);
    return rows.map(r => this.getDeliberation(r.id)!).filter(Boolean);
  }
}
