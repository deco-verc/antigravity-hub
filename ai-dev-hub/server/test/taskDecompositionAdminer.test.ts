import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HierarchicalOrchestrationService } from '../src/hierarchicalOrchestrationService.js';
import { ProjectChatService } from '../src/projectChatService.js';

const ADMINER_PRO_BRIEFING = `
# Projeto AdMiner Pro (Viral Search)

## ETAPA 1: Tipagem e Contrato de Dados (types/ad.ts)
Criar contrato de dados completo para os anúncios minerados:
- id: string
- pageId: string
- pageName: string
- pageProfilePictureUrl: string
- adArchiveId: string
- adCreativeBody: string
- adCreativeLinkCaption: string
- adCreativeLinkDescription: string
- adCreativeLinkTitle: string
- adDeliveryStartTime: string
- adSnapshotUrl: string
- videoSdUrl: string
- videoHdUrl: string
- videoPreviewImageUrl: string
- publisherPlatforms: string[]
- estimatedSpend: number
- estimatedImpressions: number

## ETAPA 2: Backend — Rota de Mineração e Heurística (app/api/mine/route.ts)
Criar rota de mineração POST /api/mine com integração ScrapeCreators e fallback mock realista.
- Se a variável de ambiente SCRAPECREATORS_API_KEY existir, faça o GET para https://api.scrapecreators.com/v1/facebook/ads
- Caso a API retorne erro ou a chave não exista, retorne fallback de 20 anúncios mock realistas
- Heurísticas de detecção de checkout de alta conversão (Kiwify, Hotmart, Eduzz)
- Filtros por data de veiculação e plataformas

## ETAPA 3: Backend — Proxy de Download Direto (app/api/download/route.ts)
Criar rota para streaming de vídeo seguro e download direto de criativos.
- Rota GET /api/download?url=...
- Streaming de vídeo via proxy sem bloquear a thread principal
- Tratamento de cabeçalhos Content-Disposition e Content-Type

## ETAPA 4: Frontend — Dashboard e Componentes de Mineração
### 4.1. Barra de Busca + Presets Rápidos (components/SearchFilters.tsx)
- Input de busca com debounce
- Presets rápidos de 1 clique: 🔥 Super Escalados, 🥝 Ofertas Kiwify, 📦 Dropshipping Físico
- Filtros de ordenação por tempo de veiculação e plataforma

### 4.2. Card do Anúncio Minerado (components/AdCard.tsx)
- Preview de vídeo com player HTML5 responsivo
- Botão Baixar Vídeo integrado à rota /api/download
- Exibição de métricas: dias ativo, plataformas e link original do anúncio

## ETAPA 5: Página Principal e Estado Reativo (app/page.tsx)
Integrar tudo na home do AdMiner Pro:
- Grid responsivo de cards com skeleton loading
- Gerenciamento de estado de mineração, paginação e drawer de detalhes
`;

