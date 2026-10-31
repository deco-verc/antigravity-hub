// server/src/docSimpService.ts
// Motor Autodidata DOCSIMP: Resolução Cache-First de Documentações, Aprendizado sob Demanda
// via site_docs_extractor, Injeção Local de Conhecimento e Padrão Plug-and-Play Graceful Mock Fallback.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { Logger } from './logger.js';
import {
  ProjectCapabilities,
  ProjectProfileMode,
  resolveProjectCapabilities,
  resolveProjectProfileMode
} from './db.js';

const execFileAsync = promisify(execFile);

export interface DocSimpEntry {
  id: string;
  name: string;
  aliases: string[];
  summary: string;
  file_path: string;
  required_env_vars?: string[];
  fallback_strategy?: string;
}

export interface DocSimpCatalog {
  version: string;
  updated_at: string;
  documents: DocSimpEntry[];
}

export interface DocSimpResolutionResult {
  matchedDocs: DocSimpEntry[];
  contextBlock: string;
  knowledgeBlock?: string;
  extractedDocs: DocSimpEntry[];
  copiedFiles: string[];
}

export class DocSimpService {
  /**
   * Resolves the central DOCSIMP library directory with sensible fallbacks.
   */
  static getDocSimpDir(): string {
    if (process.env.DOCSIMP_DIR) {
      return path.resolve(process.env.DOCSIMP_DIR);
    }
    const candidatePaths = [
      path.resolve(__dirname, '../../../DOCSIMP'),
      path.resolve(process.cwd(), '../../DOCSIMP'),
      path.resolve(process.cwd(), '..', 'DOCSIMP'),
      path.resolve(process.cwd(), 'DOCSIMP')
    ];
    for (const cand of candidatePaths) {
      if (fs.existsSync(cand)) return cand;
    }
    return candidatePaths[0];
  }

  /**
   * Resolves the path to the site_docs_extractor CLI script.
   */
  static getSiteDocsExtractorScript(): string | null {
    if (process.env.SITE_DOCS_EXTRACTOR_SCRIPT) {
      return path.resolve(process.env.SITE_DOCS_EXTRACTOR_SCRIPT);
    }
    const candidatePaths = [
      path.resolve(process.cwd(), '..', 'site_docs_extractor', 'cli_extract.py'),
      path.resolve(process.cwd(), 'site_docs_extractor', 'cli_extract.py')
    ];
    for (const cand of candidatePaths) {
      if (fs.existsSync(cand)) return cand;
    }
    return null;
  }

  /**
   * Loads the catalog from disk. Returns a default structure if not found.
   */
  static getCatalog(docSimpDir?: string): DocSimpCatalog {
    return this.loadCatalog(docSimpDir);
  }

