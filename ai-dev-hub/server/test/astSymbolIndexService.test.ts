import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  AstSymbolIndexService
} from '../src/astSymbolIndexService.js';
import { DocSimpService } from '../src/docSimpService.js';
import { PromptArchitectureService } from '../src/promptArchitectureService.js';
import { db } from '../src/db.js';

describe('FASE 5: AstSymbolIndexService & Proteção Anti-Context-Rot', () => {
  let tempDir: string;
  let srcDir: string;
  let testProjectId = 'test-proj-ast-01';

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-ast-test-'));
    srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    // File 1: TypeScript Service with classes, functions, interfaces, types
    fs.writeFileSync(
      path.join(srcDir, 'authService.ts'),
      `export interface UserSession {\n  userId: string;\n  role: 'admin' | 'user';\n  expiresAt: number;\n}\n\nexport type AuthStatus = 'AUTHENTICATED' | 'ANONYMOUS';\n\nexport enum UserRole {\n  ADMIN = 'ADMIN',\n  USER = 'USER'\n}\n\nexport const TOKEN_EXPIRY_MS: number = 3600000;\n\nexport async function loginUser(email: string, pass: string): Promise<UserSession> {\n  return { userId: '1', role: 'admin', expiresAt: Date.now() + TOKEN_EXPIRY_MS };\n}\n\nexport class AuthManager {\n  private secretKey: string = 'secret';\n  public static instance(): AuthManager {\n    return new AuthManager();\n  }\n  public verifyToken(token: string): boolean {\n    return true;\n  }\n}\n`
    );

    // File 2: CommonJS / JS service
    fs.writeFileSync(
      path.join(srcDir, 'calculator.js'),
      `exports.add = function(a, b) {\n  return a + b;\n};\n\nexports.multiply = (a, b) => a * b;\n`
    );
  });

  after(() => {
    try {
      db.prepare('DELETE FROM project_ast_symbols WHERE project_id = ?').run(testProjectId);
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('1. extractSymbols: Extrai com precisão funções, classes, métodos, interfaces, tipos e enums', () => {
    const code = fs.readFileSync(path.join(srcDir, 'authService.ts'), 'utf8');
    const symbols = AstSymbolIndexService.extractSymbols(code, 'authService.ts');

    assert.ok(symbols.length >= 6, `Deve extrair ao menos 6 símbolos, obteve ${symbols.length}`);

    const ifaceSym = symbols.find(s => s.symbolName === 'UserSession');
    assert.ok(ifaceSym, 'Deve extrair interface UserSession');
    assert.equal(ifaceSym?.symbolType, 'interface');
    assert.equal(ifaceSym?.exports, true);

    const typeSym = symbols.find(s => s.symbolName === 'AuthStatus');
    assert.ok(typeSym, 'Deve extrair type AuthStatus');
    assert.equal(typeSym?.symbolType, 'type');

    const enumSym = symbols.find(s => s.symbolName === 'UserRole');
    assert.ok(enumSym, 'Deve extrair enum UserRole');
    assert.equal(enumSym?.symbolType, 'enum');

    const constSym = symbols.find(s => s.symbolName === 'TOKEN_EXPIRY_MS');
    assert.ok(constSym, 'Deve extrair const TOKEN_EXPIRY_MS');

    const fnSym = symbols.find(s => s.symbolName === 'loginUser');
    assert.ok(fnSym, 'Deve extrair function loginUser');
    assert.equal(fnSym?.symbolType, 'function');
    assert.ok(fnSym?.signature.includes('loginUser(email: string, pass: string)'));

    const classSym = symbols.find(s => s.symbolName === 'AuthManager');
    assert.ok(classSym, 'Deve extrair class AuthManager');
    assert.equal(classSym?.symbolType, 'class');

    const methodSym = symbols.find(s => s.symbolName === 'AuthManager.verifyToken');
    assert.ok(methodSym, 'Deve extrair método público AuthManager.verifyToken');
    assert.equal(methodSym?.symbolType, 'method');
  });

  it('2. updateIndexForFile & querySymbols: Persiste e consulta símbolos em SQLite com integridade', () => {
    const indexed = AstSymbolIndexService.updateIndexForFile(
      testProjectId,
      tempDir,
      'src/authService.ts'
    );

    assert.ok(indexed.length >= 6);

    const queryAll = AstSymbolIndexService.querySymbols({
      projectId: testProjectId
    });
    assert.equal(queryAll.length, indexed.length);

    const queryFunctions = AstSymbolIndexService.querySymbols({
      projectId: testProjectId,
      symbolTypes: ['function']
    });
    assert.ok(queryFunctions.some(f => f.symbolName === 'loginUser'));

    const querySearch = AstSymbolIndexService.querySymbols({
      projectId: testProjectId,
      query: 'AuthManager'
    });
    assert.ok(querySearch.length >= 1);
  });

  it('3. indexProjectFiles: Realiza varredura recursiva de arquivos de projeto e atualiza o índice', async () => {
    const res = await AstSymbolIndexService.indexProjectFiles(testProjectId, tempDir);
    assert.equal(res.indexedFiles, 2, 'Deve ter indexado os 2 arquivos criados');
    assert.ok(res.totalSymbols >= 8, 'Deve conter ao menos 8 símbolos indexados');

    const count = AstSymbolIndexService.getProjectSymbolCount(testProjectId);
    assert.equal(count, res.totalSymbols);
  });

  it('4. generateStructuredSymbolSummary: Gera resumo condensado de assinaturas protegendo contra Context Rot', () => {
    const summary = AstSymbolIndexService.generateStructuredSymbolSummary(testProjectId, {
      projectPath: tempDir,
      maxChars: 4000
    });

    assert.ok(summary.includes('### [ESTRUTURA DE MÓDULOS E SÍMBOLOS EXPORTADOS (AST Symbol Index)]'));
    assert.ok(summary.includes('src/authService.ts'));
    assert.ok(summary.includes('loginUser'));
    assert.ok(summary.includes('UserSession'));
    assert.ok(summary.length < 4000, 'Resumo deve respeitar estritamente o orçamento de caracteres');
  });

  it('5. Integração com buildWorkerPrompt: Injeta o resumo estruturado e preserva o teto de tokens do modelo', () => {
    const { prompt, meta } = PromptArchitectureService.buildWorkerPrompt({
      mode: 'IMPLEMENT',
      projectId: testProjectId,
      projectName: 'Test Project',
      projectPath: tempDir,
      projectObjective: 'Testar proteção contra context rot',
      taskId: 'task-ast-worker',
      taskTitle: 'Implementar rota de login utilizando AuthService',
      taskDescription: 'Consumir AuthService.loginUser',
      acceptanceCriteria: ['Deve usar UserSession exportado'],
      expectedScopeFiles: ['src/authService.ts'],
      verificationCommand: 'npm test'
    });

    assert.ok(prompt.includes('ESTRUTURA DE MÓDULOS E SÍMBOLOS EXPORTADOS'), 'Prompt deve conter bloco AST Symbol Index');
    assert.ok(prompt.includes('loginUser'), 'Prompt deve conter assinatura da função sem alucinação');
    assert.ok(prompt.length < PromptArchitectureService.MAX_SAFE_PROMPT_CHARS, 'Prompt deve respeitar orçamento de 24.000 chars');
    assert.equal(meta.role, 'WORKER');
  });

  it('6. Atualização Automática: Remove símbolos ao excluir arquivo e atualiza ao modificar código', () => {
    // Atualizar authService.ts com menos símbolos
    const minimalCode = `export function minimalHelper(): void {}\n`;
    fs.writeFileSync(path.join(srcDir, 'authService.ts'), minimalCode);

    const updated = AstSymbolIndexService.updateIndexForFile(testProjectId, tempDir, 'src/authService.ts');
    assert.equal(updated.length, 1);
    assert.equal(updated[0].symbolName, 'minimalHelper');

    // Remover arquivo calculator.js
    fs.unlinkSync(path.join(srcDir, 'calculator.js'));
    AstSymbolIndexService.updateIndexForFile(testProjectId, tempDir, 'src/calculator.js');

    const calcs = AstSymbolIndexService.querySymbols({
      projectId: testProjectId,
      filePaths: ['src/calculator.js']
    });
    assert.equal(calcs.length, 0, 'Símbolos do arquivo excluído devem ter sido removidos');
  });

  it('7. getSymbolMap: Extrai interfaces, tipos, métodos exportados e rotas com redução > 70% de tokens', () => {
    // Código realista de serviço/controlador com muita implementação interna (loops, queries, validações)
    const complexControllerCode = `
import { Request, Response } from 'express';

export interface UserAccount {
  id: string;
  email: string;
  role: 'admin' | 'user';
  createdAt: Date;
}

export interface PaymentInvoice {
  invoiceId: string;
  amountCents: number;
  status: 'PENDING' | 'PAID' | 'FAILED';
}

export type TransactionState = 'INITIATED' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED';
export type AccountType = 'STANDARD' | 'ENTERPRISE';

export async function processPayment(userId: string, amount: number): Promise<PaymentInvoice> {
  // Lógica pesada de validação e processamento que NÃO deve poluir o contexto do Supervisor
  if (amount <= 0) throw new Error('Valor inválido');
  const rate = 0.025;
  const tax = amount * rate;
  const total = amount + tax;
  console.log('Validando saldo bancário no banco de dados SQLite...');
  for (let i = 0; i < 20; i++) {
    const step = i * 5;
  }
  return { invoiceId: 'inv-123', amountCents: Math.round(total * 100), status: 'PAID' };
}

function validateTaxId(taxId: string): boolean {
  if (!taxId || taxId.length !== 11) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(taxId.charAt(i)) * (10 - i);
  let rev = 11 - (sum % 11);
  if (rev === 10 || rev === 11) rev = 0;
  if (rev !== parseInt(taxId.charAt(9))) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(taxId.charAt(i)) * (11 - i);
  rev = 11 - (sum % 11);
  if (rev === 10 || rev === 11) rev = 0;
  return rev === parseInt(taxId.charAt(10));
}

function calculateTieredFees(amountCents: number, accountType: AccountType): number {
  if (accountType === 'ENTERPRISE') {
    if (amountCents > 1000000) return Math.round(amountCents * 0.009);
    if (amountCents > 100000) return Math.round(amountCents * 0.012);
    return Math.round(amountCents * 0.015);
  }
  return Math.round(amountCents * 0.025);
}

function auditTransactionEntry(auditDb: any, txId: string, action: string, metadata: Record<string, any>): void {
  const statement = 'INSERT INTO audit_logs (id, tx_id, action, metadata_json, created_at) VALUES (?, ?, ?, ?, ?)';
  const now = new Date().toISOString();
  console.log('Writing audit entry to SQLite:', txId, action, now);
}

function sanitizeCheckoutPayload(input: any): any {
  return {
    customerName: String(input?.customerName || '').trim().slice(0, 100),
    email: String(input?.email || '').toLowerCase().trim(),
    taxId: String(input?.taxId || '').replace(/\\D/g, ''),
    items: Array.isArray(input?.items) ? input.items.map((it: any) => ({
      sku: String(it.sku),
      qty: Number(it.qty) || 1,
      unitPrice: Number(it.unitPrice) || 0
    })) : []
  };
}

export function createInvoice(data: Partial<PaymentInvoice>): PaymentInvoice {
  return {
    invoiceId: data.invoiceId || 'inv-default',
    amountCents: data.amountCents || 0,
    status: data.status || 'PENDING'
  };
}

export class CheckoutManager {
  private apiKey: string;
  constructor(key: string) { this.apiKey = key; }
  public async executeCheckout(cartId: string): Promise<boolean> {
    // 30 linhas de lógica de checkout
    return true;
  }
}

// Rotas HTTP registradas
app.post('/api/checkout/pix', async (req: Request, res: Response) => {
  const result = await processPayment(req.body.userId, req.body.amount);
  res.json(result);
});

app.get('/api/checkout/:id', (req: Request, res: Response) => {
  res.json({ id: req.params.id, status: 'PAID' });
});

router.delete('/api/orders/:id', (req: Request, res: Response) => {
  res.status(204).end();
});
`;

    const controllerPath = path.join(srcDir, 'checkoutController.ts');
    fs.writeFileSync(controllerPath, complexControllerCode);

    const map = AstSymbolIndexService.getSymbolMap(controllerPath);

    // 1. Verificações de interfaces e tipos
    assert.ok(map.interfaces.length >= 2, 'Deve extrair ao menos 2 interfaces');
    assert.ok(map.interfaces.some(i => i.includes('UserAccount')));
    assert.ok(map.interfaces.some(i => i.includes('PaymentInvoice')));
    assert.ok(map.types.length >= 2, 'Deve extrair ao menos 2 types');
    assert.ok(map.types.some(t => t.includes('TransactionState')));

    // 2. Verificações de métodos exportados
    assert.ok(map.exportedMethods.some(m => m.includes('processPayment')));
    assert.ok(map.exportedMethods.some(m => m.includes('createInvoice')));
    assert.ok(map.exportedMethods.some(m => m.includes('CheckoutManager')));

    // 3. Verificações de rotas
    assert.ok(map.routes.some(r => r.includes('POST /api/checkout/pix')));
    assert.ok(map.routes.some(r => r.includes('GET /api/checkout/:id')));
    assert.ok(map.routes.some(r => r.includes('DELETE /api/orders/:id')));

    // 4. Critério Mandatório: Redução de tokens > 70%
    assert.ok(
      map.reductionPercentage >= 70,
      `Redução esperada >= 70%, obtida: ${map.reductionPercentage}% (${map.compactBytes}B vs ${map.originalBytes}B)`
    );

    // 5. Formatação estruturada não deve vazar código imperativo interno
    assert.ok(!map.formattedSummary.includes('Lógica pesada'));
    assert.ok(!map.formattedSummary.includes('console.log'));
    assert.ok(map.formattedSummary.includes('#### [AST SYMBOL MAP]'));
  });

  it('8. DocSimpService.getKnowledge: Extrai cirurgicamente regras e contratos para PushinPay, Supabase, BullMQ e Prisma', () => {
    // 1. PushinPay / Pix
    const pushinKnowledge = DocSimpService.getKnowledge('pushinpay');
    assert.ok(pushinKnowledge.includes('DOCSIMP KNOWLEDGE: PushinPay'));
    assert.ok(pushinKnowledge.includes('PUSHINPAY_API_KEY'));
    assert.ok(pushinKnowledge.includes('pix') || pushinKnowledge.includes('qr_code') || pushinKnowledge.includes('Pix'));
    assert.ok(!pushinKnowledge.includes('Was this section helpful?'));
    assert.ok(!pushinKnowledge.includes('## Indice'));

    // 2. Supabase
    const supabaseKnowledge = DocSimpService.getKnowledge('supabase');
    assert.ok(supabaseKnowledge.includes('Supabase'));
    assert.ok(supabaseKnowledge.includes('SUPABASE_URL') || supabaseKnowledge.includes('auth'));
    assert.ok(supabaseKnowledge.includes('Fallback'));

    // 3. BullMQ
    const bullKnowledge = DocSimpService.getKnowledge('bullmq');
    assert.ok(bullKnowledge.includes('BullMQ') || bullKnowledge.includes('bullmq') || bullKnowledge.includes('BULLMQ'));
    assert.ok(bullKnowledge.includes('Queue') || bullKnowledge.includes('Worker') || bullKnowledge.includes('fila'));

    // 4. Prisma
    const prismaKnowledge = DocSimpService.getKnowledge('prisma');
    assert.ok(prismaKnowledge.includes('PRISMA') || prismaKnowledge.includes('Prisma') || prismaKnowledge.includes('prisma'));
    assert.ok(prismaKnowledge.includes('schema.prisma') || prismaKnowledge.includes('PrismaClient') || prismaKnowledge.includes('DATABASE_URL') || prismaKnowledge.includes('ORM'));

    // 5. getKnowledgeForBriefing reunindo tecnologias mencionadas
    const briefingText = 'Desenvolver micro-SaaS com checkout Pix via PushinPay, autenticação Supabase e filas assíncronas com BullMQ.';
    const combinedKnowledge = DocSimpService.getKnowledgeForBriefing(briefingText);
    assert.ok(combinedKnowledge.includes('DOCSIMP: REGRAS E CONTRATOS'));
    assert.ok(combinedKnowledge.includes('PushinPay'));
    assert.ok(combinedKnowledge.includes('Supabase'));
    assert.ok(combinedKnowledge.includes('BullMQ') || combinedKnowledge.includes('bullmq') || combinedKnowledge.includes('BULLMQ'));
  });

  it('9. Supervisor Context Injection: Injeta AST compactada de arquivos-alvo e regras DOCSIMP no planejamento', () => {
    const briefing = 'Adicionar checkout de Pix via PushinPay e autenticação no src/checkoutController.ts';

    // 1. Identificar arquivos-alvo
    const targets = AstSymbolIndexService.identifyTargetFiles(briefing, tempDir);
    assert.ok(targets.some(t => t.includes('checkoutController.ts')), 'Deve identificar checkoutController.ts');

    // 2. Extrair contexto compactado
    const compactAst = AstSymbolIndexService.getCompactContextForBriefing(briefing, tempDir);
    assert.ok(compactAst.includes('FILTRO DE CONTEXTO BASEADO EM AST'));
    assert.ok(compactAst.includes('checkoutController.ts'));
    assert.ok(compactAst.includes('POST /api/checkout/pix'));

    // 3. Supervisor Prompt Assembly
    const { prompt, meta } = PromptArchitectureService.buildSupervisorPrompt({
      mode: 'INITIAL_PLAN',
      projectId: testProjectId,
      projectName: 'Test Compact Project',
      projectPath: tempDir,
      projectObjective: 'Reduzir tokens em 70% com injeção cirúrgica AST e DOCSIMP',
      briefing,
      astSymbolSummaryBlock: compactAst,
      docSimpKnowledgeBlock: DocSimpService.getKnowledgeForBriefing(briefing)
    });

    assert.equal(meta.role, 'SUPERVISOR');
    assert.ok(prompt.includes('<ast_symbol_index>'), 'Prompt do Supervisor deve conter envelope <ast_symbol_index>');
    assert.ok(prompt.includes('POST /api/checkout/pix'), 'Prompt do Supervisor deve conter rotas detectadas');
    assert.ok(prompt.includes('<docsimp_blueprints>'), 'Prompt do Supervisor deve conter contratos DOCSIMP');
    assert.ok(prompt.includes('PushinPay'), 'Prompt do Supervisor deve conter PushinPay');
    assert.ok(prompt.length < PromptArchitectureService.MAX_SAFE_PROMPT_CHARS, 'Prompt do Supervisor deve respeitar orçamento estrito');
  });

  it('10. Orçamento de Tokens do Worker: Payload gerado para Worker não ultrapassa 15.000 tokens em projetos médios', () => {
    // Montar contexto denso representativo de um projeto médio completo
    const { prompt, meta } = PromptArchitectureService.buildWorkerPrompt({
      mode: 'IMPLEMENT',
      projectId: testProjectId,
      projectName: 'Medium Enterprise SaaS',
      projectPath: tempDir,
      projectObjective: 'Implementar checkout Pix seguro e idempotente',
      taskId: 'task-pix-checkout',
      taskTitle: 'Construir endpoint POST /api/checkout/pix com validação estrita e auditoria',
      taskDescription: 'Processar pagamentos Pix utilizando PushinPay com fallback mock local e tabela audit_logs.',
      acceptanceCriteria: [
        'Endpoint POST /api/checkout/pix validando payload',
        'Gravação de logs de auditoria na tabela audit_logs',
        'Retorno de QR Code Pix funcional',
        'Sobrevivência a reload e tratamento de valores inválidos com HTTP 400'
      ],
      expectedScopeFiles: ['src/checkoutController.ts', 'src/authService.ts'],
      verificationCommand: 'npm test',
      docSimpKnowledgeBlock: DocSimpService.getKnowledgeForBriefing('checkout Pix com PushinPay e filas BullMQ'),
      astSymbolSummaryBlock: AstSymbolIndexService.getCompactContextForBriefing('checkoutController.ts authService.ts', tempDir),
      relevantDecisions: [
        'DEC-01: SQLite WAL com PRAGMA journal_mode = WAL;',
        'DEC-02: Porta restrita entre 4000 e 4999 (PORT_GUARD)',
        'DEC-03: Graceful mock fallback em ausência de chaves de API externas'
      ]
    });

    assert.equal(meta.role, 'WORKER');
    assert.ok(prompt.includes('checkoutController.ts'));
    assert.ok(prompt.includes('PushinPay'));

    // Estimativa de tokens: ~3.5 a 4 chars por token em código e markdown
    const promptBytes = Buffer.byteLength(prompt, 'utf8');
    const estimatedTokens = Math.ceil(promptBytes / 3.5);

    // CRITÉRIO DE ACEITAÇÃO: Não ultrapassa 15.000 tokens
    assert.ok(
      estimatedTokens <= 15000,
      `Payload do Worker excedeu o limite máximo de 15.000 tokens! Estimado: ${estimatedTokens} tokens (${promptBytes} bytes)`
    );

    // Verificação de alta eficiência: o DecoHUB mantém o payload abaixo de 7.000 tokens
    assert.ok(
      estimatedTokens <= 7000,
      `Payload esperado altamente compacto (< 7.000 tokens), obtido: ${estimatedTokens} tokens`
    );
  });
});
