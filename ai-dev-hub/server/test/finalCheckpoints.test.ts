import test from 'node:test';
import assert from 'node:assert';
import { MarketDiscoveryService } from '../src/marketDiscoveryService.js';
import { ProjectLivingSpecService } from '../src/projectLivingSpecService.js';
import { SkillRouter } from '../src/skillRouter.js';
import { PromptArchitectureService } from '../src/promptArchitectureService.js';

test('1. YouTube Viral com termos de pagamento/pix/assinatura nao cai em fintech e usa youtube_viral_intelligence', () => {
  const briefing = 'Construir SaaS YouTube Viral Search com gateway de pagamentos PushinPay PIX, login Supabase, Turnstile e analise de video';
  const profile = MarketDiscoveryService.inferDomainProfile(briefing);
  assert.strictEqual(profile.domainName.includes('YouTube'), true, 'Domain name should be YouTube, got: ' + profile.domainName);

  const blueprint = ProjectLivingSpecService.resolveDomainBlueprint(briefing);
  assert.strictEqual(blueprint.domainKey, 'youtube_viral_intelligence', 'Blueprint domain key should be youtube_viral_intelligence, got: ' + blueprint.domainKey);
});

test('2. Zero MRR em CONTEUDO.md, BACKEND.md e JORNADAS.md para domínios que não sejam contabilidade/fintech pura', () => {
  const briefing = 'Construir SaaS YouTube Viral Search com gateway de pagamentos PushinPay PIX, login Supabase, Turnstile e analise de video';
  const blueprint = ProjectLivingSpecService.resolveDomainBlueprint(briefing);

  const conteudo = ProjectLivingSpecService.generateConteudoSpec('ViralYT', briefing, blueprint);
  const backend = ProjectLivingSpecService.generateBackendSpec('ViralYT', briefing, blueprint);
  const jornadas = ProjectLivingSpecService.generateJornadasSpec('ViralYT', briefing, blueprint);

  assert.strictEqual(/\bMRR\b/.test(conteudo), false, 'CONTEUDO.md should not contain MRR');
  assert.strictEqual(/\bMRR\b/.test(backend), false, 'BACKEND.md should not contain MRR');
  assert.strictEqual(/\bMRR\b/.test(jornadas), false, 'JORNADAS.md should not contain MRR');
});

test('3. Entidades canônicas de youtube_viral_intelligence em BACKEND.md (headline_original, transcript_hook_0_30s, thumbnail_hd_url, workflow_runs)', () => {
  const briefing = 'Construir SaaS YouTube Viral Search';
  const blueprint = ProjectLivingSpecService.resolveDomainBlueprint(briefing);
  const backend = ProjectLivingSpecService.generateBackendSpec('ViralYT', briefing, blueprint);

  assert.strictEqual(backend.includes('headline_original'), true, 'BACKEND.md must include headline_original');
  assert.strictEqual(backend.includes('hook_category'), true, 'BACKEND.md must include hook_category');
  assert.strictEqual(backend.includes('ctr_score'), true, 'BACKEND.md must include ctr_score');
  assert.strictEqual(backend.includes('transcript_hook_0_30s'), true, 'BACKEND.md must include transcript_hook_0_30s');
  assert.strictEqual(backend.includes('thumbnail_hd_url'), true, 'BACKEND.md must include thumbnail_hd_url');
  assert.strictEqual(backend.includes('workflow_runs'), true, 'BACKEND.md must include workflow_runs');
  assert.strictEqual(backend.includes('channels'), true, 'BACKEND.md must include channels');
  assert.strictEqual(backend.includes('viral_videos'), true, 'BACKEND.md must include viral_videos');
});

test('4. PromptArchitectureService estrutura as 2 Grandes Fases Macros GT-1 a GT-12', () => {
  const bpPrompt = PromptArchitectureService.buildArchitecturalBlueprintPrompt({
    briefing: 'Criar SaaS YouTube Viral',
    projectName: 'ViralYT',
    projectId: 'p1',
    projectPath: 'C:/fake'
  });
  assert.strictEqual(bpPrompt.prompt.includes('FASE MACRO 1: BACKEND 100% FUNCIONAL'), true, 'Prompt must include FASE MACRO 1');
  assert.strictEqual(bpPrompt.prompt.includes('FASE MACRO 2: REFINAMENTO PROFUNDO DE FRONTEND (TALLY + N8N + ATTIO'), true, 'Prompt must include FASE MACRO 2');

  const expPrompt = PromptArchitectureService.buildMajorTaskExpansionPrompt({
    majorTask: { code: 'GT-9', title: 'Inputs, Busca e Modais' },
    projectName: 'ViralYT',
    projectId: 'p1',
    projectPath: 'C:/fake'
  });
  assert.strictEqual(expPrompt.prompt.includes('tally-form-block-ux_rea_blueprint.md'), true, 'Expansion prompt must include tally blueprint reference');
});

test('5. SkillRouter injeta prioritariamente os 3 blueprints REA e docs SaaS com limite de até 6 arquivos', () => {
  const taskTally = { title: 'Criar modal de checkout PIX e formulario com inputs zero friccao' };
  const resTally = SkillRouter.resolvePhysicalSkillsForTask(taskTally, 'FRONTEND_SPECIALIST');
  assert.strictEqual(resTally.files.some(f => f.includes('tally-form-block-ux_rea_blueprint.md')), true, 'Must include tally blueprint');
  assert.strictEqual(resTally.files.length <= 6, true, 'Max 6 files');

  const taskN8n = { title: 'Construir esteira de extracao de transcricao e headline com workflow pipeline' };
  const resN8n = SkillRouter.resolvePhysicalSkillsForTask(taskN8n, 'FRONTEND_SPECIALIST');
  assert.strictEqual(resN8n.files.some(f => f.includes('n8n-workflow-automation_rea_blueprint.md')), true, 'Must include n8n blueprint');
  assert.strictEqual(resN8n.files.length <= 6, true, 'Max 6 files');

  const taskAttio = { title: 'Implementar data grid com ordenacao de videos virais e filtros empilhaveis' };
  const resAttio = SkillRouter.resolvePhysicalSkillsForTask(taskAttio, 'FRONTEND_SPECIALIST');
  assert.strictEqual(resAttio.files.some(f => f.includes('attio-crm-data-engine_rea_blueprint.md')), true, 'Must include attio blueprint');
  assert.strictEqual(resAttio.files.length <= 6, true, 'Max 6 files');

  const taskAuth = { title: 'Configurar autenticacao Supabase Auth e anti-bot Cloudflare Turnstile' };
  const resAuth = SkillRouter.resolvePhysicalSkillsForTask(taskAuth, 'BACKEND_API');
  assert.strictEqual(resAuth.files.some(f => f.includes('supabase_knowledge_ready.md')), true, 'Must include supabase docs');
  assert.strictEqual(resAuth.files.some(f => f.includes('cloudflare_knowledge_ready.md')), true, 'Must include cloudflare docs');
  assert.strictEqual(resAuth.files.length <= 6, true, 'Max 6 files');
});