  static loadCatalog(docSimpDir?: string): DocSimpCatalog {
    const baseDir = docSimpDir || this.getDocSimpDir();
    const catalogPath = path.join(baseDir, 'catalog.json');
    if (!fs.existsSync(catalogPath)) {
      return {
        version: '1.0.0',
        updated_at: new Date().toISOString(),
        documents: []
      };
    }
    try {
      const raw = fs.readFileSync(catalogPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.documents)) {
        return parsed as DocSimpCatalog;
      }
    } catch (err: any) {
      Logger.warn(`[DOCSIMP] Erro ao ler catalog.json em ${catalogPath}: ${err.message}`);
    }
    return {
      version: '1.0.0',
      updated_at: new Date().toISOString(),
      documents: []
    };
  }

  /**
   * Persists the catalog to disk.
   */
  static saveCatalog(catalog: DocSimpCatalog, docSimpDir?: string): void {
    const baseDir = docSimpDir || this.getDocSimpDir();
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
    const catalogPath = path.join(baseDir, 'catalog.json');
    catalog.updated_at = new Date().toISOString();
    fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), 'utf-8');
  }

  /**
   * Extracts clean HTTP/HTTPS URLs from any text string.
   */
  static extractUrls(text: string): string[] {
    if (!text) return [];
    const urlRegex = /https?:\/\/[^\s"'<>\)]+/gi;
    const matches = text.match(urlRegex) || [];
    const cleanUrls: string[] = [];
    for (const raw of matches) {
      // Strip trailing punctuation often found in natural language
      const cleaned = raw.replace(/[.,;:)\]}]+$/, '').trim();
      if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
        cleanUrls.push(cleaned);
      }
    }
    return Array.from(new Set(cleanUrls));
  }

  /**
   * Matches terms and keywords in the briefing against the catalog aliases.
   */
  static matchDocs(
    briefing: string,
    catalog?: DocSimpCatalog,
    capabilities?: Partial<ProjectCapabilities>,
    projectProfile?: ProjectProfileMode
  ): DocSimpEntry[] {
    const activeCatalog = catalog || this.getCatalog();
    if (!briefing || !activeCatalog?.documents?.length) return [];
    const text = briefing.toLowerCase();
    let matched: DocSimpEntry[] = [];

    for (const doc of activeCatalog.documents) {
      const isDirectMatch = (doc.aliases || []).some(alias => {
        const lowerAlias = alias.toLowerCase().trim();
        if (!lowerAlias) return false;
        // Check for boundary or substring match
        return text.includes(lowerAlias);
      });

      if (isDirectMatch) {
        matched.push(doc);
      }
    }

    // REGRA DE OURO DAS CAPACIDADES:
    // Se capabilities?.payments === false: NUNCA inclua docs de pushinpay / pix (a menos que o usuário tenha digitado explicitamente pushinpay no prompt).
    if (capabilities?.payments === false && !/pushinpay/i.test(text)) {
      matched = matched.filter(d => !/pushinpay|pix/i.test(d.id) && !/pushinpay/i.test(d.name || ''));
    }

    // Se capabilities?.auth === false: NUNCA inclua docs de supabase auth ou turnstile (a menos que o usuário tenha digitado explicitamente no prompt).
    if (capabilities?.auth === false) {
      if (!/supabase/i.test(text)) {
        matched = matched.filter(d => !/supabase/i.test(d.id) && !/supabase/i.test(d.name || ''));
      }
      if (!/turnstile/i.test(text)) {
        matched = matched.filter(d => !/turnstile/i.test(d.id) && !/turnstile/i.test(d.name || ''));
      }
    }

    // REMOVA a injeção automática forçada de saas_standard quando project_profile === 'local_personal' ou quando payments === false && auth === false!
    const isLocalPersonal = projectProfile === 'local_personal' || (capabilities?.payments === false && capabilities?.auth === false);
    const saasDoc = activeCatalog.documents.find(d => d.id === 'saas_standard');
    if (saasDoc && !matched.some(m => m.id === 'saas_standard') && !isLocalPersonal) {
      const hasIntegrationWords = /api|rest|service|serviço|webhook|auth|database|banco|pix|gateway|login|token|cache|storage|saas/i.test(text);
      if (matched.length > 0 || hasIntegrationWords) {
        matched.push(saasDoc);
      }
    }

    // Deduplicate by ID
    const uniqueMap = new Map<string, DocSimpEntry>();
    for (const doc of matched) {
      uniqueMap.set(doc.id, doc);
    }
    return Array.from(uniqueMap.values());
  }

  /**
   * Executes the site_docs_extractor CLI to learn documentation on-demand.
   */
  static async extractDocViaCli(
    url: string,
    projectName?: string,
    options?: { maxPages?: number; timeoutMs?: number; docSimpDir?: string }
  ): Promise<DocSimpEntry | null> {
    const scriptPath = this.getSiteDocsExtractorScript();
    if (!scriptPath || !fs.existsSync(scriptPath)) {
      Logger.warn(`[DOCSIMP] Script do site_docs_extractor não localizado. Ignorando extração sob demanda de ${url}`);
      return null;
    }

    const docSimpDir = options?.docSimpDir || this.getDocSimpDir();
    let slug = projectName?.trim() || '';
    if (!slug) {
      try {
        const parsed = new URL(url);
        slug = parsed.hostname.replace(/^(docs\.|api\.|developer\.|www\.)/i, '').replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
      } catch {
        slug = 'doc_' + Date.now();
      }
    }

    const maxPages = options?.maxPages || 15;
    const timeoutMs = options?.timeoutMs || 90000;

    Logger.info(`[DOCSIMP] Iniciando extração autodidata sob demanda de: ${url} (slug: ${slug})...`);

    try {
      const args = [
        scriptPath,
        '--url', url,
        '--project-name', slug,
        '--max-pages', String(maxPages)
      ];

      const { stdout, stderr } = await execFileAsync('python', args, {
        timeout: timeoutMs,
        encoding: 'utf-8'
      });

      if (stderr && stderr.trim()) {
        Logger.debug(`[DOCSIMP] Extrator stderr: ${stderr.slice(0, 300)}`);
      }

      const trimmedStdout = stdout.trim();
      let result: any = null;
      try {
        result = JSON.parse(trimmedStdout);
      } catch {
        // Fallback: look for JSON object in output
        const match = trimmedStdout.match(/\{[\s\S]*\}/);
        if (match) {
          result = JSON.parse(match[0]);
        }
      }

      if (!result || !result.success || !result.doc_path || !fs.existsSync(result.doc_path)) {
        Logger.warn(`[DOCSIMP] Extrator falhou ou arquivo gerado não existe: ${result?.error || 'Saída inválida'}`);
        return null;
      }

      // Copy knowledge ready doc into DOCSIMP central library
      if (!fs.existsSync(docSimpDir)) {
        fs.mkdirSync(docSimpDir, { recursive: true });
      }
      const targetFileName = `${slug}_knowledge_ready.md`;
      const targetAbsPath = path.join(docSimpDir, targetFileName);
      fs.copyFileSync(result.doc_path, targetAbsPath);

      // Create new catalog entry
      const newEntry: DocSimpEntry = {
        id: slug,
        name: `${slug.replace(/[_-]+/g, ' ').toUpperCase()} Docs`,
        aliases: [slug, slug.replace(/[_-]+/g, ' '), url],
        summary: `Documentação oficial extraída sob demanda de ${url} (${result.pages_extracted || 1} páginas catalogadas).`,
        file_path: targetFileName,
        required_env_vars: [],
        fallback_strategy: 'Mock local seguro e respostas simuladas caso credenciais externas não estejam configuradas.'
      };

      try {
        const domain = new URL(url).hostname;
        if (domain && !newEntry.aliases.includes(domain)) {
          newEntry.aliases.push(domain);
        }
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "docSimpService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:docSimpService]", err);
      }
    }

      // Register in catalog.json
      const catalog = this.loadCatalog(docSimpDir);
      const existingIdx = catalog.documents.findIndex(d => d.id === slug);
      if (existingIdx >= 0) {
        catalog.documents[existingIdx] = newEntry;
      } else {
        catalog.documents.push(newEntry);
      }
      this.saveCatalog(catalog, docSimpDir);

      Logger.success(`[DOCSIMP] Nova documentação aprendida e indexada com sucesso: ${slug} (${targetFileName})`);
      return newEntry;
    } catch (err: any) {
      Logger.warn(`[DOCSIMP] Falha ao extrair documentação de ${url}: ${err.message}`);
      return null;
    }
  }

  /**
   * Copies relevant knowledge docs to the project's `.ai-dev-hub/docs/` directory.
   */
  static copyDocsToProject(projectRoot: string, docs: DocSimpEntry[], docSimpDir?: string): string[] {
    if (!projectRoot || !fs.existsSync(projectRoot) || !docs?.length) {
      return [];
    }

    const baseDocSimpDir = docSimpDir || this.getDocSimpDir();
    const destDir = path.join(projectRoot, '.ai-dev-hub', 'docs');
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const copiedFiles: string[] = [];

    for (const doc of docs) {
      const srcPath = path.isAbsolute(doc.file_path)
        ? doc.file_path
        : path.join(baseDocSimpDir, doc.file_path);

      if (fs.existsSync(srcPath)) {
        const destFile = path.join(destDir, path.basename(srcPath));
        try {
          fs.copyFileSync(srcPath, destFile);
          copiedFiles.push(destFile);
        } catch (err: any) {
          Logger.warn(`[DOCSIMP] Falha ao copiar doc ${srcPath} para ${destFile}: ${err.message}`);
        }
      }
    }

    return copiedFiles;
  }

  /**
   * Generates a concise context block (< 1,200 chars) for prompt injection.
   * Strictly adheres to the 28k CLI limit.
   */
  static buildDocSimpContextBlock(docs: DocSimpEntry[]): string {
    if (!docs || docs.length === 0) return '';

    const lines: string[] = [
      '### DIRETRIZES TÉCNICAS DOCSIMP & GRACEFUL MOCK FALLBACK (MANDATÓRIO)',
      'Documentações de referência disponíveis no workspace em `.ai-dev-hub/docs/`:'
    ];

    for (const doc of docs) {
      const baseName = path.basename(doc.file_path);
      const summarySnippet = (doc.summary || '').slice(0, 45);
      lines.push(`- [${doc.name}]: .ai-dev-hub/docs/${baseName} — ${summarySnippet}`);
    }

    lines.push('');
    lines.push('REGRA INVIOLÁVEL DE AUTONOMIA:');
    lines.push('1. A falta de chaves externas NUNCA deve quebrar o boot do servidor ou falhar os testes.');
    lines.push('2. Forneça implementações de fallback seguras em memória ou locais (mock/sandbox).');
    lines.push('3. Exponha status das integrações no endpoint `/api/system/integrations`.');
    lines.push('4. Forneça arquivo `.env.example` completo com todas as variáveis documentadas.');

    const result = lines.join('\n');
    return result.length > 1150 ? result.slice(0, 1147) + '...' : result;
  }

  /**
   * High-level entrypoint: resolves docs cache-first, extracts on-demand if new URLs exist,
   * copies knowledge files to project, and returns the compact context block.
   */
  static async resolveDocsForBriefing(
    briefing: string,
    projectRoot?: string,
    optionsOrCapabilities?: {
      autoExtract?: boolean;
      docSimpDir?: string;
      capabilities?: Partial<ProjectCapabilities>;
      projectProfile?: ProjectProfileMode;
    } | Partial<ProjectCapabilities>,
    projectProfileArg?: ProjectProfileMode
  ): Promise<DocSimpResolutionResult> {
    const isOptionsObj = optionsOrCapabilities && !('database' in optionsOrCapabilities || 'auth' in optionsOrCapabilities || 'payments' in optionsOrCapabilities || 'advancedSaas' in optionsOrCapabilities || 'demoSeed' in optionsOrCapabilities) && ('autoExtract' in optionsOrCapabilities || 'docSimpDir' in optionsOrCapabilities || 'capabilities' in optionsOrCapabilities || 'projectProfile' in optionsOrCapabilities);
    const options = isOptionsObj ? (optionsOrCapabilities as any) : undefined;
    const directCaps = !isOptionsObj ? (optionsOrCapabilities as Partial<ProjectCapabilities> | undefined) : undefined;

    const docSimpDir = options?.docSimpDir || this.getDocSimpDir();
    const catalog = this.loadCatalog(docSimpDir);

    const capabilities = directCaps || options?.capabilities || (projectRoot ? resolveProjectCapabilities(projectRoot, briefing) : undefined);
    const projectProfile = projectProfileArg || options?.projectProfile || (projectRoot ? resolveProjectProfileMode(projectRoot, briefing) : undefined);

    const matchedDocs = this.matchDocs(briefing, catalog, capabilities, projectProfile);
    const extractedDocs: DocSimpEntry[] = [];

    // Check for uncached URLs in briefing if autoExtract is enabled
    if (options?.autoExtract !== false) {
      const urls = this.extractUrls(briefing);
      for (const url of urls) {
        // Check if URL is already matched
        const alreadyKnown = matchedDocs.some(d => {
          return d.aliases.some(a => a.toLowerCase() === url.toLowerCase()) ||
                 d.aliases.some(a => {
                   try {
                     return new URL(url).hostname.includes(a.toLowerCase());
                   } catch {
                     return false;
                   }
                 });
        });

        if (!alreadyKnown) {
          const learned = await this.extractDocViaCli(url, undefined, { docSimpDir });
          if (learned) {
            extractedDocs.push(learned);
            matchedDocs.push(learned);
          }
        }
      }
    }

    let copiedFiles: string[] = [];
    if (projectRoot) {
      copiedFiles = this.copyDocsToProject(projectRoot, matchedDocs, docSimpDir);
    }

    const contextBlock = this.buildDocSimpContextBlock(matchedDocs);
    const knowledgeBlock = this.getKnowledgeForBriefing(briefing, { docSimpDir });

    return {
      matchedDocs,
      contextBlock,
      knowledgeBlock,
      extractedDocs,
      copiedFiles
    };
  }

  /**
   * Extrai cirurgicamente apenas seções de regras, endpoints, webhooks, contratos e códigos de exemplo
   * de um documento Markdown de conhecimento, eliminando sumários, índices e textos explicativos verbosos.
   */
  static extractRulesAndContracts(markdown: string, maxChars = 3200): string {
    if (!markdown || typeof markdown !== 'string') return '';

    const lines = markdown.split(/\r?\n/);
    const extractedSections: string[] = [];
    let inTOC = false;
    let currentSectionTitle = '';
    let currentSectionLines: string[] = [];
    let isInterestingSection = false;

    const interestingPattern = /regras?|contratos?|endpoints?|webhooks?|api|auth|bearer|payload|schemas?|status|qr_code|models?|queue|workers?|queries|integra[cç][aã]o|integration|quickstart|getting started/i;
    const ignoreSectionPattern = /^##\s+(?:[ií]ndice|table of contents|summary)/i;

    const flushCurrentSection = () => {
      if (isInterestingSection && currentSectionLines.length > 0) {
        const text = currentSectionLines.join('\n').trim();
        if (text.length > 30) {
          extractedSections.push(text);
        }
      }
      currentSectionLines = [];
      isInterestingSection = false;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Ignora índice e sumários de navegação
      if (ignoreSectionPattern.test(line)) {
        inTOC = true;
        continue;
      }
      if (inTOC && /^---|^##\s+/i.test(line)) {
        inTOC = false;
      }
      if (inTOC) continue;

      // Ignora linhas de rodapé/telemetria padrão
      if (/Was this section helpful\?|On this page|Source URL:/i.test(line)) {
        continue;
      }

      // Detecção de novo cabeçalho de seção (#, ##, ###)
      const headerMatch = line.match(/^(#{1,3})\s+(.*)$/);
      if (headerMatch) {
        flushCurrentSection();
        currentSectionTitle = headerMatch[2].trim();
        isInterestingSection = interestingPattern.test(currentSectionTitle);
        currentSectionLines.push(line);
        continue;
      }

      // Se estiver em uma seção de interesse ou encontrar um bloco de código de contrato
      if (isInterestingSection || line.startsWith('```')) {
        currentSectionLines.push(line);
      }
    }
    flushCurrentSection();

    let combined = extractedSections.join('\n\n').trim();

    // Se a extração estrita filtrou tudo (ex: arquivo sem headers convencionais), capture blocos de código e primeiras diretrizes
    if (!combined || combined.length < 80) {
      const codeBlockMatches = markdown.match(/```(?:json|ts|typescript|js|javascript|bash|sh|curl)?[\s\S]*?```/gi);
      if (codeBlockMatches && codeBlockMatches.length > 0) {
        combined = codeBlockMatches.slice(0, 5).join('\n\n');
      } else {
        combined = markdown
          .replace(/^#\s+[^\n]+/g, '')
          .replace(/##\s+Índice[\s\S]*?---/gi, '')
          .trim()
          .slice(0, maxChars);
      }
    }

    if (combined.length > maxChars) {
      combined = combined.slice(0, maxChars - 30) + '\n... [contratos truncados para teto de tokens]';
    }

    return combined;
  }

  /**
   * Obtém a base de conhecimento e contratos de integração para uma tecnologia específica (DOCSIMP).
   * Retorna apenas seções de regras e contratos de integração para injeção cirúrgica de contexto.
   */
  static getKnowledge(idOrAlias: string, options?: { docSimpDir?: string; maxChars?: number }): string {
    if (!idOrAlias) return '';

    const baseDir = options?.docSimpDir || this.getDocSimpDir();
    const catalog = this.loadCatalog(baseDir);
    const maxChars = options?.maxChars || 3500;

    const searchKey = idOrAlias.toLowerCase().trim().replace(/[-_]/g, '');

    // 1. Localiza a entrada correspondente no catálogo
    let entry = catalog.documents.find(d => {
      const dId = d.id.toLowerCase();
      const dIdNorm = dId.replace(/[-_]/g, '');
      if (dId === idOrAlias.toLowerCase() || dIdNorm === searchKey) return true;
      if (dId.replace(/_io$/, '') === idOrAlias.toLowerCase().replace(/_io$/, '')) return true;
      return (d.aliases || []).some(a => {
        const aNorm = a.toLowerCase().replace(/[-_]/g, '');
        return aNorm === searchKey || a.toLowerCase() === idOrAlias.toLowerCase();
      });
    });

    // 2. Tenta ler o arquivo da documentação no disco
    let rawContent = '';
    if (entry) {
      const candidates = [
        path.isAbsolute(entry.file_path) ? entry.file_path : path.join(baseDir, entry.file_path),
        path.join(baseDir, `${entry.id}_knowledge_ready.md`),
        path.join(baseDir, `${entry.id.replace(/_io$/, '')}_knowledge_ready.md`),
        path.join(process.cwd(), '.ai-dev-hub', 'docs', path.basename(entry.file_path))
      ];
      for (const cand of candidates) {
        if (cand && fs.existsSync(cand)) {
          try {
            rawContent = fs.readFileSync(cand, 'utf-8');
            break;
          } catch {}
        }
      }
    }

    let extractedRules = rawContent ? this.extractRulesAndContracts(rawContent, maxChars) : '';

    // 3. Contratos canônicos de segurança caso o arquivo markdown não exista no disco
    if (!extractedRules || extractedRules.length < 80) {
      if (/pushinpay|pix/i.test(idOrAlias)) {
        extractedRules = [
          '#### Endpoints Oficiais Pix PushinPay:',
          '- `POST /api/v1/pix/cashIn`: Cria cobrança Pix dinâmica. Retorna `{ id, qr_code, qr_code_base64, value, status }`.',
          '- `GET /api/v1/pix/cashIn/:id`: Consulta status da transação Pix (`created` | `paid` | `canceled`).',
          '- `POST /api/v1/pix/cashOut`: Solicita liquidação/saque Pix para chave de destino.',
          '#### Contrato do Webhook (POST):',
          '```json',
          '{',
          '  "id": "uuid-da-transacao",',
          '  "value": 2990,',
          '  "status": "paid",',
          '  "end_to_end_id": "E123456782026...",',
          '  "payer_name": "Nome do Pagador",',
          '  "payer_national_registration": "12345678900"',
          '}',
          '```',
          '#### Headers Obrigatórios: `Authorization: Bearer <PUSHINPAY_API_KEY>`, `Accept: application/json`.'
        ].join('\n');
      } else if (/supabase/i.test(idOrAlias)) {
        extractedRules = [
          '#### SDK & Autenticação Supabase:',
          '- Client: `const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)`',
          '- Auth: `supabase.auth.signUp({ email, password })`, `supabase.auth.signInWithPassword({ email, password })`',
          '- Dados: `supabase.from("table").select("*").eq("user_id", user.id)`',
          '- Persistência segura e isolamento de RLS via policies PostgreSQL.'
        ].join('\n');
      } else if (/bullmq/i.test(idOrAlias)) {
        extractedRules = [
          '#### SDK & Filas BullMQ:',
          '- Fila: `const queue = new Queue("tasks", { connection: redisOptions })`',
          '- Adicionar Job: `await queue.add("processOrder", payload, { attempts: 3, backoff: { type: "exponential", delay: 1000 } })`',
          '- Worker: `const worker = new Worker("tasks", async job => { ... }, { connection: redisOptions })`',
          '- Eventos determinísticos: `worker.on("completed", ...)` e `worker.on("failed", ...)`.'
        ].join('\n');
      } else if (/prisma/i.test(idOrAlias)) {
        extractedRules = [
          '#### Contrato de Acesso Prisma ORM:',
          '- Schema `schema.prisma`: `datasource db { provider = "sqlite", url = env("DATABASE_URL") }`',
          '- Client: `const prisma = new PrismaClient()`',
          '- Operações Tipadas: `prisma.user.findUnique({ where: { id } })`, `prisma.user.create({ data })`'
        ].join('\n');
      }
    }

    if (!extractedRules) {
      return '';
    }

    const title = entry?.name || idOrAlias.toUpperCase();
    const envVars = (entry?.required_env_vars || []).join(', ') || 'Nenhuma variável obrigatória';
    const fallback = entry?.fallback_strategy || 'Mock local e repositório em memória caso credenciais não estejam configuradas.';

    const lines: string[] = [
      `### [DOCSIMP KNOWLEDGE: ${title}]`,
      `- Identificador: \`${entry?.id || idOrAlias}\``,
      `- Variáveis de Ambiente Necessárias: ${envVars}`,
      `- Estratégia de Fallback (Mandatória): ${fallback}`,
      `- Regras e Contratos de Integração:`,
      extractedRules
    ];

    return lines.join('\n');
  }

  /**
   * Identifica tecnologias presentes no catálogo e mencionadas no briefing e reúne
   * suas seções de regras e contratos de integração.
   */
  static getKnowledgeForBriefing(
    briefing: string,
    options?: { docSimpDir?: string; maxCharsPerDoc?: number; maxTotalChars?: number }
  ): string {
    if (!briefing) return '';

    const baseDir = options?.docSimpDir || this.getDocSimpDir();
    const catalog = this.loadCatalog(baseDir);
    const maxTotalChars = options?.maxTotalChars || 6000;
    const maxCharsPerDoc = options?.maxCharsPerDoc || 2500;

    const matched = this.matchDocs(briefing, catalog);
    const knowledgeBlocks: string[] = [];

    // Garantir que menções explícitas de pushinpay, supabase, bullmq e prisma sejam incluídas
    const explicitIds: string[] = [];
    if (/pushinpay|pix/i.test(briefing)) explicitIds.push('pushinpay');
    if (/supabase/i.test(briefing)) explicitIds.push('supabase');
    if (/bullmq|fila|queue/i.test(briefing)) explicitIds.push('bullmq_io');
    if (/prisma/i.test(briefing)) explicitIds.push('prisma_io');

    const allIds = new Set<string>();
    for (const d of matched) allIds.add(d.id);
    for (const eid of explicitIds) allIds.add(eid);

    for (const id of Array.from(allIds)) {
      const k = this.getKnowledge(id, { docSimpDir: baseDir, maxChars: maxCharsPerDoc });
      if (k && k.trim().length > 0) {
        knowledgeBlocks.push(k.trim());
      }
    }

    if (knowledgeBlocks.length === 0) {
      return '';
    }

    const joined = [
      '### [DOCSIMP: REGRAS E CONTRATOS DE INTEGRAÇÃO TÉCNICA]',
      'Contratos e especificações de integração identificados para o briefing:',
      '',
      ...knowledgeBlocks
    ].join('\n\n');

    return joined.length > maxTotalChars
      ? joined.slice(0, maxTotalChars - 40) + '\n... [contratos DOCSIMP adicionais preservados]'
      : joined;
  }
}
