import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { normalizeRuntimePath } from './runtimeProfileSelector.js';
import { Logger } from './logger.js';
import { db, HUB_DATA_DIR } from './db.js';

export interface SanitizeResult {
  removedConfigFiles: string[];
  removedCacheEntries: string[];
  removedDbProjects: string[];
  removedDbBindings: string[];
  totalRemoved: number;
}

/**
 * Avalia se um projeto é fantasma/órfão de acordo com critérios estritos:
 * 1. Nome de suíte de teste ("App Financeiro Homologação E2E", "Projeto Forensic Hardening", ou contém "Test", "Mock", "Forensic", "Homologação E2E");
 * 2. folderUri/path aponta para pastas temporárias (os.tmpdir(), AppData/Local/Temp);
 * 3. folderUri/path já deletado que não existe mais em disco;
 * 4. folderUri/path aponta para a pasta-mãe genérica C:\IA (mantendo projetos reais como C:\IA\Antigravity HUB\ai-dev-hub e C:\IA\test-projects\*).
 */
export function isGhostProject(
  name?: string | null,
  folderPath?: string | null,
  folderUri?: string | null
): { isGhost: boolean; reason?: string } {
  let resolvedPath = folderPath ? String(folderPath).trim() : '';
  if (!resolvedPath && folderUri) {
    try {
      resolvedPath = fileURLToPath(folderUri);
    } catch {
      resolvedPath = folderUri.replace(/^file:\/\/\/?/i, '');
      try {
        resolvedPath = decodeURIComponent(resolvedPath);
      } catch {}
    }
  }

  const normPath = resolvedPath ? normalizeRuntimePath(resolvedPath).toLowerCase().replace(/\/+$/, '') : '';
  const tmpDir = normalizeRuntimePath(os.tmpdir()).toLowerCase().replace(/\/+$/, '');

  // 0. Proteção Estrita Inviolável: DecoHUB Engine e projetos reais em C:\IA\test-projects\* NUNCA são fantasmas
  const isDecoHubEngine =
    normPath.includes('antigravity hub/ai-dev-hub') ||
    normPath.includes('antigravity%20hub/ai-dev-hub') ||
    folderUri?.toLowerCase().includes('antigravity%20hub/ai-dev-hub') ||
    folderUri?.toLowerCase().includes('antigravity hub/ai-dev-hub') ||
    (name && /decohub/i.test(name));

  const isRealTestProject =
    (normPath.includes('/test-projects') || folderUri?.toLowerCase().includes('/test-projects')) &&
    resolvedPath &&
    fs.existsSync(resolvedPath);

  if (isDecoHubEngine || isRealTestProject) {
    if (!resolvedPath || fs.existsSync(resolvedPath)) {
      return { isGhost: false };
    }
  }

  // 1. Pasta-mãe genérica C:\IA (ou X:\IA)
  // Preserva explicitamente projetos reais dentro dela (ex: C:\IA\Antigravity HUB\ai-dev-hub ou C:\IA\test-projects\*)
  const isGenericIaRoot =
    normPath === 'c:/ia' ||
    normPath === '/c:/ia' ||
    /^[a-z]:\/ia$/i.test(normPath) ||
    folderUri?.toLowerCase() === 'file:///c:/ia' ||
    folderUri?.toLowerCase() === 'file:///c%3a/ia';

  if (isGenericIaRoot) {
    return { isGhost: true, reason: 'Raiz genérica do workspace (C:\\IA)' };
  }

  // 2. Pastas temporárias
  if (
    normPath &&
    (normPath === tmpDir ||
      normPath.startsWith(tmpDir + '/') ||
      normPath.includes('/appdata/local/temp') ||
      normPath.includes('decohub-test-') ||
      normPath.includes('decohub-forensic-') ||
      normPath.includes('decohub-homologacao-') ||
      normPath.includes('/temp-') ||
      normPath.includes('\\temp-'))
  ) {
    return { isGhost: true, reason: `Pasta temporária (${resolvedPath})` };
  }

  // 3. Nomes de suítes de teste
  if (name) {
    const cleanName = String(name).trim();
    const normalizedName = cleanName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

    if (
      normalizedName.includes('homologacao e2e') ||
      normalizedName.includes('forensic hardening') ||
      normalizedName.includes('projeto forensic') ||
      normalizedName.includes('app financeiro homologacao') ||
      normalizedName.includes('test project') ||
      normalizedName === 'ia' ||
      normalizedName.startsWith('temp-') ||
      /\b(test|mock|forensic)\b/i.test(normalizedName)
    ) {
      return { isGhost: true, reason: `Nome sintético de teste ("${name}")` };
    }
  }

  // 4. Pastas deletadas que não existem mais no disco
  if (resolvedPath && !fs.existsSync(resolvedPath)) {
    return { isGhost: true, reason: `Pasta inexistente no disco (${resolvedPath})` };
  }

  return { isGhost: false };
}

