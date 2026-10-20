/**
 * AI DEV HUB / DecoHUB — Development Autonomy Service
 * 
 * Manages full operational autonomy for trusted projects:
 * 1. Persistent project trust & autonomy settings
 * 2. Intelligent environment & package manager detection (npm, pnpm, yarn, bun, pip, etc.)
 * 3. Stack detection & automated verification suite recommendations
 * 4. Deterministic guidelines block injection for Worker and Supervisor
 * 5. Self-healing loop directives and smart dependency rules
 */

import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { Logger } from './logger.js';

export type PackageManagerType = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'pip' | 'poetry' | 'cargo' | 'unknown';
export type ProjectStackType = 'react' | 'vue' | 'nextjs' | 'node' | 'express' | 'python' | 'html-web' | 'unknown';

export interface DetectionResult {
  packageManager: PackageManagerType;
  stack: ProjectStackType;
  testScript?: string;
  buildScript?: string;
  devScript?: string;
  startScript?: string;
  hasTests: boolean;
  lockfile?: string;
}

export interface ProjectAutonomySettings {
  projectId: string;
  isTrusted: boolean;
  fullDevAutonomy: boolean;
  autoInstallDeps: boolean;
  autoRunTests: boolean;
  maxSelfHealingRetries: number;
  environment?: DetectionResult;
}

export class DevAutonomyService {
  /**
   * Check if a project is marked as trusted
   */
  static isProjectTrusted(projectId: string): boolean {
    try {
      const row: any = db.prepare('SELECT is_trusted FROM projects WHERE id = ?').get(projectId);
      if (!row) return false;
      return row.is_trusted === 1 || row.is_trusted === '1' || row.is_trusted === true;
    } catch {
      return false;
    }
  }

  /**
   * Check if full development autonomy is enabled for a project
   */
  static hasFullDevAutonomy(projectId: string): boolean {
    try {
      const row: any = db.prepare('SELECT full_dev_autonomy, is_trusted FROM projects WHERE id = ?').get(projectId);
      if (!row) return false;
      const isTrusted = row.is_trusted === 1 || row.is_trusted === '1' || row.is_trusted === true;
      if (!isTrusted) return false; // Untrusted projects never receive autonomy
      if (row.full_dev_autonomy !== undefined && row.full_dev_autonomy !== null) {
        return row.full_dev_autonomy === 1 || row.full_dev_autonomy === '1' || row.full_dev_autonomy === true;
      }
      return this.getGlobalDefaultAutonomy();
    } catch {
      return false;
    }
  }

  /**
   * Evaluates persistent authorization for live Antigravity execution.
   * Untrusted projects (is_trusted=0) or projects with autonomy disabled are strictly blocked.
   */
  static isProjectAuthorizedForLiveExecution(projectId?: string | null, caller?: string): {
    authorized: boolean;
    reason?: string;
  } {
    // Meta-Chat is a native administrative tool operated by the user within DecoHUB
    if (caller && (caller.includes('MetaChat') || caller.includes('metachat'))) {
      return { authorized: true };
    }
    if (projectId === '__decohub_metachat__' || projectId === 'decohub-meta') {
      return { authorized: true };
    }

    if (!projectId || projectId === 'outside-of-project') {
      const globalAuth = this.getGlobalDefaultAutonomy() || process.env.DECOHUB_ALLOW_LIVE_AGENTAPI === 'true';
      if (!globalAuth) {
        return {
          authorized: false,
          reason: 'Execução global sem projeto requer configuração de autonomia global ativa.'
        };
      }
      return { authorized: true };
    }

    try {
      const row: any = db.prepare('SELECT is_trusted, full_dev_autonomy, name FROM projects WHERE id = ?').get(projectId);
      if (!row) {
        return {
          authorized: false,
          reason: `Projeto "${projectId}" não foi encontrado no banco de dados.`
        };
      }
      const isTrusted = row.is_trusted === 1 || row.is_trusted === '1' || row.is_trusted === true;
      if (!isTrusted) {
        return {
          authorized: false,
          reason: `Projeto "${row.name || projectId}" está marcado como NÃO CONFIÁVEL (is_trusted=0). Chamadas reais bloqueadas.`
        };
      }
      const hasAutonomy = row.full_dev_autonomy === 1 || row.full_dev_autonomy === '1' || row.full_dev_autonomy === true;
      if (!hasAutonomy) {
        return {
          authorized: false,
          reason: `Autonomia de desenvolvimento desativada para o projeto "${row.name || projectId}" (full_dev_autonomy=0).`
        };
      }
      return { authorized: true };
    } catch (err: any) {
      return { authorized: false, reason: `Erro ao verificar autorização do projeto: ${err.message}` };
    }
  }

