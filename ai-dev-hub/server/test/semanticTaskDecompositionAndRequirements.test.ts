import test from 'node:test';
import assert from 'node:assert/strict';
import { HierarchicalOrchestrationService } from '../src/hierarchicalOrchestrationService.js';
import { GeminiSupervisorProvider } from '../src/geminiSupervisorProvider.js';

test('Reengenharia Semântica de Tarefas e Extração Fiel de Requisitos', async (t) => {
  const serviceFlowBriefing = `Construa do zero, de forma 100% autônoma nesta pasta, o micro-SaaS Full-Stack "ServiceFlow Subscriptions" — uma plataforma local de recorrência de prestação de serviços com definição dinâmica de planos, precificação, gerador de copy de vendas e checkout PIX simulado/integrado.

1. Stack Tecnológica e Padrões DOCSIMP (Plug-and-Play API Keys):
- Banco de Dados e Domínio: SQLite nativo (\`node:sqlite\`) salvo em \`./data/serviceflow.db\`.
- Camada de Integração / Auth / Pagamentos: Utilize os padrões da biblioteca DOCSIMP (Supabase para Auth/DB opcional, Upstash para rate limit, PushinPay para cobrança recorrente via PIX com QR Code, e Cloudflare Turnstile/R2 para segurança e upload).
- Modo Dual-Mode Obrigatório: O sistema DEVE funcionar 100% offline e sem chaves reais durante os testes, aplicando Graceful Mock Fallback automático quando variáveis como PUSHINPAY_TOKEN, SUPABASE_URL ou UPSTASH_REDIS_REST_URL estiverem vazias ou com placeholder no .env.
- Arquitetura de Testes: Testes automatizados robustos na pasta \`./test/\` usando \`node --test\`.

2. Requisitos Funcionais Obrigatórios:
- REQ-01 (Gestão de Planos e Preços): CRUD completo de pacotes de prestação de serviço (ex: Manutenção Mensal, Consultoria Semanal, Suporte Dedicado), definindo nome, descrição, valor em R$, periodicidade (mensal, trimestral, anual) e recursos inclusos.
- REQ-02 (Gerador e Gestor de Copy de Vendas): Módulo onde o usuário define o nicho, a dor do cliente e o gancho, e o sistema gera e armazena templates de copy de vendas estruturados focados em conversão de recorrência.
- REQ-03 (Assinaturas e Cobrança Recorrente PIX): Sistema de criação de faturas de recorrência vinculado a um cliente e um plano, integrando o fluxo de pagamento PIX (com geração de QR Code real via PushinPay ou fallback mock local se o token não estiver configurado).
- REQ-04 (Dashboard e Status de Integrações): Painel gerencial mostrando faturamento recorrente (MRR estimado), assinaturas ativas, faturas pendentes e o endpoint \`/api/system/integrations\` exibindo o status LIVE vs LOCAL_MOCK_FALLBACK de cada integração da DOCSIMP, acompanhado de um \`.env.example\` completo.
- REQ-05 (Suíte de Testes Automatizados E2E): Testes em \`./test/\` validando o cálculo de MRR, criação de planos, geração de faturas e os fallbacks da DOCSIMP.`;

  await t.test('1. Extração fiel dos requisitos explícitos do ServiceFlow (exatamente 5 requisitos, zero fantasmas)', () => {
    const rawReqs = HierarchicalOrchestrationService.extractRequirementsFromDescription(serviceFlowBriefing);
    assert.equal(rawReqs.length, 5, `Deve extrair exatamente 5 requisitos funcionais reais (obteve: ${rawReqs.length})`);

    const structured = HierarchicalOrchestrationService.extractStructuredRequirements(serviceFlowBriefing);
    assert.equal(structured.length, 5, 'Deve gerar exatamente 5 requisitos estruturados');

    const expectedCodes = ['REQ-1', 'REQ-2', 'REQ-3', 'REQ-4', 'REQ-5'];
    for (let i = 0; i < expectedCodes.length; i++) {
      assert.equal(structured[i].code, expectedCodes[i], `Código do requisito ${i + 1} deve ser normalizado para ${expectedCodes[i]}`);
    }

    // Validação de títulos funcionais reais
    assert.match(structured[0].title, /Gestão de Planos e Preços/i);
    assert.match(structured[1].title, /Gerador e Gestor de Copy de Vendas/i);
    assert.match(structured[2].title, /Assinaturas e Cobrança Recorrente PIX/i);
    assert.match(structured[3].title, /Dashboard e Status de Integrações/i);
    assert.match(structured[4].title, /Suíte de Testes Automatizados E2E/i);

    // Validação de ausência de fragmentos/fantasmas que o antigo split gerava
    const allTitlesJoined = structured.map(s => s.title).join(' ');
    assert.doesNotMatch(allTitlesJoined, /^\/data\/serviceflow/i, 'Não deve conter caminhos soltos como requisito');
    assert.ok(!structured.some(r => r.title.trim().toLowerCase() === 'trimestral'), 'Não deve conter "Trimestral" solto');
    assert.ok(!structured.some(r => r.title.trim().toLowerCase() === 'anual)'), 'Não deve conter "Anual)" solto');
    assert.ok(!structured.some(r => r.title.includes('Upstash para rate limit') && r.code !== 'REQ-1'), 'Não deve transformar stack DOCSIMP em requisito isolado');
  });

  await t.test('2. Fallback robusto para descrições em texto livre (limitado estritamente entre 2 e 12 requisitos)', () => {
    const freeTextWithBullets = `Desenvolva um sistema de agendamento de consultas médicas com:
- Cadastro e autenticação de médicos e pacientes
- Calendário interativo de disponibilidades
- Reserva e cancelamento de consultas
- Notificações de lembrete por e-mail e SMS
- Relatório mensal de atendimentos`;

    const reqs = HierarchicalOrchestrationService.extractRequirementsFromDescription(freeTextWithBullets);
    assert.ok(reqs.length >= 2 && reqs.length <= 12, `Deve conter entre 2 e 12 requisitos (obteve: ${reqs.length})`);
    assert.equal(reqs.length, 5, 'Deve extrair os 5 bullet points como requisitos');
    assert.match(reqs[0], /REQ-1: Cadastro e autenticação/i);

    // Texto descritivo contínuo sem bullets
    const narrativeText = `Construa uma plataforma simples de anotações colaborativas em tempo real. O sistema deve permitir autenticação via token simples. Cada usuário pode criar cadernos de notas e compartilhá-los com outros usuários. As alterações devem ser sincronizadas automaticamente no banco SQLite. Deve haver exportação de notas em Markdown e PDF.`;
    const narrativeReqs = HierarchicalOrchestrationService.extractRequirementsFromDescription(narrativeText);
    assert.ok(narrativeReqs.length >= 2 && narrativeReqs.length <= 12, `Deve conter entre 2 e 12 requisitos para narrativa (obteve: ${narrativeReqs.length})`);
  });

  await t.test('3. Subdivisão recursiva elimina duplicação de títulos (nunca gera "(Parte 1) (Parte 1)")', () => {
    const oversizedTask = {
      code: '2.1',
      title: 'Modelagem de dados SQLite nativa e repositórios relacionais',
      description: 'Módulo complexo de banco de dados com schema, repositórios, seeds e transações.',
      criteria: [
        'Criar tabela de planos',
        'Criar tabela de clientes',
        'Criar tabela de faturas',
        'Criar tabela de copies',
        'Implementar repositório de planos',
        'Implementar repositório de faturas',
        'Implementar repositório de copies',
        'Implementar transações atômicas de pagamento'
      ],
      allowedScope: [
        'src/db/schema.sql',
        'src/db/connection.ts',
        'src/repositories/plansRepo.ts',
        'src/repositories/invoicesRepo.ts',
        'src/repositories/copiesRepo.ts',
        'src/db/seeds.ts',
        'test/db/plansRepo.test.ts',
        'test/db/invoicesRepo.test.ts'
      ],
      verificationCommand: 'npm test'
    };

    const subdivided = HierarchicalOrchestrationService.validateAndSubdivideMicrotasks([oversizedTask], {
      subdivideOversized: true,
      maxSubdivisionDepth: 2
    });

    assert.ok(subdivided.length >= 4, `Deve subdividir em pelo menos 4 microtarefas (obteve: ${subdivided.length})`);

    for (const task of subdivided) {
      // Regra de Ouro: Nunca permitir duplicação recursiva de sufixos de partes
      assert.ok(
        !/\(Parte\s+[^)]+\)\s*\(Parte/i.test(task.title),
        `Título NÃO pode conter sufixos de partes duplicados: "${task.title}"`
      );
      assert.ok(
        !/\(Parte 1[^)]*\)\s*\(Parte 1/i.test(task.title),
        `Título NÃO pode conter "(Parte 1) (Parte 1)": "${task.title}"`
      );
      assert.ok(
        !/\(Parte 2[^)]*\)\s*\(Parte 2/i.test(task.title),
        `Título NÃO pode conter "(Parte 2) (Parte 2)": "${task.title}"`
      );
      assert.match(task.title, /\(Parte \d+(\.\d+)?: [^)]+\)/, `Título deve seguir padrão canônico de Parte: "${task.title}"`);
    }
  });

  await t.test('4. Tarefas de setup/scaffolding com múltiplos arquivos de configuração não são fatiadas indevidamente', () => {
    const scaffoldingTask = {
      code: '1.1',
      title: 'Scaffolding do projeto e configuração base',
      description: 'Configuração inicial do repositório, dependências, scripts e variáveis de ambiente.',
      criteria: [
        'Estrutura de diretórios criada',
        'Scripts de build e teste configurados'
      ],
      allowedScope: [
        'package.json',
        'tsconfig.json',
        '.gitignore',
        '.env.example',
        'README.md',
        'eslint.config.js',
        'vitest.config.ts'
      ],
      verificationCommand: 'npm test'
    };

    const result = HierarchicalOrchestrationService.validateAndSubdivideMicrotasks([scaffoldingTask], {
      subdivideOversized: true,
      maxSubdivisionDepth: 2
    });

    assert.equal(
      result.length,
      1,
      `Tarefa de setup com 7 arquivos de configuração NÃO deve ser fatiada em microtarefas vazias (obteve: ${result.length})`
    );
    assert.equal(result[0].title, 'Scaffolding do projeto e configuração base');
  });

  await t.test('5. Decomposição semântica em 3 camadas para tarefas monolíticas de Frontend/SPA', () => {
    const monolithicSpaTask = {
      code: '5.1',
      title: 'Desenvolver interface SPA completa com Dashboard, Planos, Copies e Checkout PIX',
      description: 'Construir a SPA unificada da aplicação com todas as telas, componentes, formulários e integração.',
      criteria: [
        'Estrutura visual responsiva com layout shell e design tokens',
        'Telas de planos, gerador de copies e dashboard com indicadores',
        'Formulário e modal de checkout PIX com feedback em tempo real',
        'Integração com API REST e tratamento de erros'
      ],
      allowedScope: ['index.html', 'style.css', 'app.js'],
      expectedFiles: ['index.html', 'style.css', 'app.js'],
      verificationCommand: 'npm test'
    };

    const result = HierarchicalOrchestrationService.validateAndSubdivideMicrotasks([monolithicSpaTask], {
      subdivideOversized: true,
      maxSubdivisionDepth: 2
    });

    assert.equal(result.length, 3, `Tarefa monolítica de frontend deve ser subdividida em 3 camadas semânticas (obteve: ${result.length})`);

    // Camada 1: Design System & Shell
    assert.match(result[0].title, /Camada 1: Design System, Shell/i);
    assert.equal(result[0].stageCode, 'ET-UI-SHELL');
    assert.deepEqual(result[0].dependencies, []);

    // Camada 2: Componentes de Domínio & Telas
    assert.match(result[1].title, /Camada 2: Componentes de Domínio, Telas e Formulários/i);
    assert.equal(result[1].stageCode, 'ET-UI-VIEWS');
    assert.deepEqual(result[1].dependencies, [result[0].title]);

    // Camada 3: Estado, APIs e Validação Visual
    assert.match(result[2].title, /Camada 3: Integração de Estado, APIs e Validação Visual/i);
    assert.equal(result[2].stageCode, 'ET-UI-LOGIC');
    assert.deepEqual(result[2].dependencies, [result[1].title]);
  });

  await t.test('6. Ativação padrão do Multi-Pass em produção no GeminiSupervisorProvider', async () => {
    const supervisor = new GeminiSupervisorProvider('flash');
    let calledTwoPass = false;

    // Monitora se planTwoPassHierarchy é acionado
    const origTwoPass = supervisor.planTwoPassHierarchy;
    supervisor.planTwoPassHierarchy = async () => {
      calledTwoPass = true;
      return [];
    };

    try {
      // 6a: Sem options (default em INITIAL_PLAN com briefing substancial) deve acionar Multi-Pass
      await supervisor.planTasks(
        'Construir sistema completo de gestão financeira com banco SQLite, relatórios e dashboard.',
        { name: 'FinanceApp', path: 'C:/fake/path', objective: 'Gestão Financeira' }
      );
      assert.equal(calledTwoPass, true, 'Deve acionar planTwoPassHierarchy por padrão em INITIAL_PLAN com briefing substancial');

      // 6b: Com multiPass: false deve desativar explicitamente
      calledTwoPass = false;
      let fellBackToLegacy = false;
      const origExtract = (supervisor as any).extractJsonArray;
      (supervisor as any).extractJsonArray = () => {
        fellBackToLegacy = true;
        return [];
      };

      try {
        await supervisor.planTasks(
          'Construir sistema simples',
          { name: 'SimpleApp', path: 'C:/fake/path', objective: 'Simple' },
          { multiPass: false }
        );
      } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "semanticTaskDecompositionAndRequirements.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:semanticTaskDecompositionAndRequirements.test]", err);
      }
    }

      assert.equal(calledTwoPass, false, 'Não deve acionar planTwoPassHierarchy quando multiPass: false for explícito');
    } finally {
      supervisor.planTwoPassHierarchy = origTwoPass;
    }
  });
});