test('Decomposição Estruturada Fiel ao Prompt (AdMiner Pro): 6 a 8 tarefas sem picotar bullets', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adminer-plan-test-'));

  try {
    const plannedTasks = HierarchicalOrchestrationService.generateMultiPassPlannedTasks({
      briefing: ADMINER_PRO_BRIEFING,
      projectPath: tempDir,
      projectName: 'Viral Search'
    });

    // 1. Número total de tarefas deve ser cirúrgico e coeso (6 a 8 tarefas no total)
    assert.ok(
      plannedTasks.length >= 6 && plannedTasks.length <= 8,
      `Esperado entre 6 e 8 tarefas coesas, obteve ${plannedTasks.length}`
    );

    // 2. Proibição de picotar bullets: nenhum campo individual de interface vira título de tarefa
    const forbiddenFieldTitles = ['id: string', 'pageId: string', 'pageName: string', 'adSnapshotUrl: string'];
    for (const t of plannedTasks) {
      for (const field of forbiddenFieldTitles) {
        assert.ok(
          !t.title.includes(field),
          `Tarefa "${t.title}" contém bullet picotado indevidamente ("${field}")`
        );
      }
      // Nenhuma tarefa com sufixo picotador de ${projectName}
      assert.ok(
        !t.title.includes('de Viral Search'),
        `Título "${t.title}" contém concatenação indevida "de Viral Search"`
      );
      // Nenhum título truncado no meio de palavra
      assert.ok(
        !t.title.includes('faça o GET para h'),
        `Título "${t.title}" foi truncado no meio da frase`
      );
    }

    // 3. Etapa 1 deve preservar types/ad.ts completo com todos os campos na description
    const stage1Task = plannedTasks.find(t =>
      (t.expectedFiles || []).some(f => f.includes('types/ad.ts')) ||
      t.title.toLowerCase().includes('types/ad.ts') ||
      t.title.toLowerCase().includes('tipagem')
    );
    assert.ok(stage1Task, 'Etapa 1 (types/ad.ts) deve estar presente como tarefa coesa');
    assert.ok(
      stage1Task.description.includes('id: string') &&
      stage1Task.description.includes('videoPreviewImageUrl: string') &&
      stage1Task.description.includes('estimatedImpressions: number'),
      'A descrição da tarefa de tipagem deve preservar TODOS os campos da interface sem perder nenhum bullet'
    );

    // 4. Etapa 4 deve conter ambas as subseções: SearchFilters.tsx E AdCard.tsx
    const searchFiltersTask = plannedTasks.find(t =>
      (t.expectedFiles || []).some(f => f.includes('SearchFilters.tsx')) ||
      t.title.includes('SearchFilters.tsx') ||
      t.title.includes('Barra de Busca')
    );
    const adCardTask = plannedTasks.find(t =>
      (t.expectedFiles || []).some(f => f.includes('AdCard.tsx')) ||
      t.title.includes('AdCard.tsx') ||
      t.title.includes('Card do Anúncio')
    );

    assert.ok(searchFiltersTask, 'Subseção 4.1 (components/SearchFilters.tsx) deve gerar sua própria tarefa');
    assert.ok(adCardTask, 'Subseção 4.2 (components/AdCard.tsx) NÃO pode ser perdida ou omitida');
    assert.ok(
      (adCardTask.expectedFiles || []).some(f => f.includes('AdCard.tsx')),
      'AdCard.tsx deve estar explicitamente mapeado em expectedFiles'
    );

    // 5. Tarefa final deve ser a Homologação e Build integrado
    const lastTask = plannedTasks[plannedTasks.length - 1];
    assert.ok(
      lastTask.title.toLowerCase().includes('validar compilação') ||
      lastTask.title.toLowerCase().includes('tsc / next build') ||
      lastTask.title.toLowerCase().includes('build') ||
      lastTask.title.toLowerCase().includes('homologação'),
      `Última tarefa deve ser de Homologação/Build, obteve: "${lastTask.title}"`
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Modo de Planejamento Conversacional Interativo: gera e persiste proposta sem disparar Run imediatamente', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'interactive-plan-test-'));

  try {
    const proposal = await ProjectChatService.generateInteractivePlanProposal({
      projectId: 'proj-interactive-1',
      projectPath: tempDir,
      projectName: 'Viral Search',
      briefing: ADMINER_PRO_BRIEFING
    });

    // 1. Proposta estruturada
    assert.ok(proposal.pendingPlan, 'Deve retornar objeto pendingPlan');
    assert.ok(
      proposal.pendingPlan.proposedTasks.length >= 6 && proposal.pendingPlan.proposedTasks.length <= 8,
      `Proposta interativa deve conter entre 6 e 8 tarefas, obteve ${proposal.pendingPlan.proposedTasks.length}`
    );

    // 2. PENDING_PLAN.json persistido no disco
    const planPath = path.join(tempDir, '.ai-dev-hub', 'PENDING_PLAN.json');
    assert.ok(fs.existsSync(planPath), 'PENDING_PLAN.json deve existir em .ai-dev-hub/');

    // 3. Leitura e limpeza do plano pendente
    const readBack = ProjectChatService.getPendingPlan(tempDir);
    assert.ok(readBack, 'getPendingPlan deve recuperar o plano salvo');
    assert.equal(readBack.projectName, 'Viral Search');

    ProjectChatService.clearPendingPlan(tempDir);
    assert.ok(!fs.existsSync(planPath), 'clearPendingPlan deve remover PENDING_PLAN.json após aprovação');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
