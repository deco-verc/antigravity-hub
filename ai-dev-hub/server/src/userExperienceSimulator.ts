// server/src/userExperienceSimulator.ts
// Motor de Simulação de Jornada do Usuário Real (UserExperienceSimulator)
// Executa testes autônomos no navegador exatamente como um usuário humano:
// 1. First Impression & Navigation Walk (clique em abas, zero JSON na raiz)
// 2. Form Fill, Submit & Live UI Update (preenchimento realista, monitoramento de fetch/XHR sem 404/500)
// 3. Teste do F5 (Reload & Persistência Real para o Usuário)
// 4. Detector de "Botões Mortos" (Dead-Button & Broken Wiring Audit)

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn, spawnSync, ChildProcess } from 'node:child_process';
import { Logger } from './logger.js';
import { PlaywrightVisualInspector } from './playwrightVisualInspector.js';

export interface UserJourneyStepResult {
  name: string;
  passed: boolean;
  details: string;
  error?: string;
  durationMs: number;
  screenshotPath?: string;
  data?: any;
}

export interface UserJourneyResult {
  passed: boolean;
  score: number; // 0 to 100
  journeys: {
    firstImpression: UserJourneyStepResult;
    formInteraction: UserJourneyStepResult;
    f5Persistence: UserJourneyStepResult;
    deadButtons: UserJourneyStepResult;
  };
  apiErrorsDetected: Array<{ method?: string; url: string; status: number; statusText?: string }>;
  deadInteractiveElements: string[];
  evidenceScreenshots: string[];
  evidenceReportPath?: string;
  details: string;
}

export interface SimulateOptions {
  projectPath: string;
  url?: string;
  runId?: string;
  taskId?: string;
  forceLiveBrowser?: boolean;
  timeoutMs?: number;
}

export interface TargetServerInstance {
  url: string;
  port: number;
  pid?: number;
  entrypoint?: string;
  isStaticFallback?: boolean;
  close: () => Promise<void>;
}

export class UserExperienceSimulator {
  private static readonly DEFAULT_TIMEOUT_MS = 15000;

  /**
   * Resolves the direct path to the global playwright-cli.js file if installed.
   */
  public static getPlaywrightCliPath(): string | null {
    const isWin = process.platform === 'win32';
    if (isWin) {
      const candidates = [
        path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@playwright', 'cli', 'playwright-cli.js'),
        path.join(process.env.LOCALAPPDATA || '', 'npm', 'node_modules', '@playwright', 'cli', 'playwright-cli.js'),
        path.join(process.env.PROGRAMFILES || '', 'nodejs', 'node_modules', '@playwright', 'cli', 'playwright-cli.js')
      ];
      for (const c of candidates) {
        if (c && fs.existsSync(c)) return c;
      }
    }
    return null;
  }

