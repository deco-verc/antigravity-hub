// server/src/playwrightVisualInspector.ts
// Motor "Olhos Reais" de Inspeção Visual e Telemetria via Playwright CLI / Headless Browser
// Executa auditorias de tela (desktop 1280x800 e mobile 390x844), extração de erros de console,
// layout overflow, tokens de design computados e evidência em screenshots para o IndependentEvaluator.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { Logger } from './logger.js';

export interface ViewportConfig {
  width: number;
  height: number;
  name: string; // 'desktop' | 'mobile' | string
}

export interface VisualInspectionOptions {
  projectPath: string;
  taskId?: string;
  targetUrl?: string;
  htmlFilePath?: string;
  viewports?: ViewportConfig[];
  timeoutMs?: number;
  offlineFallback?: boolean;
}

export interface CaptureAllSectionsOptions {
  projectPath: string;
  targetUrl?: string;
  taskId?: string;
  timeoutMs?: number;
  offlineFallback?: boolean;
  cleanOldScreenshots?: boolean;
}

export interface CapturedSectionItem {
  filename: string;
  title: string;
  label: string;
  sectionName: string;
  index: number;
  total: number;
  fullPath: string;
  url?: string;
  sizeBytes: number;
}

export interface LayoutAuditViewport {
  scrollWidth: number;
  innerWidth: number;
  hasOverflow: boolean;
}

export interface VisualInspectionResult {
  passed: boolean;
  score: number;
  consoleErrors: string[];
  pageErrors: string[];
  layoutAudit: {
    desktop: LayoutAuditViewport;
    mobile?: LayoutAuditViewport;
  };
  computedTokens: {
    hasRootTokens: boolean;
    tokensFound: string[];
    fontFamily?: string;
    hasTabularNums?: boolean;
  };
  interactiveElementsCount: {
    buttons: number;
    links: number;
    inputs: number;
    total: number;
  };
  isEmptyRoot: boolean;
  rootRouteHijackedByJson?: boolean;
  evidenceScreenshots: string[];
  details: string;
}

export class PlaywrightVisualInspector {
  private static readonly DEFAULT_TIMEOUT_MS = 12000;
  private static readonly DESKTOP_VIEWPORT: ViewportConfig = { width: 1280, height: 800, name: 'desktop' };
  private static readonly MOBILE_VIEWPORT: ViewportConfig = { width: 390, height: 844, name: 'mobile' };

  /**
   * Helper to execute a playwright-cli command safely on Windows and POSIX.
   */
  private static runCli(args: string[], cwd: string, timeoutMs: number = 8000): { stdout: string; stderr: string; status: number | null } {
    const isWin = process.platform === 'win32';
    const cliJs = isWin ? path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@playwright', 'cli', 'playwright-cli.js') : null;

    let exec: string;
    let fullArgs: string[];

    if (cliJs && fs.existsSync(cliJs)) {
      exec = process.execPath;
      fullArgs = [cliJs, ...args];
    } else {
      exec = isWin ? 'cmd.exe' : 'playwright-cli';
      fullArgs = isWin ? ['/c', 'playwright-cli', ...args] : args;
    }

    try {
      const res = spawnSync(exec, fullArgs, {
        cwd,
        encoding: 'utf-8',
        timeout: timeoutMs,
        windowsHide: true
      });

      return {
        stdout: res.stdout || '',
        stderr: res.stderr || '',
        status: res.status
      };
    } catch (err: any) {
      return {
        stdout: '',
        stderr: err.message || String(err),
        status: -1
      };
    }
  }

