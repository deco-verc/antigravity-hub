import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../src/db.js';
import {
  ModelRegistry,
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_CANONICAL_NAME,
  DEFAULT_INTELLIGENCE_LEVEL
} from '../src/modelRegistry.js';
import { GeminiSupervisorProvider } from '../src/geminiSupervisorProvider.js';
import { AgentApiGateway } from '../src/agentApiGateway.js';
import { AgentSessionManager } from '../src/agentSessionManager.js';
import { ConversationManager } from '../src/conversationManager.js';
import { AntigravityProvider } from '../src/antigravityProvider.js';

function createTestProject(name?: string): { id: string; path: string } {
  const id = 'proj-' + randomUUID();
  const projPath = 'C:\\test\\projects\\' + id;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO projects (id, name, path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, name || id, projPath, now, now);
  return { id, path: projPath };
}

function createTestProfile(name?: string): string {
  const id = 'profile-' + randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO account_profiles (id, display_name, profile_name, auth_status, created_at, updated_at)
    VALUES (?, ?, ?, 'AUTHENTICATED', ?, ?)
  `).run(id, name || 'Test User', id, now, now);
  return id;
}

// ---------------------------------------------------------------------------
// 1. Novos projetos herdam modelo 'flash' e nível 'HIGH'
// ---------------------------------------------------------------------------
test('1. Novos projetos herdam modelo flash e nivel HIGH por padrao do sistema', () => {
  // Constantes de sistema
  assert.equal(DEFAULT_MODEL_ID, 'flash');
  assert.equal(DEFAULT_MODEL_CANONICAL_NAME, 'Gemini 3.8 Flash');
  assert.equal(DEFAULT_INTELLIGENCE_LEVEL, 'HIGH');

  // Metodo getDefaultConfig()
  const def = ModelRegistry.getDefaultConfig();
  assert.equal(def.modelId, 'flash');
  assert.equal(def.canonicalName, 'Gemini 3.8 Flash');
  assert.equal(def.intelligenceLevel, 'HIGH');

  // Projeto recem-criado sem preferencias salvas
  const project = createTestProject('Novo Projeto Padrao');
  const resolved = ModelRegistry.resolveModelConfig({ projectId: project.id });
  assert.equal(resolved.modelId, 'flash');
  assert.equal(resolved.canonicalName, 'Gemini 3.8 Flash');
  assert.equal(resolved.intelligenceLevel, 'HIGH');

  // Model ID direto para o novo projeto
  const modelId = ModelRegistry.resolveModel({ projectId: project.id });
  assert.equal(modelId, 'flash');
});

// ---------------------------------------------------------------------------
// 2. Novas tarefas recebem os mesmos padrões
// ---------------------------------------------------------------------------
test('2. Novas tarefas herdam flash e HIGH quando model_tier nao for especificado', () => {
  const project = createTestProject('Projeto Tarefas');

  // Tarefa sem preferencia explicita (undefined / auto)
  const taskConfig = ModelRegistry.resolveModelConfig({
    projectId: project.id,
    preference: undefined
  });
  assert.equal(taskConfig.modelId, 'flash');
  assert.equal(taskConfig.intelligenceLevel, 'HIGH');
  assert.equal(taskConfig.canonicalName, 'Gemini 3.8 Flash');

  const taskConfigAuto = ModelRegistry.resolveModelConfig({
    projectId: project.id,
    preference: 'auto'
  });
  assert.equal(taskConfigAuto.modelId, 'flash');
  assert.equal(taskConfigAuto.intelligenceLevel, 'HIGH');
});

// ---------------------------------------------------------------------------
// 3. Supervisor e Workers propagam configurações corretamente ('flash' + 'HIGH')
// ---------------------------------------------------------------------------
test('3. Supervisor e Workers propagam flash e HIGH em tempo de execucao', () => {
  const project = createTestProject('Projeto Supervisor Worker');

  // Configuracao do Supervisor
  const supervisorConfig = ModelRegistry.resolveModelConfig({
    role: 'supervisor',
    projectId: project.id
  });
  assert.equal(supervisorConfig.modelId, 'flash');
  assert.equal(supervisorConfig.intelligenceLevel, 'HIGH');

  // Provedor do Supervisor recebe e preserva HIGH
  const provider = new GeminiSupervisorProvider('flash', undefined, undefined, project.id, 'HIGH');
  const evidence = provider.getExecutionEvidence();
  assert.equal(evidence.requestedIntelligence, 'HIGH');
  assert.equal(evidence.requestedModel, 'flash');

  // Builder (Worker)
  const builderConfig = ModelRegistry.resolveModelConfig({
    role: 'builder',
    projectId: project.id
  });
  assert.equal(builderConfig.modelId, 'flash');
  assert.equal(builderConfig.intelligenceLevel, 'HIGH');

  // Reviewer
  const reviewerConfig = ModelRegistry.resolveModelConfig({
    role: 'reviewer',
    projectId: project.id
  });
  assert.equal(reviewerConfig.modelId, 'flash');
  assert.equal(reviewerConfig.intelligenceLevel, 'HIGH');
});

// ---------------------------------------------------------------------------
// 4. Serviços internos não ignoram a configuração central
// ---------------------------------------------------------------------------
test('4. Servicos internos consultam ModelRegistry e nao possuem fallbacks divergentes', async () => {
  const project = createTestProject('Projeto Servicos Internos');

  // AgentSessionManager
  const sessionResult = await AgentSessionManager.getOrCreateAgentSession(
    project.id,
    'SUPERVISOR'
  );
  assert.ok(sessionResult?.session);
  assert.equal(sessionResult.session.role, 'SUPERVISOR');

  // ConversationManager
  const profileId = createTestProfile('Perfil Conv Servicos');
  const { conversationId } = await ConversationManager.getOrCreateConversation({
    projectId: project.id,
    accountProfileId: profileId,
    role: 'builder'
  });
  const convMetadata = AgentApiGateway.getConversationMetadata(conversationId);
  assert.equal(convMetadata.model, 'flash');

  // AntigravityProvider startAgent resolve via ModelRegistry
  const resolvedProviderModel = ModelRegistry.resolveModel({ preference: undefined });
  assert.equal(resolvedProviderModel, 'flash');

  // AI Council padrao agora e flash HIGH, nao pro hardcoded
  const councilModel = ModelRegistry.resolveModel({ role: 'council' });
  assert.equal(councilModel, 'flash');
});

// ---------------------------------------------------------------------------
// 5. Preferências persistem através de reinicialização (SQLite model_preferences)
// ---------------------------------------------------------------------------
test('5. Preferencias persistem no SQLite incluindo a coluna intelligence_level', () => {
  const project = createTestProject('Projeto Persistencia');
  const profileId = createTestProfile('Perfil Persistencia');

  // Salvar preferencia com intelligence_level HIGH
  ModelRegistry.setPreference({
    role: 'supervisor',
    modelId: 'pro',
    accountProfileId: profileId,
    projectId: project.id,
    intelligenceLevel: 'HIGH'
  });

  // Consultar diretamente do banco de dados SQLite
  const row = db.prepare(`
    SELECT role, model_id, intelligence_level
    FROM model_preferences
    WHERE account_profile_id = ? AND project_id = ? AND role = 'supervisor'
  `).get(profileId, project.id) as any;

  assert.ok(row, 'Registro deve existir no SQLite');
  assert.equal(row.model_id, 'pro');
  assert.equal(row.intelligence_level, 'HIGH');

  // Recuperar via ModelRegistry.getPreferences
  const prefs = ModelRegistry.getPreferences(profileId, project.id);
  assert.equal(prefs.supervisor, 'pro');
  assert.equal(prefs.intelligence_level, 'HIGH');

  // Resolver config usando a preferencia persistida
  const resolved = ModelRegistry.resolveModelConfig({
    role: 'supervisor',
    projectId: project.id,
    accountProfileId: profileId
  });
  assert.equal(resolved.modelId, 'pro');
  assert.equal(resolved.intelligenceLevel, 'HIGH');
  assert.equal(resolved.canonicalName, 'Gemini Pro');
});

// ---------------------------------------------------------------------------
// 6. Substituições explícitas só substituem padrões conforme as regras definidas
// ---------------------------------------------------------------------------
test('6. Substituicoes explicitas por papel/projeto respeitam fronteiras e nao vazam', () => {
  const projectA = createTestProject('Projeto A');
  const projectB = createTestProject('Projeto B');
  const profile = createTestProfile('Perfil Escopo');

  // Override apenas para builder no Projeto A
  ModelRegistry.setPreference({
    role: 'builder',
    modelId: 'pro',
    accountProfileId: profile,
    projectId: projectA.id
  });

  // No Projeto A: builder vira pro, mas supervisor continua flash
  const builderA = ModelRegistry.resolveModelConfig({
    role: 'builder',
    projectId: projectA.id,
    accountProfileId: profile
  });
  assert.equal(builderA.modelId, 'pro');

  const supervisorA = ModelRegistry.resolveModelConfig({
    role: 'supervisor',
    projectId: projectA.id,
    accountProfileId: profile
  });
  assert.equal(supervisorA.modelId, 'flash');
  assert.equal(supervisorA.intelligenceLevel, 'HIGH');

  // No Projeto B: builder permanece flash (sem vazamento de escopo)
  const builderB = ModelRegistry.resolveModelConfig({
    role: 'builder',
    projectId: projectB.id,
    accountProfileId: profile
  });
  assert.equal(builderB.modelId, 'flash');
  assert.equal(builderB.intelligenceLevel, 'HIGH');

  // Reset para 'auto' restaura o padrao do sistema
  ModelRegistry.setPreference({
    role: 'builder',
    modelId: 'auto',
    accountProfileId: profile,
    projectId: projectA.id
  });
  const builderAReset = ModelRegistry.resolveModelConfig({
    role: 'builder',
    projectId: projectA.id,
    accountProfileId: profile
  });
  assert.equal(builderAReset.modelId, 'flash');
  assert.equal(builderAReset.intelligenceLevel, 'HIGH');
});

// ---------------------------------------------------------------------------
// 7. Indisponibilidade do modelo ou HIGH comunica sem fallback silencioso
// ---------------------------------------------------------------------------
test('7. Modelos invalidos ou niveis incorretos falham com erro sem fallback silencioso', () => {
  // Modelo inexistente deve lançar MODEL_UNAVAILABLE imediatamente
  assert.throws(
    () => ModelRegistry.resolveModel({ preference: 'gemini-ultra' as any }),
    /MODEL_UNAVAILABLE/
  );

  assert.throws(
    () => ModelRegistry.resolveModel({ preference: 'gemini-3.8-flash-high' as any }),
    /MODEL_UNAVAILABLE/
  );

  assert.throws(
    () => ModelRegistry.resolveModel({ preference: 'claude-3-5-sonnet' as any }),
    /MODEL_UNAVAILABLE/
  );

  // Nivel de inteligencia invalido
  assert.throws(
    () => ModelRegistry.resolveModelConfig({ requestedIntelligence: 'ULTRA_HIGH' as any }),
    /INVALID_INTELLIGENCE_LEVEL/
  );

  assert.throws(
    () => ModelRegistry.setPreference({ modelId: 'flash', intelligenceLevel: 'INVALID' as any }),
    /INVALID_INTELLIGENCE_LEVEL/
  );
});

// ---------------------------------------------------------------------------
// 8. Interface / evidência não declara configuração efetiva sem prova de runtime
// ---------------------------------------------------------------------------
test('8. Evidencias e catalogo informam TIER com exactVariant null e verificacao pendente', () => {
  const catalog = ModelRegistry.discoverModels();
  assert.ok(catalog.length >= 3);

  const flashEntry = catalog.find(m => m.id === 'flash');
  assert.ok(flashEntry, 'Entrada flash deve existir no catalogo');
  assert.equal(flashEntry.displayName, 'Gemini 3.8 Flash');
  assert.equal(flashEntry.intelligenceLevel, 'HIGH');
  assert.equal(flashEntry.isSystemDefault, true);
  assert.equal(flashEntry.selectionScope, 'TIER');
  assert.equal(flashEntry.exactVariant, null);
  assert.equal(flashEntry.accountAvailabilityVerified, false);

  // Evidencia do GeminiSupervisorProvider
  const project = createTestProject('Projeto Evidencia');
  const provider = new GeminiSupervisorProvider('flash', undefined, undefined, project.id);
  const ev = provider.getExecutionEvidence();
  assert.equal(ev.requestedModel, 'flash');
  assert.equal(ev.requestedIntelligence, 'HIGH');
  assert.equal(ev.actualModelVerified, false);
  assert.equal(ev.fallbackReason, 'ACTUAL_MODEL_UNAVAILABLE');
});

// ---------------------------------------------------------------------------
// 9. A configuração atinge a chamada física do provedor (agentapi new-conversation --model=flash)
// ---------------------------------------------------------------------------
test('9. A chamada fisica para criacao de conversa recebe rigorosamente --model=flash', async () => {
  const project = createTestProject('Projeto Gateway Fisico');
  const modelToUse = ModelRegistry.resolveModel({ role: 'builder', projectId: project.id });
  assert.equal(modelToUse, 'flash');

  // Invocar AgentApiGateway.newConversation
  const convId = await AgentApiGateway.newConversation({
    model: modelToUse,
    title: 'Teste de Invocacao de Modelo Fisico',
    prompt: 'Verificar argumento de modelo',
    projectId: project.id,
    role: 'builder'
  });

  assert.ok(convId, 'Conversa deve ser criada com sucesso');

  // No provedor Mock padrão do teste, verificar se o modelo registrado é exatamente 'flash'
  const meta = AgentApiGateway.getConversationMetadata(convId);
  assert.equal(meta.model, 'flash');
});