  /**
   * Set autonomy settings for a project
   */
  static setProjectAutonomy(projectId: string, isTrusted: boolean, fullAutonomy: boolean): void {
    const nowIso = new Date().toISOString();
    try {
      db.prepare(`
        UPDATE projects
        SET is_trusted = ?, full_dev_autonomy = ?, updated_at = ?
        WHERE id = ?
      `).run(isTrusted ? 1 : 0, fullAutonomy ? 1 : 0, nowIso, projectId);
      Logger.info(`[DevAutonomyService] Autonomia atualizada para projeto ${projectId}: isTrusted=${isTrusted}, fullAutonomy=${fullAutonomy}`);
    } catch (err: any) {
      Logger.error(`[DevAutonomyService] Falha ao atualizar autonomia: ${err.message}`);
    }
  }

  /**
   * Get global default autonomy setting from system_settings
   */
  static getGlobalDefaultAutonomy(): boolean {
    try {
      const row: any = db.prepare('SELECT value FROM system_settings WHERE key = ?').get('full_dev_autonomy_default');
      if (!row) return true; // Default to enabled
      return row.value === 'true' || row.value === '1' || row.value === 'enabled';
    } catch {
      return true;
    }
  }

  /**
   * Set global default autonomy setting in system_settings
   */
  static setGlobalDefaultAutonomy(enabled: boolean): void {
    const nowIso = new Date().toISOString();
    try {
      db.prepare(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ('full_dev_autonomy_default', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(enabled ? 'true' : 'false', nowIso);
    } catch (err: any) {
      Logger.error(`[DevAutonomyService] Falha ao salvar configuração global de autonomia: ${err.message}`);
    }
  }

  /**
   * Detect package manager, stack and scripts for a workspace path
   */
  static detectEnvironment(projectPath: string): DetectionResult {
    let packageManager: PackageManagerType = 'unknown';
    let stack: ProjectStackType = 'unknown';
    let testScript: string | undefined;
    let buildScript: string | undefined;
    let devScript: string | undefined;
    let startScript: string | undefined;
    let hasTests = false;
    let lockfile: string | undefined;

    if (!fs.existsSync(projectPath)) {
      return { packageManager: 'npm', stack: 'node', hasTests: false };
    }

    // 1. Detect package manager from lockfiles
    if (fs.existsSync(path.join(projectPath, 'pnpm-lock.yaml'))) {
      packageManager = 'pnpm';
      lockfile = 'pnpm-lock.yaml';
    } else if (fs.existsSync(path.join(projectPath, 'yarn.lock'))) {
      packageManager = 'yarn';
      lockfile = 'yarn.lock';
    } else if (fs.existsSync(path.join(projectPath, 'bun.lockb')) || fs.existsSync(path.join(projectPath, 'bun.lock'))) {
      packageManager = 'bun';
      lockfile = 'bun.lockb';
    } else if (fs.existsSync(path.join(projectPath, 'package-lock.json'))) {
      packageManager = 'npm';
      lockfile = 'package-lock.json';
    } else if (fs.existsSync(path.join(projectPath, 'poetry.lock'))) {
      packageManager = 'poetry';
      lockfile = 'poetry.lock';
    } else if (fs.existsSync(path.join(projectPath, 'requirements.txt')) || fs.existsSync(path.join(projectPath, 'pyproject.toml'))) {
      packageManager = 'pip';
      lockfile = 'requirements.txt';
    } else if (fs.existsSync(path.join(projectPath, 'Cargo.lock')) || fs.existsSync(path.join(projectPath, 'Cargo.toml'))) {
      packageManager = 'cargo';
      lockfile = 'Cargo.lock';
    } else if (fs.existsSync(path.join(projectPath, 'package.json'))) {
      packageManager = 'npm';
    }

    // 2. Inspect package.json if present
    const pkgJsonPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
        const allDeps = {
          ...(pkg.dependencies || {}),
          ...(pkg.devDependencies || {})
        };

        if (pkg.scripts) {
          if (pkg.scripts.test) testScript = pkg.scripts.test;
          if (pkg.scripts.build) buildScript = pkg.scripts.build;
          if (pkg.scripts.dev) devScript = pkg.scripts.dev;
          if (pkg.scripts.start) startScript = pkg.scripts.start;
        }

        // Stack detection
        if (allDeps['react'] || allDeps['react-dom']) {
          stack = allDeps['next'] ? 'nextjs' : 'react';
        } else if (allDeps['vue']) {
          stack = 'vue';
        } else if (allDeps['express'] || allDeps['fastify'] || allDeps['koa'] || allDeps['hono']) {
          stack = 'express';
        } else {
          stack = 'node';
        }

        if (testScript && !testScript.includes('no test specified')) {
          hasTests = true;
        }
      } catch {}
    } else if (packageManager === 'pip' || packageManager === 'poetry') {
      stack = 'python';
      if (fs.existsSync(path.join(projectPath, 'test')) || fs.existsSync(path.join(projectPath, 'tests'))) {
        hasTests = true;
      }
    } else if (fs.existsSync(path.join(projectPath, 'index.html'))) {
      stack = 'html-web';
    }

    // Check test directory
    if (!hasTests) {
      if (fs.existsSync(path.join(projectPath, 'test')) || fs.existsSync(path.join(projectPath, 'tests')) || fs.existsSync(path.join(projectPath, '__tests__'))) {
        hasTests = true;
      }
    }

    return {
      packageManager: packageManager === 'unknown' ? 'npm' : packageManager,
      stack: stack === 'unknown' ? 'node' : stack,
      testScript,
      buildScript,
      devScript,
      startScript,
      hasTests,
      lockfile
    };
  }