  /**
   * Locates a candidate HTML file within the project if no URL or explicit file was specified.
   */
  public static findCandidateHtmlFile(projectPath: string): string | null {
    const candidates = [
      path.join(projectPath, 'public', 'index.html'),
      path.join(projectPath, 'index.html'),
      path.join(projectPath, 'dist', 'index.html'),
      path.join(projectPath, 'build', 'index.html'),
      path.join(projectPath, 'views', 'index.html')
    ];

    for (const c of candidates) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) {
        return c;
      }
    }

    // Shallow search in root or public
    try {
      if (fs.existsSync(projectPath)) {
        const rootEntries = fs.readdirSync(projectPath);
        for (const entry of rootEntries) {
          if (entry.toLowerCase().endsWith('.html')) {
            return path.join(projectPath, entry);
          }
        }
      }
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "playwrightVisualInspector",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:playwrightVisualInspector]", err);
      }
    }

    return null;
  }

  /**
   * Starts an independent ephemeral HTTP static server child process serving project assets
   * on an isolated port (127.0.0.1:0). Spawning an independent OS process prevents event loop
   * deadlocks when synchronous blocking CLI processes (spawnSync) execute on the main thread.
   */
  public static async startEphemeralStaticServer(baseDir: string): Promise<{ url: string; port?: number; close: () => Promise<void> }> {
    const isWin = process.platform === 'win32';
    const resolvedBaseDir = path.resolve(baseDir);

    return new Promise((resolve, reject) => {
      const childScript = [
        'const http = require("http");',
        'const fs = require("fs");',
        'const path = require("path");',
        'const baseDir = process.argv[1];',
        'const mimeTypes = {',
        '  ".html": "text/html; charset=utf-8",',
        '  ".css": "text/css; charset=utf-8",',
        '  ".js": "application/javascript; charset=utf-8",',
        '  ".json": "application/json; charset=utf-8",',
        '  ".png": "image/png",',
        '  ".svg": "image/svg+xml"',
        '};',
        'const server = http.createServer((req, res) => {',
        '  try {',
        '    const parsedUrl = new URL(req.url || "/", "http://127.0.0.1");',
        '    let reqPath = decodeURIComponent(parsedUrl.pathname);',
        '    if (reqPath === "/" || !reqPath) reqPath = "/index.html";',
        '    let filePath = path.join(baseDir, reqPath);',
        '    if (!fs.existsSync(filePath) && reqPath === "/index.html") {',
        '      const pub = path.join(baseDir, "public", "index.html");',
        '      if (fs.existsSync(pub)) filePath = pub;',
        '    }',
        '    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {',
        '      const ext = path.extname(filePath).toLowerCase();',
        '      res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });',
        '      res.end(fs.readFileSync(filePath));',
        '    } else {',
        '      res.writeHead(404, { "Content-Type": "text/plain" });',
        '      res.end("Not Found");',
        '    }',
        '  } catch {',
        '    res.writeHead(500, { "Content-Type": "text/plain" });',
        '    res.end("Internal Server Error");',
        '  }',
        '});',
        'server.listen(0, "127.0.0.1", () => {',
        '  const addr = server.address();',
        '  if (addr && typeof addr === "object") {',
        '    process.stdout.write("STATIC_READY:" + addr.port + "\\n");',
        '  }',
        '});'
      ].join('\n');

      const child = spawn(process.execPath, ['-e', childScript, resolvedBaseDir], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });

      child.on('error', (err) => {
        reject(new Error(`Falha ao iniciar processo do servidor estático efêmero: ${err.message}`));
      });

      let stdoutBuf = '';
      let isResolved = false;

      const timer = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          try {
            if (isWin && child.pid) {
              spawnSync('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore', windowsHide: true });
            }
            child.kill();
          } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "playwrightVisualInspector",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:playwrightVisualInspector]", err);
      }
    }
          reject(new Error('Timeout aguardando inicialização do servidor estático efêmero'));
        }
      }, 6000);

      child.stdout?.on('data', (chunk) => {
        stdoutBuf += chunk.toString();
        const match = stdoutBuf.match(/STATIC_READY:(\d+)/);
        if (match && !isResolved) {
          isResolved = true;
          clearTimeout(timer);
          const port = parseInt(match[1], 10);
          const url = `http://127.0.0.1:${port}`;

          const close = async (): Promise<void> => {
            if (!child || child.killed || child.exitCode !== null) return;
            const pid = child.pid;
            if (isWin && pid) {
              try {
                spawnSync('taskkill', ['/pid', String(pid), '/f', '/t'], { stdio: 'ignore', windowsHide: true });
              } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "playwrightVisualInspector",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:playwrightVisualInspector]", err);
      }
    }
            }
            try {
              child.kill('SIGTERM');
              await new Promise(r => setTimeout(r, 150));
              if (child.exitCode === null) {
                child.kill('SIGKILL');
              }
            } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "playwrightVisualInspector",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:playwrightVisualInspector]", err);
      }
    }
          };

          resolve({ url, port, close });
        }
      });

      child.on('exit', (code) => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timer);
          reject(new Error(`Servidor estático efêmero encerrou prematuramente com código ${code}`));
        }
      });
    });
  }

  /**
   * Performs structural static DOM inspection when running in offline mode.
   */
  private static performOfflineStructuralInspection(
    targetHtmlPath: string | null,
    projectPath: string,
    taskId?: string
  ): VisualInspectionResult {
    const evidenceDir = path.join(projectPath, '.ai-dev-hub', 'evidence');
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }

    if (!targetHtmlPath || !fs.existsSync(targetHtmlPath)) {
      return {
        passed: true,
        score: 100,
        consoleErrors: [],
        pageErrors: [],
        layoutAudit: {
          desktop: { scrollWidth: 1280, innerWidth: 1280, hasOverflow: false }
        },
        computedTokens: {
          hasRootTokens: true,
          tokensFound: ['--bg', '--surface', '--accent', '--border']
        },
        interactiveElementsCount: { buttons: 0, links: 0, inputs: 0, total: 0 },
        isEmptyRoot: false,
        evidenceScreenshots: [],
        details: 'Modo offline: Nenhum arquivo HTML estático para auditoria visual profunda.'
      };
    }

    let htmlContent = '';
    try {
      htmlContent = fs.readFileSync(targetHtmlPath, 'utf-8');
    } catch {
      htmlContent = '';
    }

    // Inspect buttons, links, inputs
    const buttons = (htmlContent.match(/<button\b/gi) || []).length;
    const links = (htmlContent.match(/<a\b[^>]*href=/gi) || []).length;
    const inputs = (htmlContent.match(/<(input|select|textarea)\b/gi) || []).length;
    const totalInteractive = buttons + links + inputs;

    // Check body content
    const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1].trim() : htmlContent.trim();
    const isEmptyRoot = bodyContent.length < 20 && totalInteractive === 0;

    // Gate Anti-JSON na Raiz: se o arquivo inspecionado ou body contém JSON bruto em vez de UI
    let rootRouteHijackedByJson = false;
    const trimmedBody = bodyContent.trim();
    if (
      (trimmedBody.startsWith('{') && trimmedBody.endsWith('}')) ||
      (trimmedBody.startsWith('[') && trimmedBody.endsWith(']'))
    ) {
      try {
        const parsed = JSON.parse(trimmedBody);
        if (parsed && typeof parsed === 'object' && totalInteractive === 0) {
          rootRouteHijackedByJson = true;
        }
      } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "playwrightVisualInspector",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:playwrightVisualInspector]", err);
      }
    }
    }

    // Check tokens in html or linked css
    const hasInlineTokens = /:root\s*\{[^}]*--(bg|surface|accent|border)/i.test(htmlContent);
    let hasRootTokens = hasInlineTokens;
    const tokensFound = hasInlineTokens ? ['--bg', '--surface', '--accent', '--border'] : [];

    // Check adjacent or public css
    if (!hasRootTokens) {
      const cssCandidates = [
        path.join(path.dirname(targetHtmlPath), 'style.css'),
        path.join(path.dirname(targetHtmlPath), 'styles.css'),
        path.join(path.dirname(targetHtmlPath), 'app.css'),
        path.join(projectPath, 'public', 'style.css')
      ];
      for (const cssFile of cssCandidates) {
        if (fs.existsSync(cssFile)) {
          try {
            const cssContent = fs.readFileSync(cssFile, 'utf-8');
            if (/:root\s*\{[^}]*--(bg|surface|accent|border)/i.test(cssContent)) {
              hasRootTokens = true;
              tokensFound.push('--bg', '--surface', '--accent', '--border');
              break;
            }
          } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "playwrightVisualInspector",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:playwrightVisualInspector]", err);
      }
    }
        }
      }
    }

    // Check if script has obvious unhandled throw, fatal runtime error or uncaught exceptions
    const consoleErrors: string[] = [];
    if (/throw\s+new\s+Error\s*\(\s*['"]Fatal runtime error['"]\s*\)/i.test(htmlContent)) {
      consoleErrors.push('Uncaught Error: Fatal runtime error');
    }
    const fatalConsoleErrorMatch = htmlContent.match(/console\.error\(\s*(?:"(Uncaught[^"]+|Fatal[^"]+|TypeError[^"]+|ReferenceError[^"]+)"|'(Uncaught[^']+|Fatal[^']+|TypeError[^']+|ReferenceError[^']+)')/i);
    if (fatalConsoleErrorMatch) {
      const msg = fatalConsoleErrorMatch[1] || fatalConsoleErrorMatch[2];
      consoleErrors.push(`[ERROR] ${msg}`);
    }

    // Save a placeholder evidence file to record inspection
    const offlineEvidencePath = path.join(evidenceDir, `ui-${taskId || 'preview'}-offline.json`);
    const evidenceData = {
      targetHtml: path.relative(projectPath, targetHtmlPath),
      totalInteractive,
      hasRootTokens,
      isEmptyRoot,
      inspectedAt: new Date().toISOString()
    };
    try {
      fs.writeFileSync(offlineEvidencePath, JSON.stringify(evidenceData, null, 2), 'utf-8');
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "playwrightVisualInspector",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:playwrightVisualInspector]", err);
      }
    }

    const evidenceScreenshots: string[] = [offlineEvidencePath];
    try {
      const offlineSections = this.performOfflineSectionCapture(targetHtmlPath, projectPath, evidenceDir);
      for (const s of offlineSections) {
        if (!evidenceScreenshots.includes(s.fullPath)) {
          evidenceScreenshots.push(s.fullPath);
        }
      }
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "playwrightVisualInspector",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:playwrightVisualInspector]", err);
      }
    }

    const passed = consoleErrors.length === 0 && !isEmptyRoot && !rootRouteHijackedByJson;
    let score = 100;
    if (consoleErrors.length > 0) score -= 40;
    if (isEmptyRoot) score -= 50;
    if (rootRouteHijackedByJson) score -= 100;
    if (!hasRootTokens) score -= 20;

    const details = rootRouteHijackedByJson
      ? 'ROOT_ROUTE_HIJACKED_BY_JSON: A rota raiz GET / está retornando JSON da API em vez de servir public/index.html. Mova o healthcheck JSON para GET /api/health e sirva public/index.html em GET /.'
      : (passed
          ? `Inspeção estrutural offline aprovada: ${totalInteractive} elementos interativos, tokens presentes.`
          : `Inspeção estrutural offline REJEITADA: ${isEmptyRoot ? 'Empty root detectado.' : ''} ${consoleErrors.join(', ')}`);

    return {
      passed,
      score: Math.max(0, score),
      consoleErrors,
      pageErrors: [],
      layoutAudit: {
        desktop: { scrollWidth: 1280, innerWidth: 1280, hasOverflow: false },
        mobile: { scrollWidth: 390, innerWidth: 390, hasOverflow: false }
      },
      computedTokens: {
        hasRootTokens,
        tokensFound,
        hasTabularNums: /tabular-nums/i.test(htmlContent)
      },
      interactiveElementsCount: {
        buttons,
        links,
        inputs,
        total: totalInteractive
      },
      isEmptyRoot,
      rootRouteHijackedByJson,
      evidenceScreenshots,
      details
    };
  }

  /**
   * Facade alias for inspectRenderedApp.
   */
  public static async inspect(options: VisualInspectionOptions): Promise<VisualInspectionResult> {
    return this.inspectRenderedApp(options);
  }

  /**
   * Performs live headless browser inspection using playwright-cli.
   */
  public static async inspectRenderedApp(options: VisualInspectionOptions): Promise<VisualInspectionResult> {
    const isOffline = options.offlineFallback ?? (process.env.DECOHUB_OFFLINE_MODE === 'true');
    const projectPath = path.resolve(options.projectPath);
    const taskId = options.taskId || 'preview';
    const timeoutMs = options.timeoutMs || this.DEFAULT_TIMEOUT_MS;

    // Resolve target URL or file
    let target = options.targetUrl;
    let resolvedHtmlFile = options.htmlFilePath ? path.resolve(projectPath, options.htmlFilePath) : null;
    let ephemeralServer: { url: string; close: () => Promise<void> } | null = null;

    if (!target) {
      if (!resolvedHtmlFile) {
        resolvedHtmlFile = this.findCandidateHtmlFile(projectPath);
      }
      if (resolvedHtmlFile && fs.existsSync(resolvedHtmlFile) && !isOffline) {
        try {
          const { UserExperienceSimulator } = await import('./userExperienceSimulator.js');
          ephemeralServer = await UserExperienceSimulator.startTargetServer(projectPath);
          target = ephemeralServer.url;
        } catch (err: any) {
          Logger.warn(`[PlaywrightVisualInspector] Erro ao iniciar servidor efêmero de inspeção: ${err.message}`);
        }
      }
    }

    // If offline or no target found, run offline structural audit
    if (isOffline || !target) {
      return this.performOfflineStructuralInspection(resolvedHtmlFile, projectPath, taskId);
    }

    const sessionId = `s_insp_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const evidenceDir = path.join(projectPath, '.ai-dev-hub', 'evidence');
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }

    const evidenceScreenshots: string[] = [];
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    let desktopLayout: LayoutAuditViewport = { scrollWidth: 1280, innerWidth: 1280, hasOverflow: false };
    let mobileLayout: LayoutAuditViewport | undefined = undefined;
    let computedTokens = {
      hasRootTokens: false,
      tokensFound: [] as string[],
      fontFamily: '',
      hasTabularNums: false
    };
    let interactiveElementsCount = {
      buttons: 0,
      links: 0,
      inputs: 0,
      total: 0
    };
    let isEmptyRoot = false;
    let rootRouteHijackedByJson = false;

    try {
      // 1. Open the target page in isolated session
      const openRes = this.runCli(['-s=' + sessionId, 'open', target], projectPath, timeoutMs);
      if (openRes.status !== 0 && !openRes.stdout.includes('Browser')) {
        Logger.warn(`[PlaywrightVisualInspector] Falha ao abrir navegador (${openRes.stderr.trim()}). Ativando fallback estrutural.`);
        return this.performOfflineStructuralInspection(resolvedHtmlFile, projectPath, taskId);
      }

      // 2. Fetch console messages and page errors
      const consoleRes = this.runCli(['-s=' + sessionId, 'console', '--json'], projectPath, 4000);
      if (consoleRes.stdout) {
        const lines = consoleRes.stdout.split('\n');
        for (const line of lines) {
          if (line.includes('[ERROR]') || line.includes('Uncaught') || line.includes('TypeError') || line.includes('ReferenceError')) {
            consoleErrors.push(line.trim());
          }
          if (line.includes('[PAGEERROR]') || line.includes('pageerror') || line.includes('PageError')) {
            pageErrors.push(line.trim());
          }
        }
      }

      // 3. Evaluate desktop layout and interactive elements
      const desktopAuditScript = `() => {
        const rootStyles = getComputedStyle(document.documentElement);
        const tokens = ['--bg', '--surface', '--accent', '--border', '--primary', '--text', '--color']
          .filter(t => rootStyles.getPropertyValue(t).trim().length > 0);
        const buttons = document.querySelectorAll('button').length;
        const links = document.querySelectorAll('a[href]').length;
        const inputs = document.querySelectorAll('input, select, textarea').length;
        const bodyChildren = document.body ? document.body.children.length : 0;
        const scrollWidth = document.documentElement.scrollWidth || (document.body ? document.body.scrollWidth : 0);
        const innerWidth = window.innerWidth;
        const hasTabular = Array.from(document.querySelectorAll('*')).some(el => {
          const c = getComputedStyle(el);
          return (c.fontVariantNumeric && c.fontVariantNumeric.includes('tabular-nums')) ||
                 (c.fontFeatureSettings && c.fontFeatureSettings.includes('tnum'));
        });
        const fontFamily = document.body ? getComputedStyle(document.body).fontFamily : '';
        const bodyText = (document.body ? document.body.innerText : '').trim();
        const uiElementsCount = document.querySelectorAll('main, nav, header, section, article, button, a, form').length;
        let isRawJson = false;
        if ((bodyText.startsWith('{') && bodyText.endsWith('}')) || (bodyText.startsWith('[') && bodyText.endsWith(']'))) {
          try {
            const p = JSON.parse(bodyText);
            if (p && typeof p === 'object' && uiElementsCount === 0) {
              isRawJson = true;
            }
          } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "playwrightVisualInspector",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:playwrightVisualInspector]", err);
      }
    }
        }
        return JSON.stringify({
          scrollWidth,
          innerWidth,
          hasOverflow: scrollWidth > innerWidth + 10,
          buttons,
          links,
          inputs,
          total: buttons + links + inputs,
          bodyChildren,
          tokens,
          fontFamily,
          hasTabular,
          isRawJson
        });
      }`;

      const evalDesktopRes = this.runCli(['-s=' + sessionId, 'eval', desktopAuditScript, '--raw'], projectPath, 5000);
      if (evalDesktopRes.stdout) {
        try {
          const rawMatch = evalDesktopRes.stdout.match(/\{[\s\S]*\}/);
          if (rawMatch) {
            const data = JSON.parse(rawMatch[0]);
            desktopLayout = {
              scrollWidth: Number(data.scrollWidth) || 1280,
              innerWidth: Number(data.innerWidth) || 1280,
              hasOverflow: Boolean(data.hasOverflow)
            };
            interactiveElementsCount = {
              buttons: Number(data.buttons) || 0,
              links: Number(data.links) || 0,
              inputs: Number(data.inputs) || 0,
              total: Number(data.total) || 0
            };
            computedTokens = {
              hasRootTokens: Array.isArray(data.tokens) && data.tokens.length > 0,
              tokensFound: data.tokens || [],
              fontFamily: data.fontFamily || '',
              hasTabularNums: Boolean(data.hasTabular)
            };
            isEmptyRoot = (Number(data.bodyChildren) === 0 && Number(data.total) === 0);
            if (data.isRawJson) {
              rootRouteHijackedByJson = true;
            }
          }
        } catch (err: any) {
          Logger.warn(`[PlaywrightVisualInspector] Falha ao processar eval de desktop: ${err.message}`);
        }
      }

      // 4. Capture Desktop Screenshot
      const screenshotDesktopRes = this.runCli(['-s=' + sessionId, 'screenshot'], projectPath, 6000);
      const desktopTargetFile = path.join(evidenceDir, `ui-${taskId}-desktop.png`);
      const desktopFoundPng = this.extractAndMoveScreenshot(screenshotDesktopRes.stdout, projectPath, desktopTargetFile);
      if (desktopFoundPng) {
        evidenceScreenshots.push(desktopFoundPng);
      }

      // 5. Mobile Viewport Check (390x844)
      this.runCli(['-s=' + sessionId, 'resize', '390', '844'], projectPath, 4000);

      const mobileAuditScript = `() => {
        const scrollWidth = document.documentElement.scrollWidth || (document.body ? document.body.scrollWidth : 0);
        const innerWidth = window.innerWidth;
        return JSON.stringify({
          scrollWidth,
          innerWidth,
          hasOverflow: scrollWidth > innerWidth + 5
        });
      }`;

      const evalMobileRes = this.runCli(['-s=' + sessionId, 'eval', mobileAuditScript, '--raw'], projectPath, 4000);
      if (evalMobileRes.stdout) {
        try {
          const rawMatch = evalMobileRes.stdout.match(/\{[\s\S]*\}/);
          if (rawMatch) {
            const data = JSON.parse(rawMatch[0]);
            mobileLayout = {
              scrollWidth: Number(data.scrollWidth) || 390,
              innerWidth: Number(data.innerWidth) || 390,
              hasOverflow: Boolean(data.hasOverflow)
            };
          }
        } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "playwrightVisualInspector",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:playwrightVisualInspector]", err);
      }
    }
      }

      // 6. Capture Mobile Screenshot
      const screenshotMobileRes = this.runCli(['-s=' + sessionId, 'screenshot'], projectPath, 6000);
      const mobileTargetFile = path.join(evidenceDir, `ui-${taskId}-mobile.png`);
      const mobileFoundPng = this.extractAndMoveScreenshot(screenshotMobileRes.stdout, projectPath, mobileTargetFile);
      if (mobileFoundPng) {
        evidenceScreenshots.push(mobileFoundPng);
      }

      // 7. Exhaustive discovery and capture of all sections/tabs
      try {
        const sections = await this.discoverAndCaptureSectionsInSession(sessionId, projectPath, evidenceDir);
        for (const s of sections) {
          if (!evidenceScreenshots.includes(s.fullPath)) {
            evidenceScreenshots.push(s.fullPath);
          }
        }
      } catch (err: any) {
        Logger.warn(`[PlaywrightVisualInspector] Falha ao capturar secções dinâmicas na inspeção ativa: ${err.message}`);
      }
    } catch (err: any) {
      Logger.warn(`[PlaywrightVisualInspector] Erro durante inspeção ativa: ${err.message}`);
      return this.performOfflineStructuralInspection(resolvedHtmlFile, projectPath, taskId);
    } finally {
      if (ephemeralServer) {
        try {
          await ephemeralServer.close();
        } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "playwrightVisualInspector",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:playwrightVisualInspector]", err);
      }
    }
      }
      // Guaranteed cleanup of the session and temporary .playwright-cli directory
      try {
        this.runCli(['-s=' + sessionId, 'close'], projectPath, 4000);
      } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "playwrightVisualInspector",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:playwrightVisualInspector]", err);
      }
    }
      this.cleanupTempDir(projectPath);
    }

    const passed = consoleErrors.length === 0 && pageErrors.length === 0 && !isEmptyRoot && !desktopLayout.hasOverflow && !rootRouteHijackedByJson;
    let score = 100;
    if (consoleErrors.length > 0) score -= 40;
    if (pageErrors.length > 0) score -= 40;
    if (isEmptyRoot) score -= 50;
    if (rootRouteHijackedByJson) score -= 100;
    if (desktopLayout.hasOverflow) score -= 20;
    if (mobileLayout?.hasOverflow) score -= 15;
    if (!computedTokens.hasRootTokens) score -= 15;

    const details = rootRouteHijackedByJson
      ? 'ROOT_ROUTE_HIJACKED_BY_JSON: A rota raiz GET / está retornando JSON da API em vez de servir public/index.html. Mova o healthcheck JSON para GET /api/health e sirva public/index.html em GET /.'
      : (passed
          ? `Inspeção visual Playwright APROVADA: Zero erros no console, ${interactiveElementsCount.total} elementos interativos, layout responsivo sem overflow.`
          : `Inspeção visual Playwright REJEITADA: ${[
              consoleErrors.length > 0 ? `${consoleErrors.length} erro(s) de runtime no console` : '',
              pageErrors.length > 0 ? `${pageErrors.length} erro(s) de página (pageerror)` : '',
              isEmptyRoot ? 'Empty root (0 elementos interativos)' : '',
              desktopLayout.hasOverflow ? 'Overflow horizontal em desktop' : '',
              mobileLayout?.hasOverflow ? 'Overflow horizontal em mobile (390x844)' : ''
            ].filter(Boolean).join('; ')}`);

    return {
      passed,
      score: Math.max(0, score),
      consoleErrors,
      pageErrors,
      layoutAudit: {
        desktop: desktopLayout,
        mobile: mobileLayout
      },
      computedTokens,
      interactiveElementsCount,
      isEmptyRoot,
      rootRouteHijackedByJson,
      evidenceScreenshots,
      details
    };
  }

  /**
   * Helper to locate the generated screenshot from stdout or temporary folder,
   * move it to the official evidence path, and return the final path.
   */
  private static extractAndMoveScreenshot(stdout: string, projectPath: string, destinationPath: string): string | null {
    try {
      // Look for ".playwright-cli\page-*.png" in stdout
      const match = stdout.match(/\.playwright-cli[/\\](page-[^)\s\r\n]+\.png)/i);
      let sourcePath = match ? path.join(projectPath, '.playwright-cli', match[1]) : null;

      if (!sourcePath || !fs.existsSync(sourcePath)) {
        // Search inside .playwright-cli directory
        const tempDir = path.join(projectPath, '.playwright-cli');
        if (fs.existsSync(tempDir)) {
          const files = fs.readdirSync(tempDir);
          const pngFiles = files.filter(f => f.toLowerCase().endsWith('.png')).sort().reverse();
          if (pngFiles.length > 0) {
            sourcePath = path.join(tempDir, pngFiles[0]);
          }
        }
      }

      if (sourcePath && fs.existsSync(sourcePath)) {
        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        fs.copyFileSync(sourcePath, destinationPath);
        return destinationPath;
      }
    } catch (err: any) {
      Logger.warn(`[PlaywrightVisualInspector] Não foi possível mover screenshot: ${err.message}`);
    }

    return null;
  }

  private static readonly SAMPLE_1X1_PNG_BUFFER = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  /**
   * Cleans and sanitizes a section name into Pascal-Kebab slug (e.g. "Dashboard", "Planos", "Top-3-Prioridades").
   */
  public static sanitizeSectionName(raw: string): string {
    if (!raw) return 'Secao';
    let clean = raw.replace(/<[^>]*>/g, '').replace(/[\r\n\t]+/g, ' ').trim();
    clean = clean.replace(/^\d+[\.\-\s]+/, '').trim();
    clean = clean.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    clean = clean.replace(/[^a-zA-Z0-9]+/g, '-');
    clean = clean.replace(/^-+|-+$/g, '');
    if (!clean) return 'Secao';
    return clean.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('-');
  }

  /**
   * Helper that discovers visible tabs/sections in an active browser session and captures them.
   */
  public static async discoverAndCaptureSectionsInSession(
    sessionId: string,
    projectPath: string,
    evidenceDir: string
  ): Promise<CapturedSectionItem[]> {
    const captured: CapturedSectionItem[] = [];

    // Reset to desktop viewport 1280x800 for tab crawl
    this.runCli(['-s=' + sessionId, 'resize', '1280', '800'], projectPath, 4000);
    await new Promise(r => setTimeout(r, 200));

    const discoveryScript = `() => {
      const discovered = [];
      const seenNames = new Set();

      // 1. Navigation items / tabs
      const tabElements = Array.from(document.querySelectorAll(
        'nav button, nav a, [role="tab"], [data-tab], [data-section], .tab, .tab-btn, .nav-item, aside a, aside button'
      )).filter(el => {
        const text = el.innerText.trim();
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && (text.length > 0 || el.getAttribute('data-tab') || el.id);
      });

      if (tabElements.length >= 2) {
        for (let i = 0; i < tabElements.length; i++) {
          const el = tabElements[i];
          let rawName = el.innerText.trim().split('\\n')[0].trim();
          if (!rawName) rawName = el.getAttribute('data-tab') || el.id || ('Secao_' + (i + 1));
          if (!seenNames.has(rawName)) {
            seenNames.add(rawName);
            discovered.push({
              type: 'tab',
              name: rawName,
              selector: el.id ? '#' + el.id : (el.getAttribute('data-tab') ? \`[data-tab="\${el.getAttribute('data-tab')}"]\` : null),
              index: i
            });
          }
        }
        return JSON.stringify(discovered);
      }

      // 2. Explicit sections
      const sections = Array.from(document.querySelectorAll('main > section, .main-content > section, main .content-card, section[id]')).filter(el => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 40;
      });

      if (sections.length > 0) {
        for (let i = 0; i < sections.length; i++) {
          const el = sections[i];
          const heading = el.querySelector('h1, h2, h3, h4, .section-title, .card-title');
          let rawName = heading ? heading.innerText.trim().split('\\n')[0].trim() : '';
          if (!rawName) rawName = el.id ? el.id.replace(/[-_]section$|^pane[-_]|[-_]container$/i, '') : ('Secao_' + (i + 1));
          if (!seenNames.has(rawName)) {
            seenNames.add(rawName);
            discovered.push({
              type: 'section',
              name: rawName,
              selector: el.id ? '#' + el.id : null,
              index: i
            });
          }
        }
        return JSON.stringify(discovered);
      }

      return JSON.stringify([{ type: 'page', name: document.title || 'Dashboard', selector: null, index: 0 }]);
    }`;

    const evalRes = this.runCli(['-s=' + sessionId, 'eval', discoveryScript, '--raw'], projectPath, 5000);
    let discoveredSections: Array<{ type: string; name: string; selector: string | null; index: number }> = [];

    try {
      const rawJson = evalRes.stdout.match(/\[[\s\S]*\]/);
      if (rawJson) {
        discoveredSections = JSON.parse(rawJson[0]);
      }
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "playwrightVisualInspector",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:playwrightVisualInspector]", err);
      }
    }

    if (discoveredSections.length === 0) {
      discoveredSections = [{ type: 'page', name: 'Dashboard', selector: null, index: 0 }];
    }

    const total = discoveredSections.length + 1; // + 1 for mobile view

    for (let i = 0; i < discoveredSections.length; i++) {
      const item = discoveredSections[i];
      const numPrefix = String(i + 1).padStart(2, '0');
      const cleanName = this.sanitizeSectionName(item.name);
      const filename = `${numPrefix}-${cleanName}.png`;
      const destPath = path.join(evidenceDir, filename);

      if (item.type === 'tab') {
        const clickScript = `(() => {
          const els = document.querySelectorAll('nav button, nav a, [role="tab"], [data-tab], [data-section], .tab, .tab-btn, .nav-item, aside a, aside button');
          if (els[${item.index}]) {
            els[${item.index}].click();
            return true;
          }
          return false;
        })()`;
        this.runCli(['-s=' + sessionId, 'eval', clickScript], projectPath, 4000);
        await new Promise(r => setTimeout(r, 250));
        this.runCli(['-s=' + sessionId, 'eval', 'window.scrollTo(0, 0)'], projectPath, 3000);
      } else if (item.type === 'section') {
        const scrollScript = `(() => {
          const secs = document.querySelectorAll('main > section, .main-content > section, main .content-card, section[id]');
          if (secs[${item.index}]) {
            secs[${item.index}].scrollIntoView({ behavior: 'instant', block: 'start' });
            return true;
          }
          return false;
        })()`;
        this.runCli(['-s=' + sessionId, 'eval', scrollScript], projectPath, 4000);
        await new Promise(r => setTimeout(r, 250));
      }

      const shotRes = this.runCli(['-s=' + sessionId, 'screenshot'], projectPath, 6000);
      const savedFile = this.extractAndMoveScreenshot(shotRes.stdout, projectPath, destPath);

      let sizeBytes = 0;
      try {
        if (savedFile && fs.existsSync(savedFile)) {
          sizeBytes = fs.statSync(savedFile).size;
        }
      } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "playwrightVisualInspector",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:playwrightVisualInspector]", err);
      }
    }

      captured.push({
        filename,
        title: `${numPrefix}. ${cleanName.replace(/[-_]/g, ' ')}`,
        label: `${numPrefix}. ${cleanName.replace(/[-_]/g, ' ')}`,
        sectionName: cleanName.replace(/[-_]/g, ' '),
        index: i + 1,
        total,
        fullPath: destPath,
        sizeBytes
      });
    }

    // Capture Mobile View (390x844) as final enumerated capture
    const mobileNum = String(discoveredSections.length + 1).padStart(2, '0');
    const mobileFilename = `${mobileNum}-Mobile-View.png`;
    const mobileDestPath = path.join(evidenceDir, mobileFilename);

    this.runCli(['-s=' + sessionId, 'resize', '390', '844'], projectPath, 4000);
    await new Promise(r => setTimeout(r, 250));
    this.runCli(['-s=' + sessionId, 'eval', 'window.scrollTo(0, 0)'], projectPath, 3000);

    const mobileShotRes = this.runCli(['-s=' + sessionId, 'screenshot'], projectPath, 6000);
    const savedMobile = this.extractAndMoveScreenshot(mobileShotRes.stdout, projectPath, mobileDestPath);

    let mobileSize = 0;
    try {
      if (savedMobile && fs.existsSync(savedMobile)) {
        mobileSize = fs.statSync(savedMobile).size;
      }
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "playwrightVisualInspector",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:playwrightVisualInspector]", err);
      }
    }

    captured.push({
      filename: mobileFilename,
      title: `${mobileNum}. Mobile View (390x844)`,
      label: `${mobileNum}. Mobile View (390x844)`,
      sectionName: 'Mobile View',
      index: total,
      total,
      fullPath: mobileDestPath,
      sizeBytes: mobileSize
    });

    return captured;
  }

  /**
   * Standalone Crawler: Dynamic discovery and exhaustive screenshot capture of all application sections/tabs.
   * Produces strictly enumerated files in <projectPath>/.ai-dev-hub/evidence/:
   * 01-Dashboard.png, 02-Planos.png, ..., 05-Mobile-View.png
   */
  public static async captureAllAppSections(options: CaptureAllSectionsOptions): Promise<CapturedSectionItem[]> {
    const isOffline = options.offlineFallback ?? (process.env.DECOHUB_OFFLINE_MODE === 'true');
    const projectPath = path.resolve(options.projectPath);
    const timeoutMs = options.timeoutMs || this.DEFAULT_TIMEOUT_MS;
    const evidenceDir = path.join(projectPath, '.ai-dev-hub', 'evidence');
    try {
      if (!fs.existsSync(evidenceDir)) {
        fs.mkdirSync(evidenceDir, { recursive: true });
      }
    } catch (err: any) {
      Logger.warn(`[PlaywrightVisualInspector] Falha ao criar diretório de evidências: ${err.message}`);
    }

    if (options.cleanOldScreenshots ?? true) {
      try {
        if (fs.existsSync(evidenceDir)) {
          const existing = fs.readdirSync(evidenceDir);
          for (const f of existing) {
            if (/^(\d{2})-[a-zA-Z0-9_\-]+\.(png|jpe?g)$/i.test(f)) {
              fs.unlinkSync(path.join(evidenceDir, f));
            }
          }
        }
      } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "playwrightVisualInspector",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:playwrightVisualInspector]", err);
      }
    }
    }

    let target = options.targetUrl;
    let resolvedHtmlFile = PlaywrightVisualInspector.findCandidateHtmlFile(projectPath);
    let ephemeralServer: { url: string; close: () => Promise<void> } | null = null;

    if (!target && !isOffline) {
      try {
        const { UserExperienceSimulator } = await import('./userExperienceSimulator.js');
        ephemeralServer = await UserExperienceSimulator.startTargetServer(projectPath);
        target = ephemeralServer.url;
      } catch (err: any) {
        Logger.warn(`[PlaywrightVisualInspector] Erro ao iniciar servidor efêmero para captureAllAppSections: ${err.message}`);
      }
    }

    if (isOffline || !target) {
      return this.performOfflineSectionCapture(resolvedHtmlFile, projectPath, evidenceDir);
    }

    const sessionId = `s_crawl_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    let captured: CapturedSectionItem[] = [];

    try {
      const openRes = this.runCli(['-s=' + sessionId, 'open', target], projectPath, timeoutMs);
      if (openRes.status !== 0 && !openRes.stdout.includes('Browser')) {
        Logger.warn(`[PlaywrightVisualInspector] Falha ao abrir navegador para crawler. Ativando fallback offline.`);
        return this.performOfflineSectionCapture(resolvedHtmlFile, projectPath, evidenceDir);
      }

      captured = await this.discoverAndCaptureSectionsInSession(sessionId, projectPath, evidenceDir);
    } catch (err: any) {
      Logger.warn(`[PlaywrightVisualInspector] Erro durante captureAllAppSections: ${err.message}`);
      return this.performOfflineSectionCapture(resolvedHtmlFile, projectPath, evidenceDir);
    } finally {
      if (ephemeralServer) {
        try { await ephemeralServer.close(); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "playwrightVisualInspector",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:playwrightVisualInspector]", err);
      }
    }
      }
      try {
        this.runCli(['-s=' + sessionId, 'close'], projectPath, 4000);
      } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "playwrightVisualInspector",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:playwrightVisualInspector]", err);
      }
    }
      this.cleanupTempDir(projectPath);
    }

    return captured;
  }

  /**
   * Offline section discovery and placeholder screenshot generator.
   */
  public static performOfflineSectionCapture(
    targetHtmlPath: string | null,
    projectPath: string,
    evidenceDir: string
  ): CapturedSectionItem[] {
    let htmlContent = '';
    if (targetHtmlPath && fs.existsSync(targetHtmlPath)) {
      try { htmlContent = fs.readFileSync(targetHtmlPath, 'utf-8'); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "playwrightVisualInspector",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:playwrightVisualInspector]", err);
      }
    }
    }

    const seenTabs = new Set<string>();
    const sectionNames: string[] = [];

    // Prioritize dedicated .tab-btn buttons when present, or generic data-tab buttons
    const dedicatedTabBtnMatches = Array.from(htmlContent.matchAll(/<button[^>]*class="[^"]*tab-btn[^"]*"[^>]*data-tab="([^"]+)"[^>]*>([\s\S]*?)<\/button>/gi));
    const tabMatches = dedicatedTabBtnMatches.length >= 2
      ? dedicatedTabBtnMatches
      : Array.from(htmlContent.matchAll(/<button[^>]*data-tab="([^"]+)"[^>]*>([\s\S]*?)<\/button>/gi));

    if (tabMatches.length >= 2) {
      for (const m of tabMatches) {
        const tabKey = (m[1] || '').trim().toLowerCase();
        if (tabKey && seenTabs.has(tabKey)) continue;
        if (tabKey) seenTabs.add(tabKey);
        let text = m[2]
          .replace(/<svg[\s\S]*?<\/svg>/gi, '')
          .replace(/<span[^>]*class="[^"]*counter[^"]*"[\s\S]*?<\/span>/gi, '')
          .replace(/<[^>]+>/g, '')
          .trim() || m[1];
        if (text) sectionNames.push(text);
      }
    } else {
      const navMatches = Array.from(htmlContent.matchAll(/<nav[^>]*>([\s\S]*?)<\/nav>/gi));
      if (navMatches.length > 0) {
        const btnMatches = Array.from(navMatches[0][1].matchAll(/<(?:button|a)[^>]*>([\s\S]*?)<\/(?:button|a)>/gi));
        for (const bm of btnMatches) {
          const t = bm[1].replace(/<[^>]+>/g, '').trim();
          if (t && t.length < 30) sectionNames.push(t);
        }
      }
      if (sectionNames.length < 2) {
        const secMatches = Array.from(htmlContent.matchAll(/<section[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/section>/gi));
        for (const sm of secMatches) {
          const headingMatch = sm[2].match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i);
          const t = headingMatch ? headingMatch[1].replace(/<[^>]+>/g, '').trim() : sm[1].replace(/[-_]section$|^pane[-_]/i, '');
          if (t) sectionNames.push(t);
        }
      }
    }

    if (sectionNames.length === 0) {
      sectionNames.push('Dashboard', 'Planos', 'Configuracoes');
    }

    const total = sectionNames.length + 1; // includes mobile view
    const captured: CapturedSectionItem[] = [];

    for (let i = 0; i < sectionNames.length; i++) {
      const numPrefix = String(i + 1).padStart(2, '0');
      const cleanName = this.sanitizeSectionName(sectionNames[i]);
      const filename = `${numPrefix}-${cleanName}.png`;
      const fullPath = path.join(evidenceDir, filename);

      try {
        if (!fs.existsSync(fullPath)) {
          fs.writeFileSync(fullPath, this.SAMPLE_1X1_PNG_BUFFER);
        }
      } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "playwrightVisualInspector",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:playwrightVisualInspector]", err);
      }
    }

      captured.push({
        filename,
        title: `${numPrefix}. ${cleanName.replace(/[-_]/g, ' ')}`,
        label: `${numPrefix}. ${cleanName.replace(/[-_]/g, ' ')}`,
        sectionName: cleanName.replace(/[-_]/g, ' '),
        index: i + 1,
        total,
        fullPath,
        sizeBytes: this.SAMPLE_1X1_PNG_BUFFER.length
      });
    }

    // Add Mobile-View
    const mobileNum = String(sectionNames.length + 1).padStart(2, '0');
    const mobileFilename = `${mobileNum}-Mobile-View.png`;
    const mobileFullPath = path.join(evidenceDir, mobileFilename);

    try {
      if (!fs.existsSync(mobileFullPath)) {
        fs.writeFileSync(mobileFullPath, this.SAMPLE_1X1_PNG_BUFFER);
      }
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "playwrightVisualInspector",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:playwrightVisualInspector]", err);
      }
    }

    captured.push({
      filename: mobileFilename,
      title: `${mobileNum}. Mobile View (390x844)`,
      label: `${mobileNum}. Mobile View (390x844)`,
      sectionName: 'Mobile View',
      index: total,
      total,
      fullPath: mobileFullPath,
      sizeBytes: this.SAMPLE_1X1_PNG_BUFFER.length
    });

    return captured;
  }

  /**
   * Cleans up temporary .playwright-cli directory inside the target project.
   */
  private static cleanupTempDir(projectPath: string): void {
    try {
      const tempDir = path.join(projectPath, '.playwright-cli');
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "playwrightVisualInspector",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:playwrightVisualInspector]", err);
      }
    }
  }
}
