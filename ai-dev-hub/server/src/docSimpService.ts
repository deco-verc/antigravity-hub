// server/src/docSimpService.ts
// Motor Autodidata DOCSIMP: Resolução Cache-First de Documentações, Aprendizado sob Demanda
// via site_docs_extractor, Injeção Local de Conhecimento e Padrão Plug-and-Play Graceful Mock Fallback.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { Logger } from './logger.js';

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
      'C:\\IA\\Antigravity HUB\\DOCSIMP',
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
      'C:\\IA\\Antigravity HUB\\site_docs_extractor\\cli_extract.py',
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
  static matchDocs(briefing: string, catalog: DocSimpCatalog): DocSimpEntry[] {
    if (!briefing || !catalog?.documents?.length) return [];
    const text = briefing.toLowerCase();
    const matched: DocSimpEntry[] = [];

    for (const doc of catalog.documents) {
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

    // Always include saas_standard if any integration was matched or SaaS terms are present
    const saasDoc = catalog.documents.find(d => d.id === 'saas_standard');
    if (saasDoc && !matched.some(m => m.id === 'saas_standard')) {
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
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "docSimpService",
          error: err?.message || String(err)
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
    options?: { autoExtract?: boolean; docSimpDir?: string }
  ): Promise<DocSimpResolutionResult> {
    const docSimpDir = options?.docSimpDir || this.getDocSimpDir();
    const catalog = this.loadCatalog(docSimpDir);

    const matchedDocs = this.matchDocs(briefing, catalog);
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

    return {
      matchedDocs,
      contextBlock,
      extractedDocs,
      copiedFiles
    };
  }
}