/**
 * Executa o saneamento de projetos fantasmas no Antigravity:
 * 1. Remove manifestos <uuid>.json órfãos em ~/.gemini/config/projects/
 * 2. Remove entradas órfãs no cache ~/.gemini/antigravity-cli/cache/projects.json
 * 3. Limpa registros de teste que vazaram no hub.db (tabelas projects e native_workspace_bindings)
 */
export function sanitizeGhostAntigravityProjects(customHomeDir?: string): SanitizeResult {
  const result: SanitizeResult = {
    removedConfigFiles: [],
    removedCacheEntries: [],
    removedDbProjects: [],
    removedDbBindings: [],
    totalRemoved: 0
  };

  // Coleta diretórios de usuário candidatos
  const userHomes = new Set<string>();
  if (customHomeDir) userHomes.add(customHomeDir);
  if (process.env.REAL_USERPROFILE) userHomes.add(process.env.REAL_USERPROFILE);
  if (process.env.USERPROFILE) userHomes.add(process.env.USERPROFILE);
  try {
    userHomes.add(os.homedir());
  } catch {}
  if (process.platform === 'win32') {
    userHomes.add('C:\\Users\\Deco');
  }

  for (const homeDir of userHomes) {
    if (!homeDir || !fs.existsSync(homeDir)) continue;

    // 1. Inspecionar e limpar ~/.gemini/config/projects/*.json
    const projectsDir = path.join(homeDir, '.gemini', 'config', 'projects');
    if (fs.existsSync(projectsDir)) {
      try {
        const files = fs.readdirSync(projectsDir);
        for (const file of files) {
          if (!file.endsWith('.json') || file === 'outside-of-project.json') continue;
          const filePath = path.join(projectsDir, file);
          try {
            const content = fs.readFileSync(filePath, 'utf8');
            const data = JSON.parse(content);
            const res = data.projectResources?.resources?.[0];
            const folderUri = res?.gitFolder?.folderUri || res?.localFolder?.folderUri;
            const evalResult = isGhostProject(data.name, null, folderUri);
            if (evalResult.isGhost) {
              fs.unlinkSync(filePath);
              result.removedConfigFiles.push(`${filePath} (${evalResult.reason})`);
              result.totalRemoved++;
              Logger.info(`[GhostSanitizer] Manifesto fantasma removido: ${filePath} [Motivo: ${evalResult.reason}]`);
            }
          } catch (fileErr: any) {
            Logger.warn(`[GhostSanitizer] Erro ao inspecionar manifesto ${filePath}: ${fileErr.message}`);
          }
        }
      } catch (dirErr: any) {
        Logger.warn(`[GhostSanitizer] Erro ao ler diretório ${projectsDir}: ${dirErr.message}`);
      }
    }

    // 2. Inspecionar e limpar ~/.gemini/antigravity-cli/cache/projects.json
    const cacheFile = path.join(homeDir, '.gemini', 'antigravity-cli', 'cache', 'projects.json');
    if (fs.existsSync(cacheFile)) {
      try {
        const raw = fs.readFileSync(cacheFile, 'utf8');
        let cacheData = JSON.parse(raw);
        let modified = false;

        if (Array.isArray(cacheData)) {
          const originalCount = cacheData.length;
          cacheData = cacheData.filter((item: any) => {
            const evalResult = isGhostProject(item.name, item.path, item.folderUri);
            if (evalResult.isGhost) {
              result.removedCacheEntries.push(`${item.name || item.id} (${evalResult.reason})`);
              result.totalRemoved++;
              Logger.info(`[GhostSanitizer] Projeto removido do cache CLI: ${item.name || item.id} [Motivo: ${evalResult.reason}]`);
              return false;
            }
            return true;
          });
          if (cacheData.length !== originalCount) modified = true;
        } else if (typeof cacheData === 'object' && cacheData !== null) {
          for (const key of Object.keys(cacheData)) {
            const item = cacheData[key];
            const evalResult = isGhostProject(item?.name, item?.path, item?.folderUri);
            if (evalResult.isGhost) {
              delete cacheData[key];
              modified = true;
              result.removedCacheEntries.push(`${item?.name || key} (${evalResult.reason})`);
              result.totalRemoved++;
              Logger.info(`[GhostSanitizer] Projeto removido do cache CLI: ${item?.name || key} [Motivo: ${evalResult.reason}]`);
            }
          }
        }

        if (modified) {
          fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2), 'utf8');
          Logger.info(`[GhostSanitizer] Cache CLI atualizado com sucesso: ${cacheFile}`);
        }
      } catch (cacheErr: any) {
        Logger.warn(`[GhostSanitizer] Erro ao processar cache CLI ${cacheFile}: ${cacheErr.message}`);
      }
    }
  }

  // 3. Saneamento no hub.db
  const dbPaths = new Set<string>();
  if (HUB_DATA_DIR) {
    dbPaths.add(path.join(HUB_DATA_DIR, 'hub.db'));
  }
  for (const home of userHomes) {
    dbPaths.add(path.join(home, '.ai-dev-hub', 'hub.db'));
  }

  for (const dbPath of dbPaths) {
    if (!fs.existsSync(dbPath)) continue;
    try {
      const isCurrentDb = HUB_DATA_DIR && normalizeRuntimePath(dbPath) === normalizeRuntimePath(path.join(HUB_DATA_DIR, 'hub.db'));
      const activeDb = isCurrentDb ? db : new DatabaseSync(dbPath);

      try {
        const projects = activeDb.prepare('SELECT id, name, path FROM projects').all() as any[];
        for (const proj of projects) {
          const evalResult = isGhostProject(proj.name, proj.path, null);
          if (evalResult.isGhost) {
            try { activeDb.prepare('DELETE FROM native_workspace_bindings WHERE project_id = ?').run(proj.id); } catch {}
            try { activeDb.prepare('DELETE FROM native_execution_policies WHERE project_id = ?').run(proj.id); } catch {}
            try { activeDb.prepare('DELETE FROM autonomous_runs WHERE project_id = ?').run(proj.id); } catch {}
            try { activeDb.prepare('DELETE FROM projects WHERE id = ?').run(proj.id); } catch {}
            result.removedDbProjects.push(`${proj.name} (${proj.id}) - ${evalResult.reason}`);
            result.totalRemoved++;
            Logger.info(`[GhostSanitizer] Projeto fantasma removido de ${dbPath}: ${proj.name} (${proj.id})`);
          }
        }

        const bindings = activeDb.prepare('SELECT project_id, native_project_id, workspace_path FROM native_workspace_bindings').all() as any[];
        for (const binding of bindings) {
          const evalResult = isGhostProject(null, binding.workspace_path, null);
          const parentExists = activeDb.prepare('SELECT 1 FROM projects WHERE id = ?').get(binding.project_id);
          if (evalResult.isGhost || !parentExists) {
            try { activeDb.prepare('DELETE FROM native_workspace_bindings WHERE project_id = ?').run(binding.project_id); } catch {}
            result.removedDbBindings.push(`Binding ${binding.project_id} -> ${binding.native_project_id}`);
            result.totalRemoved++;
            Logger.info(`[GhostSanitizer] Vínculo nativo fantasma removido de ${dbPath}: ${binding.project_id}`);
          }
        }
      } finally {
        if (!isCurrentDb && typeof (activeDb as any).close === 'function') {
          (activeDb as any).close();
        }
      }
    } catch (dbErr: any) {
      Logger.warn(`[GhostSanitizer] Aviso ao sanear banco ${dbPath}: ${dbErr.message}`);
    }
  }

  return result;
}