  /**
   * Generates the comprehensive Operational Autonomy Protocol instructions
   * injected into task prompts for Worker and Supervisor.
   */
  static buildAutonomyGuidelinesBlock(projectPath: string, projectName?: string): string {
    const env = this.detectEnvironment(projectPath);
    const pm = env.packageManager;
    const installCmd = pm === 'yarn' ? 'yarn add' : (pm === 'pnpm' ? 'pnpm add' : (pm === 'pip' ? 'pip install' : 'npm install'));
    const installDevCmd = pm === 'yarn' ? 'yarn add -D' : (pm === 'pnpm' ? 'pnpm add -D' : 'npm install -D');
    const testCmd = env.testScript ? `${pm} test` : (pm === 'pip' ? 'pytest' : 'npm test');
    const buildCmd = env.buildScript ? `${pm} run build` : 'npm run build';

    return [
      `[AUTONOMIA TOTAL DE DESENVOLVIMENTO — OPERAÇÕES AUTORIZADAS NO WORKSPACE]`,
      `O projeto confiável autoriza desenvolvimento somente no diretório "${projectPath}".`,
      `A autorização do DecoHUB NÃO substitui as permissões efetivas do Antigravity. Respeite Require Review, Deny, allowlists e aprovações manuais. Aguarde a aprovação quando exigida; não modifique nem contorne essas políticas.`,
      `Não instale dependências sem autorização aplicável. Para node:test, use arquivos explícitos ou node --test; não passe somente o diretório test/.`,
      ``,
      `1. INSTALAÇÃO INTELIGENTE DE DEPENDÊNCIAS:`,
      ` - Gerenciador detectado: ${pm}. Utilize "${installCmd} <pacote>" ou "${installDevCmd} <pacote>".`,
      ` - Verifique se a biblioteca necessária já existe antes de instalar (evite redundância).`,
      ` - Instale no escopo local do projeto. Versões estáveis e compatíveis com o lockfile (${env.lockfile || 'automático'}).`,
      ` - PROIBIDO: Pacotes globais (-g), privilégios de administrador/sudo, ou serviços pagos com custos em nuvem.`,
      ` - Registre adições relevantes no .ai-dev-hub/decisions.md e valide imediatamente com testes.`,
      ``,
      `2. TESTES TOTALMENTE AUTOMÁTICOS & VERIFICAÇÃO CONTÍNUA:`,
      ` - Stack detectada: ${env.stack}. Comando de teste padrão: "${testCmd}".`,
      ` - Se o projeto não possuir testes ou os testes forem insuficientes para comprovar o funcionamento, CRIE testes automatizados correspondentes.`,
      ` - Teste rotas, componentes, lógica de domínio, persistência e interface web.`,
      ` - Não considere arquivos criados como prontos sem testes reais passando com código 0.`,
      ``,
      `3. CICLO DE AUTOCORREÇÃO (SELF-HEALING DEBUG LOOP):`,
      ` - Se um comando ou teste falhar:`,
      `   a) Capture o erro e a stacktrace no terminal.`,
      `   b) Investigue a causa raiz (sintaxe, dependência ausente, erro de tipagem ou lógica).`,
      `   c) Aplique correção cirúrgica no código ou configuração.`,
      `   d) Reexecute "${testCmd}" ou comando de validação.`,
      `   e) Repita até passar com código 0 (respeite limite de até 5 iterações antes de escalar ao Supervisor).`,
      ` - NUNCA resolva um teste falho desabilitando, comentando ou mascarando o teste.`,
      ``,
      `4. SEGURANÇA E FRONTEIRAS OPERACIONAIS:`,
      ` - Opere exclusivamente dentro de "${projectPath}".`,
      ` - Mantenha confirmação explícita para ações destrutivas fora do workspace ou push forçado em branches protegidas.`
    ].join('\n');
  }
}