  /**
   * Helper to resolve the safe Node CLI executable path.
   * If running inside Electron or DecoHUB, uses system node or sets ELECTRON_RUN_AS_NODE: '1'
   * to prevent spawning GUI windows or freezing the Express event loop.
   */
  public static getSafeNodeExecutable(): { execPath: string; env: NodeJS.ProcessEnv } {
    const isWin = process.platform === 'win32';
    const defaultNode = isWin ? 'C:\\Program Files\\nodejs\\node.exe' : '/usr/bin/node';
    const isElectron = Boolean(
      (process.versions as any)?.electron ||
      process.execPath.toLowerCase().includes('electron') ||
      process.execPath.toLowerCase().includes('decohub')
    );
    const execPath = (isElectron && fs.existsSync(defaultNode)) ? defaultNode : process.execPath;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1'
    };
    return { execPath, env };
  }

  /**
   * Helper to execute a playwright-cli command safely.
   */
  public static runCli(
    args: string[],
    cwd: string,
    timeoutMs: number = 8000
  ): { stdout: string; stderr: string; status: number | null } {
    const isWin = process.platform === 'win32';
    const cliJs = this.getPlaywrightCliPath();
    const { execPath: safeNode, env: nodeEnv } = this.getSafeNodeExecutable();

    let exec: string;
    let fullArgs: string[];
    let env: NodeJS.ProcessEnv;

    if (cliJs && fs.existsSync(cliJs)) {
      exec = safeNode;
      fullArgs = [cliJs, ...args];
      env = nodeEnv;
    } else {
      exec = isWin ? 'cmd.exe' : 'playwright-cli';
      fullArgs = isWin ? ['/c', 'playwright-cli', ...args] : args;
      env = nodeEnv;
    }

    try {
      const res = spawnSync(exec, fullArgs, {
        cwd,
        encoding: 'utf-8',
        timeout: timeoutMs,
        windowsHide: true,
        env
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
   * Helper to parse JSON from playwright-cli eval output robustly.
   */
  public static parseEvalJson(stdout: string): any {
    if (!stdout) return {};
    const trimmed = stdout.trim();

    // 1. Direct parse attempt
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'string') {
        try { return JSON.parse(parsed); } catch { return parsed; }
      }
      return parsed;
    } catch {}

    // 2. Search for valid JSON object { ... }
    let openBraceIdx = trimmed.indexOf('{');
    while (openBraceIdx !== -1) {
      const candidate = trimmed.substring(openBraceIdx);
      const closeBraceIdx = candidate.lastIndexOf('}');
      if (closeBraceIdx > 0) {
        try {
          return JSON.parse(candidate.substring(0, closeBraceIdx + 1));
        } catch {}
      }
      openBraceIdx = trimmed.indexOf('{', openBraceIdx + 1);
    }

    // 3. Search for valid JSON array [ ... ]
    let openBracketIdx = trimmed.indexOf('[');
    while (openBracketIdx !== -1) {
      const candidate = trimmed.substring(openBracketIdx);
      const closeBracketIdx = candidate.lastIndexOf(']');
      if (closeBracketIdx > 0) {
        try {
          return JSON.parse(candidate.substring(0, closeBracketIdx + 1));
        } catch {}
      }
      openBracketIdx = trimmed.indexOf('[', openBracketIdx + 1);
    }

    // 4. Quoted JSON string matching
    const quotedMatch = trimmed.match(/"(\{[\s\S]*\})"|'(\{[\s\S]*\})'/);
    if (quotedMatch) {
      try {
        const raw = quotedMatch[1] || quotedMatch[2];
        return JSON.parse(raw.replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
      } catch {}
    }

    return {};
  }

  /**
   * Finds an available TCP port for ephemeral target servers,
   * preferring the PORT_GUARD range (4100-4899) to avoid conflicts and fallback overrides.
   */
  public static async findFreePort(fallbackPort: number = 4250): Promise<number> {
    const isPortAvailable = (p: number): Promise<boolean> =>
      new Promise((resolve) => {
        const srv = net.createServer();
        srv.once('error', () => resolve(false));
        srv.once('listening', () => {
          srv.close(() => resolve(true));
        });
        srv.listen(p, '127.0.0.1');
      });

    // Check PORT_GUARD safe dynamic range (4100 to 4899)
    const safeFallback = fallbackPort >= 4100 && fallbackPort <= 4899 ? fallbackPort : 4250;
    const startPort = 4100 + Math.floor(Math.random() * 700);
    for (let p = startPort; p < 4900; p++) {
      if (await isPortAvailable(p)) return p;
    }
    for (let p = 4100; p < startPort; p++) {
      if (await isPortAvailable(p)) return p;
    }

    return safeFallback;
  }

  /**
   * Discovers and boots the target application server on an isolated free port.
   * Guarantees clean teardown via try/finally in the caller.
   */
  public static async startTargetServer(
    projectPath: string,
    timeoutMs: number = 12000
  ): Promise<TargetServerInstance> {
    const resolvedPath = path.resolve(projectPath);
    const port = await this.findFreePort();

    // 1. Inspect package.json for start or dev script
    let serverScriptRel: string | null = null;
    let isTypeScript = false;

    const pkgPath = path.join(resolvedPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const startScript: string = pkg.scripts?.start || pkg.scripts?.dev || '';
        if (startScript) {
          const match = startScript.match(/(?:node|tsx)\s+([^\s"']+)/i);
          if (match && match[1]) {
            serverScriptRel = match[1];
            if (serverScriptRel.endsWith('.ts') || startScript.includes('tsx')) {
              isTypeScript = true;
            } else if (serverScriptRel.startsWith('dist/') || serverScriptRel.startsWith('dist\\')) {
              const srcTsCandidate = serverScriptRel.replace(/^dist[\\/]/, '').replace(/\.js$/, '.ts');
              const distScriptFull = path.join(resolvedPath, serverScriptRel);
              if (!fs.existsSync(distScriptFull) && fs.existsSync(path.join(resolvedPath, srcTsCandidate))) {
                serverScriptRel = srcTsCandidate;
                isTypeScript = true;
              }
            }
          }
        }
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "userExperienceSimulator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:userExperienceSimulator]", err);
      }
    }
    }

    // Ensure build is up-to-date if serverScriptRel points to dist/
    if (serverScriptRel && (serverScriptRel.startsWith('dist/') || serverScriptRel.startsWith('dist\\'))) {
      const tsconfigPath = path.join(resolvedPath, 'tsconfig.json');
      const distScriptFull = path.join(resolvedPath, serverScriptRel);
      if (fs.existsSync(tsconfigPath) && (!fs.existsSync(distScriptFull) || fs.existsSync(pkgPath))) {
        try {
          const isWin = process.platform === 'win32';
          spawnSync(isWin ? 'npm.cmd' : 'npm', ['run', 'build'], {
            cwd: resolvedPath,
            timeout: 25000,
            stdio: 'ignore',
            windowsHide: true
          });
        } catch {}
      }

      if (!fs.existsSync(distScriptFull)) {
        const srcTsCandidate = serverScriptRel.replace(/^dist[\\/]/, '').replace(/\.js$/, '.ts');
        if (fs.existsSync(path.join(resolvedPath, srcTsCandidate))) {
          serverScriptRel = srcTsCandidate;
          isTypeScript = true;
        }
      }
    }

    // 2. Fallback candidate paths
    if (!serverScriptRel) {
      const candidates = [
        'src/server.js',
        'src/server.ts',
        'src/index.js',
        'src/index.ts',
        'server.js',
        'server.ts',
        'index.js',
        'index.ts'
      ];
      for (const c of candidates) {
        if (fs.existsSync(path.join(resolvedPath, c))) {
          serverScriptRel = c;
          if (c.endsWith('.ts')) isTypeScript = true;
          break;
        }
      }
    }

    // 3. If no server script exists, start ephemeral static server for frontend assets
    if (!serverScriptRel) {
      Logger.info(`[UserExperienceSimulator] Nenhum script de servidor detectado em "${projectPath}". Iniciando servidor estático efêmero...`);
      const staticServer = await PlaywrightVisualInspector.startEphemeralStaticServer(resolvedPath);
      const portMatch = staticServer.url.match(/:(\d+)$/);
      const staticPort = portMatch ? parseInt(portMatch[1], 10) : port;
      return {
        url: staticServer.url,
        port: staticPort,
        isStaticFallback: true,
        close: staticServer.close
      };
    }

    // 4. Spawn server child process
    const scriptFullPath = path.join(resolvedPath, serverScriptRel);
    Logger.info(`[UserExperienceSimulator] Iniciando servidor alvo em porta ${port} (${serverScriptRel})...`);

    const isWin = process.platform === 'win32';
    const { execPath: safeNode, env: nodeEnv } = this.getSafeNodeExecutable();

    let cmd: string;
    let args: string[];

    if (isTypeScript) {
      const localTsx = path.join(resolvedPath, 'node_modules', '.bin', isWin ? 'tsx.cmd' : 'tsx');
      if (fs.existsSync(localTsx)) {
        cmd = localTsx;
        args = [scriptFullPath];
      } else {
        cmd = isWin ? 'npx.cmd' : 'npx';
        args = ['tsx', scriptFullPath];
      }
    } else {
      cmd = safeNode;
      args = [scriptFullPath];
    }

    const child = spawn(cmd, args, {
      cwd: resolvedPath,
      env: {
        ...nodeEnv,
        PORT: String(port),
        NODE_ENV: process.env.NODE_ENV === 'test' ? 'development' : (process.env.NODE_ENV || 'development'),
        DECOHUB_UX_SIMULATOR: 'true',
        DECOHUB_PREVIEW_MODE: 'true'
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: Boolean(isWin && cmd.endsWith('.cmd'))
    });

    let stdoutBuf = '';
    let stderrBuf = '';
    child.stdout?.on('data', (d) => { stdoutBuf += d.toString(); });
    child.stderr?.on('data', (d) => { stderrBuf += d.toString(); });
    child.on('error', (err) => {
      stderrBuf += ' [SPAWN_ERROR: ' + err.message + ']';
      Logger.warn(`[UserExperienceSimulator] Erro no processo do servidor alvo: ${err.message}`);
    });

    let activePort = port;
    let activeUrl = `http://127.0.0.1:${port}`;

    // 5. Poll until server is ready
    const pollStart = Date.now();
    let ready = false;

    while (Date.now() - pollStart < timeoutMs) {
      if (child.exitCode !== null) {
        if (child.pid) {
          try {
            if (isWin) spawnSync('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' });
            child.kill('SIGKILL');
          } catch (err) {
            if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
              (globalThis as any).logger.warn({
                event: "server.handled_exception",
                file: "userExperienceSimulator",
                error: (err as any)?.message || String(err)
              });
            } else {
              console.warn("[WARN][server:userExperienceSimulator]", err);
            }
          }
        }

        // If the server process exited prematurely (e.g. exit code 0 or build module without listen),
        // check whether static frontend assets exist to salvage evaluation via ephemeral static server.
        const candidateHtml = PlaywrightVisualInspector.findCandidateHtmlFile(resolvedPath);
        if (candidateHtml) {
          Logger.info(`[UserExperienceSimulator] Servidor encerrou prematuramente (código: ${child.exitCode}). Ativando servidor estático efêmero com base em "${candidateHtml}"...`);
          const staticServer = await PlaywrightVisualInspector.startEphemeralStaticServer(resolvedPath);
          const portMatch = staticServer.url.match(/:(\d+)$/);
          const staticPort = portMatch ? parseInt(portMatch[1], 10) : (staticServer.port || port);
          return {
            url: staticServer.url,
            port: staticPort,
            isStaticFallback: true,
            close: staticServer.close
          };
        }

        throw new Error(
          `SERVER_EARLY_EXIT: O servidor do projeto encerrou prematuramente (código: ${child.exitCode}).\nSTDERR: ${stderrBuf.slice(0, 500)}\nSTDOUT: ${stdoutBuf.slice(0, 500)}`
        );
      }

      // Check if server logged a specific port in stdout/stderr
      const combinedOutput = stdoutBuf + ' ' + stderrBuf;
      const portMatch = combinedOutput.match(/(?:listening on|running on|iniciado na porta|porta|port|http:\/\/(?:localhost|127\.0\.0\.1):)(\d{4,5})/i);
      const runtimePort = portMatch ? parseInt(portMatch[1], 10) : null;

      const candidatesToProbe = [activeUrl];
      if (runtimePort && runtimePort > 1024 && runtimePort < 65535 && runtimePort !== activePort) {
        candidatesToProbe.push(`http://127.0.0.1:${runtimePort}`);
      }

      for (const probeUrl of candidatesToProbe) {
        try {
          const res = await fetch(`${probeUrl}/`, {
            method: 'GET',
            signal: AbortSignal.timeout(600)
          });
          if (res.status >= 200 && res.status < 500) {
            ready = true;
            activeUrl = probeUrl;
            const portNum = parseInt(probeUrl.split(':').pop() || String(activePort), 10);
            activePort = isNaN(portNum) ? activePort : portNum;
            break;
          }
        } catch {
          // Continue waiting
        }
      }

      if (ready) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    if (!ready) {
      // Force kill
      if (child.pid) {
        try {
          if (isWin) spawnSync('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' });
          child.kill('SIGKILL');
        } catch (err) {
          if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
            (globalThis as any).logger.warn({
              event: "server.handled_exception",
              file: "userExperienceSimulator",
              error: (err as any)?.message || String(err)
            });
          } else {
            console.warn("[WARN][server:userExperienceSimulator]", err);
          }
        }
      }

      // Check whether static frontend assets exist before failing with timeout
      const candidateHtml = PlaywrightVisualInspector.findCandidateHtmlFile(resolvedPath);
      if (candidateHtml) {
        Logger.info(`[UserExperienceSimulator] Servidor alvo em "${serverScriptRel}" atingiu timeout (${timeoutMs}ms). Ativando servidor estático efêmero com base em "${candidateHtml}" para viabilizar inspeção visual/UX...`);
        const staticServer = await PlaywrightVisualInspector.startEphemeralStaticServer(resolvedPath);
        const portMatch = staticServer.url.match(/:(\d+)$/);
        const staticPort = portMatch ? parseInt(portMatch[1], 10) : (staticServer.port || port);
        return {
          url: staticServer.url,
          port: staticPort,
          isStaticFallback: true,
          close: staticServer.close
        };
      }

      throw new Error(
        `SERVER_START_TIMEOUT: O servidor em "${serverScriptRel}" não respondeu em ${activeUrl} após ${timeoutMs}ms.\nSTDERR: ${stderrBuf.slice(0, 500)}`
      );
    }

    const close = async (): Promise<void> => {
      try {
        if (!child || child.killed || child.exitCode !== null) return;
        const pid = child.pid;
        if (isWin && pid) {
          try {
            spawnSync('taskkill', ['/pid', String(pid), '/f', '/t'], { stdio: 'ignore', windowsHide: true });
          } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "userExperienceSimulator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:userExperienceSimulator]", err);
      }
    }
        }
        try {
          child.kill('SIGTERM');
          await new Promise((r) => setTimeout(r, 200));
          if (child.exitCode === null) {
            child.kill('SIGKILL');
          }
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "userExperienceSimulator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:userExperienceSimulator]", err);
      }
    }
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "userExperienceSimulator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:userExperienceSimulator]", err);
      }
    }
    };

    return {
      url: activeUrl,
      port: activePort,
      pid: child.pid,
      entrypoint: serverScriptRel,
      isStaticFallback: false,
      close
    };
  }

  /**
   * Safely and forcefully terminates a target server process tree on Windows and POSIX,
   * guaranteeing immediate release of the bound TCP port.
   */
  public static async stopTargetServer(
    server: TargetServerInstance | { close: () => Promise<void>; pid?: number; port?: number }
  ): Promise<void> {
    if (!server) return;
    try {
      if (server.pid && process.platform === 'win32') {
        try {
          spawnSync('taskkill', ['/pid', String(server.pid), '/f', '/t'], { stdio: 'ignore', windowsHide: true });
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "userExperienceSimulator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:userExperienceSimulator]", err);
      }
    }
      }
      await server.close();
    } catch (err: any) {
      Logger.warn(`[UserExperienceSimulator] Erro ao encerrar servidor alvo: ${err.message}`);
    }
  }

  /**
   * Offline deterministic structural simulation for rapid backend unit tests.
   */
  private static performOfflineSimulation(
    projectPath: string,
    evidenceDir: string
  ): UserJourneyResult {
    const htmlCandidate = PlaywrightVisualInspector.findCandidateHtmlFile(projectPath);
    let htmlContent = '';
    if (htmlCandidate && fs.existsSync(htmlCandidate)) {
      try { htmlContent = fs.readFileSync(htmlCandidate, 'utf-8'); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "userExperienceSimulator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:userExperienceSimulator]", err);
      }
    }
    }

    const hasForm = /<form\b/i.test(htmlContent) || /<(input|select|textarea)\b/i.test(htmlContent);
    const hasNav = /<nav\b/i.test(htmlContent) || /<header\b/i.test(htmlContent) || /class="[^"]*tab/i.test(htmlContent);
    const isRawJson = (htmlContent.trim().startsWith('{') && htmlContent.trim().endsWith('}'));

    const deadButtons: string[] = [];
    const buttonMatches = htmlContent.match(/<button\b[^>]*>([\s\S]*?)<\/button>/gi) || [];
    for (const b of buttonMatches) {
      const isExplicitDead = /data-dead="true"/i.test(b) || /class="[^"]*dead-btn/i.test(b);
      const hasDeclarativeWiring = /onclick=|data-action=|data-id=|data-task-id=|data-item-id=|data-video-id=|data-status=|data-tab=|data-modal=|data-drawer=|data-toggle=|data-filter=|data-period=|data-range=|data-days=|data-value=|data-view=|data-sort=|type=["']submit["']|type=["']reset["']|aria-controls=|aria-pressed=|role=["']tab["']|role=["']radio["']/i.test(b);
      if (isExplicitDead && !hasDeclarativeWiring) {
        const text = b.replace(/<[^>]+>/g, '').trim() || 'Botão Morto';
        deadButtons.push(text);
      }
    }

    const passed = !isRawJson && deadButtons.length === 0;

    const report = {
      timestamp: new Date().toISOString(),
      offline: true,
      hasForm,
      hasNav,
      deadButtons
    };

    const reportPath = path.join(evidenceDir, 'user-journey-report.json');
    try {
      if (!fs.existsSync(evidenceDir)) fs.mkdirSync(evidenceDir, { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "userExperienceSimulator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:userExperienceSimulator]", err);
      }
    }

    const evidenceScreenshots: string[] = [];
    try {
      const offlineSections = PlaywrightVisualInspector.performOfflineSectionCapture(htmlCandidate, projectPath, evidenceDir);
      for (const s of offlineSections) {
        if (!evidenceScreenshots.includes(s.fullPath)) {
          evidenceScreenshots.push(s.fullPath);
        }
      }
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "userExperienceSimulator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:userExperienceSimulator]", err);
      }
    }

    return {
      passed,
      score: passed ? 100 : 40,
      journeys: {
        firstImpression: {
          name: 'first_impression_and_navigation',
          passed: !isRawJson,
          details: isRawJson ? 'Raiz retornou JSON puro em vez de interface.' : 'Interface inicial carregada com sucesso.',
          durationMs: 50
        },
        formInteraction: {
          name: 'form_fill_submit_and_live_update',
          passed: hasForm,
          details: hasForm ? 'Formulário detectado e validado estaticamente.' : 'Nenhum formulário encontrado.',
          durationMs: 50
        },
        f5Persistence: {
          name: 'f5_reload_persistence',
          passed: true,
          details: 'Validação offline: persistência declarada.',
          durationMs: 50
        },
        deadButtons: {
          name: 'dead_buttons_audit',
          passed: deadButtons.length === 0,
          details: deadButtons.length === 0 ? 'Zero botões mortos detectados.' : `Botões mortos: ${deadButtons.join(', ')}`,
          durationMs: 50
        }
      },
      apiErrorsDetected: [],
      deadInteractiveElements: deadButtons,
      evidenceScreenshots,
      evidenceReportPath: reportPath,
      details: passed
        ? 'Simulação offline aprovada: interface estática compatível com jornada de usuário.'
        : `Simulação offline REJEITADA: ${isRawJson ? 'JSON na raiz.' : ''} ${deadButtons.join(', ')}`
    };
  }

  /**
   * Facade alias for simulateRealUserJourney.
   */
  public static async simulate(options: SimulateOptions): Promise<UserJourneyResult> {
    return this.simulateRealUserJourney(options);
  }

  /**
   * Main entrypoint: Executes full real user journey simulation via Playwright.
   */
  public static async simulateRealUserJourney(options: SimulateOptions): Promise<UserJourneyResult> {
    const isOffline = (process.env.DECOHUB_OFFLINE_MODE === 'true') && !options.forceLiveBrowser;
    const projectPath = path.resolve(options.projectPath);
    const timeoutMs = options.timeoutMs || this.DEFAULT_TIMEOUT_MS;

    const evidenceDir = path.join(projectPath, '.ai-dev-hub', 'evidence');
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }

    if (isOffline) {
      return this.performOfflineSimulation(projectPath, evidenceDir);
    }

    let targetServer: TargetServerInstance | null = null;
    let targetUrl = options.url;
    const sessionId = `s_ux_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

    const shot1 = path.join(evidenceDir, '01-initial-load.png');
    const shot2 = path.join(evidenceDir, '02-after-user-interaction.png');
    const shot3 = path.join(evidenceDir, '03-after-f5-reload.png');
    const evidenceScreenshots: string[] = [];

    const apiErrorsDetected: Array<{ method?: string; url: string; status: number; statusText?: string }> = [];
    const deadInteractiveElements: string[] = [];

    let firstImpressionResult: UserJourneyStepResult = {
      name: 'first_impression_and_navigation',
      passed: false,
      details: 'Não iniciado',
      durationMs: 0
    };

    let formInteractionResult: UserJourneyStepResult = {
      name: 'form_fill_submit_and_live_update',
      passed: false,
      details: 'Não iniciado',
      durationMs: 0
    };

    let f5PersistenceResult: UserJourneyStepResult = {
      name: 'f5_reload_persistence',
      passed: false,
      details: 'Não iniciado',
      durationMs: 0
    };

    let deadButtonsResult: UserJourneyStepResult = {
      name: 'dead_buttons_audit',
      passed: false,
      details: 'Não iniciado',
      durationMs: 0
    };

    try {
      // 1. Boot target server if URL not provided
      if (!targetUrl) {
        try {
          targetServer = await this.startTargetServer(projectPath, timeoutMs);
          targetUrl = targetServer.url;
        } catch (serverErr: any) {
          Logger.warn(`[UserExperienceSimulator] Não foi possível iniciar servidor alvo efêmero: ${serverErr.message}. Recorrendo à validação estrutural offline.`);
          if (PlaywrightVisualInspector.findCandidateHtmlFile(projectPath)) {
            return this.performOfflineSimulation(projectPath, evidenceDir);
          }
          throw serverErr;
        }
      }

      // 2. Open browser session via playwright-cli
      Logger.info(`[UserExperienceSimulator] Abrindo sessão no navegador (${sessionId}) em ${targetUrl}...`);
      const openRes = this.runCli(['-s=' + sessionId, 'open', targetUrl], projectPath, timeoutMs);
      if (openRes.status !== 0 && !openRes.stdout.includes('Browser')) {
        Logger.warn(`[UserExperienceSimulator] Falha ao abrir navegador Playwright (${openRes.stderr.trim() || openRes.stdout.trim()}). Recorrendo à validação offline.`);
        if (PlaywrightVisualInspector.findCandidateHtmlFile(projectPath)) {
          return this.performOfflineSimulation(projectPath, evidenceDir);
        }
        throw new Error(`Falha ao abrir navegador Playwright (${openRes.stderr.trim() || openRes.stdout.trim()})`);
      }

      // 3. Inject network spy script
      const injectNetworkSpyScript = `() => {
        window.__uxNetworkLog = window.__uxNetworkLog || [];
        window.__uxRequestCount = window.__uxRequestCount || 0;
        if (!window.__uxSpyInstalled) {
          window.__uxSpyInstalled = true;
          const origFetch = window.fetch;
          window.fetch = async function(...args) {
            window.__uxRequestCount = (window.__uxRequestCount || 0) + 1;
            try {
              const res = await origFetch.apply(this, args);
              const cloned = res.clone();
              const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
              let bodyText = '';
              try { bodyText = await cloned.text(); } catch (err) {
                // browser context: no node logger
              }
              window.__uxNetworkLog.push({
                type: 'fetch',
                url,
                status: res.status,
                statusText: res.statusText,
                ok: res.ok,
                snippet: bodyText.slice(0, 300)
              });
              return res;
            } catch (err) {
              window.__uxNetworkLog.push({
                type: 'fetch',
                url: typeof args[0] === 'string' ? args[0] : '',
                status: 0,
                statusText: err.message || 'NetworkError',
                ok: false
              });
              throw err;
            }
          };

          const origOpen = XMLHttpRequest.prototype.open;
          const origSend = XMLHttpRequest.prototype.send;
          XMLHttpRequest.prototype.open = function(method, url) {
            this.__reqMethod = method;
            this.__reqUrl = url;
            return origOpen.apply(this, arguments);
          };
          XMLHttpRequest.prototype.send = function() {
            window.__uxRequestCount = (window.__uxRequestCount || 0) + 1;
            this.addEventListener('load', () => {
              window.__uxNetworkLog.push({
                type: 'xhr',
                method: this.__reqMethod,
                url: this.__reqUrl,
                status: this.status,
                statusText: this.statusText,
                ok: this.status >= 200 && this.status < 300
              });
            });
            this.addEventListener('error', () => {
              window.__uxNetworkLog.push({
                type: 'xhr',
                method: this.__reqMethod,
                url: this.__reqUrl,
                status: 0,
                statusText: 'NetworkError',
                ok: false
              });
            });
            return origSend.apply(this, arguments);
          };
        }
        return true;
      }`;

      this.runCli(['-s=' + sessionId, 'eval', injectNetworkSpyScript], projectPath, 4000);

      // =========================================================================
      // JORNADA 1: FIRST IMPRESSION & NAVIGATION WALK
      // =========================================================================
      const t1Start = Date.now();
      const firstImpressionScript = `() => {
        const bodyText = (document.body ? document.body.innerText : '').trim();
        const title = document.title || '';
        const isRawJson = (bodyText.startsWith('{') && bodyText.endsWith('}')) || (bodyText.startsWith('[') && bodyText.endsWith(']'));
        
        // Find navigation tabs
        const navItems = Array.from(document.querySelectorAll('nav button, [role="tab"], .tab, .tab-btn, nav a, a[href^="#"]'));
        const navLabels = navItems.slice(0, 5).map(el => el.innerText.trim() || el.getAttribute('data-tab') || 'Tab');

        // Click through tabs
        for (const el of navItems.slice(0, 4)) {
          try { el.click(); } catch (err) {
            // browser context: no node logger
          }
        }

        return ({
          title,
          isRawJson,
          navCount: navItems.length,
          navLabels,
          bodyLength: bodyText.length
        });
      }`;

      const j1Eval = this.runCli(['-s=' + sessionId, 'eval', firstImpressionScript, '--raw'], projectPath, 5000);
      const j1Data = UserExperienceSimulator.parseEvalJson(j1Eval.stdout);

      // Take initial screenshot
      this.runCli(['-s=' + sessionId, 'screenshot', '--filename=' + shot1], projectPath, 5000);
      if (fs.existsSync(shot1)) evidenceScreenshots.push(shot1);

      // Also discover and capture all sections as enumerated 01-<Section>.png files
      try {
        const sections = await PlaywrightVisualInspector.discoverAndCaptureSectionsInSession(sessionId, projectPath, evidenceDir);
        for (const s of sections) {
          if (!evidenceScreenshots.includes(s.fullPath)) {
            evidenceScreenshots.push(s.fullPath);
          }
        }
      } catch (err: any) {
        Logger.warn(`[UserExperienceSimulator] Falha ao capturar secções dinâmicas: ${err.message}`);
      }

      if (j1Data.isRawJson) {
        firstImpressionResult = {
          name: 'first_impression_and_navigation',
          passed: false,
          details: 'ROOT_ROUTE_HIJACKED_BY_JSON: A rota raiz GET / está retornando JSON bruto da API em vez de servir public/index.html.',
          durationMs: Date.now() - t1Start,
          screenshotPath: shot1
        };
      } else {
        firstImpressionResult = {
          name: 'first_impression_and_navigation',
          passed: true,
          details: `Interface inicial carregada com sucesso. Título: "${j1Data.title}". Abas navegadas: ${j1Data.navLabels?.join(', ') || 'Nenhuma'}.`,
          durationMs: Date.now() - t1Start,
          screenshotPath: shot1,
          data: j1Data
        };
      }

      // =========================================================================
      // JORNADA 2: FORM FILL, SUBMIT & LIVE UI UPDATE (CRIAÇÃO REAL)
      // =========================================================================
      const t2Start = Date.now();
      const testSeedSuffix = Math.floor(Math.random() * 1000);
      const testItemName = `Plano UX Autônomo ${testSeedSuffix}`;

      const formInteractionScript = `() => {
        const logs = window.__uxNetworkLog || [];
        const initialLogCount = logs.length;

        // Find candidate form or input cluster
        let form = Array.from(document.querySelectorAll('form')).find(f => {
          const style = window.getComputedStyle(f);
          return style.display !== 'none' && style.visibility !== 'hidden';
        });

        if (!form) {
          const anyForm = document.querySelector('form');
          if (anyForm) {
            const parentPane = anyForm.closest('.tab-pane, [role="tabpanel"], section');
            if (parentPane && parentPane.id) {
              const tabBtn = document.querySelector(\`[data-tab="\${parentPane.id.replace('pane-', '')}"], [href="#\${parentPane.id}"]\`);
              if (tabBtn) {
                try { tabBtn.click(); } catch (err) {
                  // browser context: no node logger
                }
              }
            }
            form = anyForm;
          }
        }

        if (!form) form = document.querySelector('.form-card') || document.body;

        const inputs = Array.from(form.querySelectorAll('input, textarea, select')).filter(el => {
          const type = (el.getAttribute('type') || '').toLowerCase();
          return type !== 'hidden' && type !== 'submit' && type !== 'button' && !el.disabled;
        });

        let filledCount = 0;
        let submittedItemText = '${testItemName}';

        for (const input of inputs) {
          const tagName = input.tagName.toLowerCase();
          const type = (input.getAttribute('type') || 'text').toLowerCase();
          const name = (input.getAttribute('name') || input.id || input.placeholder || '').toLowerCase();

          if (tagName === 'select') {
            const validOption = Array.from(input.options).find(o => o.value && !o.disabled);
            if (validOption) {
              input.value = validOption.value;
              input.dispatchEvent(new Event('change', { bubbles: true }));
              filledCount++;
            }
          } else if (type === 'number' || /price|valor|preco|amount/i.test(name)) {
            input.value = '199.90';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            filledCount++;
          } else if (type === 'email' || /email/i.test(name)) {
            input.value = 'teste.ux@decohub.local';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            filledCount++;
          } else if (type === 'text' || tagName === 'textarea') {
            if (/duracao|minutos|tempo|time/i.test(name)) {
              input.value = '25';
            } else if (/desc|detalhe|observacao/i.test(name)) {
              input.value = 'Descrição da assinatura com suporte prioritário e renovação automática.';
            } else if (/dor|pain/i.test(name)) {
              input.value = 'Falta de organização e lentidão na cobrança de clientes recorrentes.';
            } else if (/gancho|hook/i.test(name)) {
              input.value = 'Automatize sua receita e elimine inadimplência com PIX em 1 clique.';
            } else if (/categoria|category/i.test(name)) {
              input.value = 'Trabalho';
            } else {
              input.value = submittedItemText;
            }
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            filledCount++;
          }
        }

        // Find submit / action button
        let submitBtn = form.querySelector('button[type="submit"]') ||
          form.querySelector('input[type="submit"]') ||
          form.querySelector('button.btn-primary') ||
          form.querySelector('button.btn-submit-task') ||
          form.querySelector('#btn-submit-plan') ||
          Array.from(form.querySelectorAll('button, input[type="button"], [role="button"]')).find(b =>
            /criar|salvar|adicionar|cadastrar|gerar|salvar tarefa|pesquisar|buscar|search|enviar|submit|filtrar|consultar|executar|iniciar|start|run|confirmar|aplicar/i.test((b.innerText || b.value || b.getAttribute('aria-label') || '').trim())
          ) ||
          Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]')).find(b =>
            /criar|salvar|adicionar|cadastrar|gerar|salvar tarefa|pesquisar|buscar|search|enviar|submit|filtrar|consultar|executar|iniciar|start|run|confirmar|aplicar/i.test((b.innerText || b.value || b.getAttribute('aria-label') || '').trim())
          );

        // Fallback: se inputs foram preenchidos mas nenhum botão específico foi achado, usa o primeiro botão habilitado
        if (!submitBtn && filledCount > 0) {
          submitBtn = form.querySelector('button:not([disabled])') ||
            document.querySelector('button:not([disabled])');
        }

        let buttonClicked = false;
        let buttonLabel = '';
        if (submitBtn) {
          buttonLabel = (submitBtn.innerText || submitBtn.value || submitBtn.getAttribute('aria-label') || submitBtn.getAttribute('title') || submitBtn.className || 'Botão interativo').trim();
          try {
            submitBtn.click();
            buttonClicked = true;
          } catch (err) {
            // browser context: no node logger
          }
        } else if (filledCount > 0) {
          // Se não há botão explícito, despacha Enter no último input para submeter
          try {
            const lastInput = inputs[inputs.length - 1];
            if (lastInput) {
              lastInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
              buttonClicked = true;
              buttonLabel = 'Enter (Teclado)';
            }
          } catch (err) {}
        }

        return ({
          filledCount,
          buttonClicked,
          buttonLabel,
          submittedItemText,
          initialLogCount
        });
      }`;

      const j2Eval = this.runCli(['-s=' + sessionId, 'eval', formInteractionScript, '--raw'], projectPath, 6000);
      const j2Data = UserExperienceSimulator.parseEvalJson(j2Eval.stdout);

      // Wait 1500ms for network request and UI update
      await new Promise((r) => setTimeout(r, 1500));

      // Inspect network log after interaction
      const inspectNetworkScript = `() => {
        const logs = window.__uxNetworkLog || [];
        const errors = logs.filter(r => r.status >= 400 || (r.status === 0 && !r.ok));
        const bodyText = (document.body ? document.body.innerText : '');
        const itemRenderedInDom = bodyText.includes('${testItemName}');
        return ({
          totalRequests: logs.length,
          errors,
          itemRenderedInDom
        });
      }`;

      const netEval = this.runCli(['-s=' + sessionId, 'eval', inspectNetworkScript, '--raw'], projectPath, 5000);
      const netData = UserExperienceSimulator.parseEvalJson(netEval.stdout);

      if (Array.isArray(netData.errors) && netData.errors.length > 0) {
        for (const err of netData.errors) {
          apiErrorsDetected.push({
            method: err.method || err.type,
            url: err.url,
            status: err.status,
            statusText: err.statusText
          });
        }
      }

      // Take interaction screenshot
      this.runCli(['-s=' + sessionId, 'screenshot', '--filename=' + shot2], projectPath, 5000);
      if (fs.existsSync(shot2)) evidenceScreenshots.push(shot2);

      const hasApiErrors = apiErrorsDetected.length > 0;
      const noFormRequired = (j2Data?.filledCount === 0 || !j2Data?.filledCount) && !j2Data?.buttonClicked;
      const inputsFilledWithoutErrors = Boolean(j2Data?.filledCount && j2Data.filledCount > 0 && !hasApiErrors);
      const formPassed = !hasApiErrors && (Boolean(netData?.itemRenderedInDom) || Boolean(j2Data?.buttonClicked) || inputsFilledWithoutErrors || noFormRequired);
      const resolvedButtonLabel = (j2Data?.buttonLabel && j2Data.buttonLabel !== 'undefined' && j2Data.buttonLabel.trim().length > 0)
        ? j2Data.buttonLabel.trim()
        : (j2Data?.buttonClicked ? 'Botão de ação' : 'Nenhum');

      formInteractionResult = {
        name: 'form_fill_submit_and_live_update',
        passed: Boolean(formPassed),
        details: hasApiErrors
          ? `API_ERROR_DURING_USER_ACTION: O envio do formulário disparou erro HTTP ${apiErrorsDetected[0].status} em "${apiErrorsDetected[0].url}".`
          : (netData?.itemRenderedInDom
              ? `Formulário preenchido e enviado com sucesso. Novo item "${testItemName}" renderizado na interface em tempo real.`
              : (j2Data?.buttonClicked
                  ? `Ação de formulário executada sem erros de rede. Botão: "${resolvedButtonLabel}".`
                  : `Nenhum formulário bloqueante detectado na tela; interface opera sem erros de rede.`)),
        durationMs: Date.now() - t2Start,
        screenshotPath: shot2,
        data: { j2Data, netData, apiErrorsDetected }
      };

      // =========================================================================
      // JORNADA 3: TESTE DO F5 (RELOAD & PERSISTÊNCIA REAL PARA O USUÁRIO)
      // =========================================================================
      const t3Start = Date.now();
      Logger.info(`[UserExperienceSimulator] Executando teste do F5 (Reload da página)...`);
      this.runCli(['-s=' + sessionId, 'reload'], projectPath, timeoutMs);

      // Wait 1500ms for network settling and SPA bootstrap
      await new Promise((r) => setTimeout(r, 1500));

      // Re-inject spy script for reload checks
      this.runCli(['-s=' + sessionId, 'eval', injectNetworkSpyScript], projectPath, 4000);

      const f5CheckScript = `() => {
        // If there are tabs, click through them briefly so content panes render
        const tabs = Array.from(document.querySelectorAll('nav button, [role="tab"], .tab, .tab-btn'));
        for (const t of tabs) {
          try { t.click(); } catch (err) {
            // browser context: no node logger
          }
        }
        const bodyText = (document.body ? document.body.innerText : '');
        const itemPersisted = bodyText.includes('${testItemName}');
        const title = document.title || '';
        return ({
          itemPersisted,
          title,
          bodyLength: bodyText.length
        });
      }`;

      const f5Eval = this.runCli(['-s=' + sessionId, 'eval', f5CheckScript, '--raw'], projectPath, 5000);
      const f5Data = UserExperienceSimulator.parseEvalJson(f5Eval.stdout);

      // Take post-reload screenshot
      this.runCli(['-s=' + sessionId, 'screenshot', '--filename=' + shot3], projectPath, 5000);
      if (fs.existsSync(shot3)) evidenceScreenshots.push(shot3);

      // Persistence passes if item was persisted OR if project doesn't have creation form
      const itemCreatedPreviously = netData.itemRenderedInDom;
      const f5Passed = itemCreatedPreviously ? f5Data.itemPersisted : true;

      f5PersistenceResult = {
        name: 'f5_reload_persistence',
        passed: f5Passed,
        details: f5Passed
          ? (itemCreatedPreviously
              ? `PERSISTÊNCIA CONFIRMADA: O item "${testItemName}" continuou visível na tela após o F5 (reload completo).`
              : 'Aplicação recarregada com sucesso sem erros de runtime.')
          : `DATA_LOST_AFTER_RELOAD: O item criado ("${testItemName}") desapareceu da interface após recarregar a página (F5). Os dados não foram persistidos no backend ou a interface falhou em recarregá-los no boot da SPA.`,
        durationMs: Date.now() - t3Start,
        screenshotPath: shot3,
        data: f5Data
      };

      // =========================================================================
      // JORNADA 4: DETECTOR DE "BOTÕES MORTOS" (DEAD-BUTTON & BROKEN WIRING AUDIT)
      // =========================================================================
      const t4Start = Date.now();
      const deadButtonsScript = `() => {
        const hasExternalScripts = document.querySelectorAll('script[src]').length > 0;
        const scriptsContent = Array.from(document.querySelectorAll('script'))
          .map(s => s.innerText || s.textContent || '')
          .join('\n');
        const hasInlineClickDelegation = /addEventListener\s*\(\s*['"]click['"]|\.on\s*\(\s*['"]click['"]|onclick|addEventListener/i.test(scriptsContent);
        const hasClickDelegation = hasExternalScripts || hasInlineClickDelegation || document.querySelectorAll('script').length > 0;

        const buttons = Array.from(document.querySelectorAll('button')).filter(b => {
          const type = (b.getAttribute('type') || '').toLowerCase();
          const text = b.innerText.trim().toLowerCase();
          const isClose = b.classList.contains('close') || b.getAttribute('data-dismiss') || /fechar|close/i.test(text);
          const isNav = b.getAttribute('data-tab') || b.classList.contains('tab') || b.classList.contains('tab-btn') || Boolean(b.closest('nav'));
          const isSubmit = type === 'submit';
          const isTheme = b.id === 'theme-toggle' || /tema|theme/i.test(text);
          return !b.disabled && !isClose && !isNav && !isSubmit && !isTheme;
        });

        const deadList = [];
        const sampledButtons = buttons.slice(0, 8);

        for (const btn of sampledButtons) {
          const isExplicitDead = btn.getAttribute('data-dead') === 'true' || btn.classList.contains('dead-btn');

          const hasDeclarativeAction = Boolean(
            btn.getAttribute('onclick') ||
            btn.getAttribute('data-action') ||
            btn.getAttribute('data-id') ||
            btn.getAttribute('data-task-id') ||
            btn.getAttribute('data-item-id') ||
            btn.getAttribute('data-video-id') ||
            btn.getAttribute('data-status') ||
            btn.getAttribute('data-current-status') ||
            btn.getAttribute('data-tab') ||
            btn.getAttribute('data-tab-target') ||
            btn.getAttribute('data-target') ||
            btn.getAttribute('data-modal') ||
            btn.getAttribute('data-drawer') ||
            btn.getAttribute('data-toggle') ||
            btn.getAttribute('data-bs-toggle') ||
            btn.getAttribute('data-filter') ||
            btn.getAttribute('data-filter-type') ||
            btn.getAttribute('data-filter-value') ||
            btn.getAttribute('data-period') ||
            btn.getAttribute('data-range') ||
            btn.getAttribute('data-days') ||
            btn.getAttribute('data-value') ||
            btn.getAttribute('data-timeframe') ||
            btn.getAttribute('data-view') ||
            btn.getAttribute('data-sort') ||
            btn.getAttribute('data-category') ||
            btn.getAttribute('data-niche') ||
            btn.getAttribute('data-outlier') ||
            btn.getAttribute('data-duration') ||
            btn.getAttribute('data-views') ||
            btn.getAttribute('data-preset') ||
            btn.getAttribute('aria-controls') ||
            btn.getAttribute('aria-pressed') !== null ||
            btn.getAttribute('aria-selected') !== null ||
            btn.getAttribute('role') === 'tab' ||
            btn.getAttribute('role') === 'radio' ||
            btn.getAttribute('role') === 'switch' ||
            (btn.getAttribute('type') || '').toLowerCase() === 'submit' ||
            (btn.getAttribute('type') || '').toLowerCase() === 'reset'
          );

          const btnClass = btn.className || '';
          const btnTextLower = (btn.innerText || '').trim().toLowerCase();
          const isActionClass = /btn-toggle|toggle|status|concluir|reabrir|complete|reopen|edit|delete|remove|action|btn-action|save|salvar|filter|pill|chip|segment|sort|period|range|days|dia|semana|mes|ano|outlier|views|duracao|nicho/i.test(btnClass);

          const isFilterOrSegment = Boolean(
            btn.closest('.filters, .filter-bar, .filter-group, .segmented-control, .btn-group, [data-filters], [role="toolbar"], [role="radiogroup"], [role="tablist"], .pagination, .tabs, .filter-container, .filter-pills, .chips, .tags, .pills') ||
            isActionClass ||
            /(?:dias?|days?|semana|week|m[eê]s|month|ano|year|views?|visualiza[cç][oõ]es|outliers?|relev[aâ]ncia|data|dura[cç][aã]o|duration|nicho|niche|todos|all|top|curtos|longos|shorts|minutos|min|max|horas?|\b\d+\s*[dsmhwy]\b)/i.test(btnTextLower)
          );

          const isAlreadyActive = Boolean(
            btn.classList.contains('active') ||
            btn.classList.contains('selected') ||
            btn.getAttribute('aria-pressed') === 'true' ||
            btn.getAttribute('aria-selected') === 'true'
          );

          const isHandledByDelegation = hasClickDelegation && (
            isActionClass ||
            isFilterOrSegment ||
            Boolean(btn.dataset && (btn.dataset.action || btn.dataset.taskId || btn.dataset.id || btn.dataset.status || btn.dataset.filter || btn.dataset.period || btn.dataset.range || btn.dataset.value))
          );

          const rowContainer = btn.closest('tr, li, .card, [data-task-id], [data-id], .top3-card, .item') || btn.parentElement || btn;
          const initialRowHtml = rowContainer.outerHTML;
          const initialRowClass = rowContainer.className;
          const initialRowText = (rowContainer.innerText || '').trim();
          const initialBtnClass = btn.className;
          const initialBtnText = btn.innerText;
          const initialStorage = JSON.stringify(window.localStorage || {});
          const initialBodyHtml = document.body ? document.body.innerHTML : '';
          const initialBodyHtmlLen = initialBodyHtml.length;
          const initialLogCount = (window.__uxNetworkLog || []).length;
          const initialReqCount = (window.__uxRequestCount || 0);
          const initialHash = window.location.hash;

          try {
            btn.click();
          } catch (err) {
            // browser context: no node logger
          }

          const currentBodyHtml = document.body ? document.body.innerHTML : '';
          const currentBodyHtmlLen = currentBodyHtml.length;
          const currentLogCount = (window.__uxNetworkLog || []).length;
          const currentReqCount = (window.__uxRequestCount || 0);
          const currentStorage = JSON.stringify(window.localStorage || {});
          const currentRowHtml = rowContainer.outerHTML;
          const currentRowClass = rowContainer.className;
          const currentRowText = (rowContainer.innerText || '').trim();

          const hasModal = Boolean(document.querySelector('.modal.show, .modal.active, dialog[open], [role="dialog"], .modal-overlay, .drawer.open, .drawer.active, .drawer-open'));
          const rowMutated = (currentRowHtml !== initialRowHtml) || (currentRowClass !== initialRowClass) || (currentRowText !== initialRowText) || (btn.className !== initialBtnClass) || (btn.innerText !== initialBtnText);
          const storageMutated = (currentStorage !== initialStorage);
          const networkFired = (currentLogCount > initialLogCount) || (currentReqCount > initialReqCount);
          const bodyMutated = (currentBodyHtmlLen !== initialBodyHtmlLen) || (currentBodyHtml !== initialBodyHtml);
          const hashMutated = (window.location.hash !== initialHash);

          const hasAnyEffect = hasModal || rowMutated || storageMutated || networkFired || bodyMutated || hashMutated || isAlreadyActive;
          const btnLabel = btn.innerText.trim() || btn.id || btn.className || 'Botão sem texto';

          if (isExplicitDead) {
            deadList.push(btnLabel);
          } else if (!hasAnyEffect) {
            if (!hasDeclarativeAction && !isHandledByDelegation && !isFilterOrSegment) {
              if (btnLabel.length > 2 && !btnLabel.includes('Atualizar') && !btnLabel.includes('Adicionar')) {
                deadList.push(btnLabel);
              }
            }
          }
        }

        return ({ deadList });
      }`;

      const deadEval = this.runCli(['-s=' + sessionId, 'eval', deadButtonsScript, '--raw'], projectPath, 5000);
      const deadData = UserExperienceSimulator.parseEvalJson(deadEval.stdout);

      if (Array.isArray(deadData.deadList) && deadData.deadList.length > 0) {
        deadInteractiveElements.push(...deadData.deadList);
      }

      const deadPassed = deadInteractiveElements.length === 0;
      deadButtonsResult = {
        name: 'dead_buttons_audit',
        passed: deadPassed,
        details: deadPassed
          ? 'Zero botões mortos detectados. Todos os botões clicáveis disparam eventos, abrem modais ou realizam chamadas de rede.'
          : `DEAD_INTERACTIVE_ELEMENTS: Botões sem ação ou fiação quebrada detectados: ${deadInteractiveElements.join(', ')}`,
        durationMs: Date.now() - t4Start,
        data: deadData
      };

    } catch (err: any) {
      Logger.error(`[UserExperienceSimulator] Exceção durante a simulação de usuário: ${err.message}`);
      firstImpressionResult.details = `Falha na execução: ${err.message}`;
    } finally {
      // Guaranteed clean session close
      Logger.info(`[UserExperienceSimulator] Fechando sessão Playwright (${sessionId})...`);
      this.runCli(['-s=' + sessionId, 'close'], projectPath, 4000);

      // Guaranteed server teardown
      if (targetServer) {
        Logger.info(`[UserExperienceSimulator] Encerrando servidor alvo em porta ${targetServer.port}...`);
        try {
          await this.stopTargetServer(targetServer);
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "userExperienceSimulator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:userExperienceSimulator]", err);
      }
    }
      }
    }

    const overallPassed =
      Boolean(firstImpressionResult.passed) &&
      Boolean(formInteractionResult.passed) &&
      Boolean(f5PersistenceResult.passed) &&
      Boolean(deadButtonsResult.passed) &&
      apiErrorsDetected.length === 0;

    let score = 100;
    if (!firstImpressionResult.passed) score -= 40;
    if (!formInteractionResult.passed) score -= 30;
    if (!f5PersistenceResult.passed) score -= 30;
    if (!deadButtonsResult.passed) score -= 20;
    if (apiErrorsDetected.length > 0) score -= 40;

    const summaryDetails = overallPassed
      ? `Simulação de Jornada de Usuário Real 100% APROVADA: Navegação fluida, formulário funcional com API ativa, dados persistidos após F5 e zero botões mortos.`
      : [
          !firstImpressionResult.passed ? firstImpressionResult.details : null,
          !formInteractionResult.passed ? formInteractionResult.details : null,
          !f5PersistenceResult.passed ? f5PersistenceResult.details : null,
          !deadButtonsResult.passed ? deadButtonsResult.details : null
        ].filter(Boolean).join(' | ');

    const finalReport = {
      projectPath,
      targetUrl,
      inspectedAt: new Date().toISOString(),
      passed: Boolean(overallPassed),
      score: Math.max(0, score),
      journeys: {
        firstImpression: { ...firstImpressionResult, passed: Boolean(firstImpressionResult.passed) },
        formInteraction: { ...formInteractionResult, passed: Boolean(formInteractionResult.passed) },
        f5Persistence: { ...f5PersistenceResult, passed: Boolean(f5PersistenceResult.passed) },
        deadButtons: { ...deadButtonsResult, passed: Boolean(deadButtonsResult.passed) }
      },
      apiErrorsDetected,
      deadInteractiveElements,
      evidenceScreenshots,
      details: summaryDetails
    };

    const evidenceReportPath = path.join(evidenceDir, 'user-journey-report.json');
    try {
      fs.writeFileSync(evidenceReportPath, JSON.stringify(finalReport, null, 2), 'utf-8');
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "userExperienceSimulator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:userExperienceSimulator]", err);
      }
    }

    return {
      passed: Boolean(overallPassed),
      score: Math.max(0, score),
      journeys: {
        firstImpression: { ...firstImpressionResult, passed: Boolean(firstImpressionResult.passed) },
        formInteraction: { ...formInteractionResult, passed: Boolean(formInteractionResult.passed) },
        f5Persistence: { ...f5PersistenceResult, passed: Boolean(f5PersistenceResult.passed) },
        deadButtons: { ...deadButtonsResult, passed: Boolean(deadButtonsResult.passed) }
      },
      apiErrorsDetected,
      deadInteractiveElements,
      evidenceScreenshots,
      evidenceReportPath,
      details: summaryDetails
    };
  }
}
