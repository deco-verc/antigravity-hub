import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as ts from 'typescript';
import { db } from './db.js';
import { Logger } from './logger.js';
import { ObservabilityService } from './observability/observabilityService.js';

export type AstSymbolType = 'function' | 'class' | 'interface' | 'type' | 'enum' | 'const' | 'method';

export interface AstSymbol {
  id: string;
  projectId: string;
  filePath: string;
  symbolName: string;
  symbolType: AstSymbolType;
  signature: string;
  exports: number; // 1 = exported, 0 = internal
  updatedAt: string;
}

export interface ExtractedSymbol {
  symbolName: string;
  symbolType: AstSymbolType;
  signature: string;
  exports: boolean;
}

export interface SymbolIndexFilter {
  projectId: string;
  filePaths?: string[];
  symbolTypes?: AstSymbolType[];
  query?: string;
  onlyExported?: boolean;
  limit?: number;
}

/**
 * Normaliza caminhos de arquivo para formato relativo padrão com barras normais.
 */
function normalizeFilePath(p: string, basePath?: string): string {
  if (!p) return '';
  let resolved = p;
  if (basePath && path.isAbsolute(p)) {
    try {
      resolved = path.relative(basePath, p);
    } catch {
      resolved = p;
    }
  }
  return resolved.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * AstSymbolIndexService
 * Mapeia assinaturas de funções, classes, métodos, interfaces e tipos em SQLite (project_ast_symbols),
 * gerando resumos estruturados concisos para proteger o contexto contra Context Rot e perda de atenção.
 */
export class AstSymbolIndexService {
  /**
   * Extrai símbolos sintáticos utilizando o TypeScript AST Compiler.
   */
  static extractSymbolsWithTsAst(code: string, fileName: string): ExtractedSymbol[] {
    const isJsx = /\.[jt]sx$/i.test(fileName);
    const scriptKind = isJsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS;

    const sourceFile = ts.createSourceFile(
      fileName,
      code,
      ts.ScriptTarget.Latest,
      true,
      scriptKind
    );

    const symbols: ExtractedSymbol[] = [];

    const isExported = (node: ts.Node): boolean => {
      const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
      return Boolean(modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword));
    };

    const visit = (node: ts.Node) => {
      // 1. Funções
      if (ts.isFunctionDeclaration(node) && node.name) {
        const exported = isExported(node);
        const name = node.name.text;
        const params = node.parameters.map(p => p.getText(sourceFile)).join(', ');
        const returnType = node.type ? `: ${node.type.getText(sourceFile)}` : '';
        const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
        const isAsync = Boolean(modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword));
        const prefix = exported ? 'export ' : '';
        const asyncPrefix = isAsync ? 'async ' : '';
        const signature = `${prefix}${asyncPrefix}function ${name}(${params})${returnType}`;

        symbols.push({
          symbolName: name,
          symbolType: 'function',
          signature,
          exports: exported
        });
      }

      // 2. Classes
      else if (ts.isClassDeclaration(node) && node.name) {
        const exported = isExported(node);
        const name = node.name.text;
        let heritage = '';
        if (node.heritageClauses) {
          heritage = ' ' + node.heritageClauses.map(h => h.getText(sourceFile)).join(' ');
        }
        const signature = `${exported ? 'export ' : ''}class ${name}${heritage}`;

        symbols.push({
          symbolName: name,
          symbolType: 'class',
          signature,
          exports: exported
        });

        // Métodos públicos da classe
        for (const member of node.members) {
          if (ts.isMethodDeclaration(member) && member.name) {
            const memberModifiers = ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined;
            const isPrivate = Boolean(memberModifiers?.some(m => m.kind === ts.SyntaxKind.PrivateKeyword));
            const isStatic = Boolean(memberModifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword));

            if (!isPrivate) {
              const methodName = member.name.getText(sourceFile);
              const memberParams = member.parameters.map(p => p.getText(sourceFile)).join(', ');
              const memberReturn = member.type ? `: ${member.type.getText(sourceFile)}` : '';
              const staticPrefix = isStatic ? 'static ' : '';
              const methodSig = `${staticPrefix}${methodName}(${memberParams})${memberReturn}`;

              symbols.push({
                symbolName: `${name}.${methodName}`,
                symbolType: 'method',
                signature: methodSig,
                exports: exported
              });
            }
          }
        }
      }

      // 3. Interfaces
      else if (ts.isInterfaceDeclaration(node)) {
        const exported = isExported(node);
        const name = node.name.text;
        const memberSnippets = node.members.slice(0, 8).map(m => m.getText(sourceFile).trim()).join('; ');
        const extra = node.members.length > 8 ? '; ...' : '';
        const signature = `${exported ? 'export ' : ''}interface ${name} { ${memberSnippets}${extra} }`;

        symbols.push({
          symbolName: name,
          symbolType: 'interface',
          signature,
          exports: exported
        });
      }

      // 4. Types
      else if (ts.isTypeAliasDeclaration(node)) {
        const exported = isExported(node);
        const name = node.name.text;
        const typeSnippet = node.type.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 100);
        const signature = `${exported ? 'export ' : ''}type ${name} = ${typeSnippet}`;

        symbols.push({
          symbolName: name,
          symbolType: 'type',
          signature,
          exports: exported
        });
      }

      // 5. Enums
      else if (ts.isEnumDeclaration(node)) {
        const exported = isExported(node);
        const name = node.name.text;
        const members = node.members.slice(0, 6).map(m => m.getText(sourceFile).trim()).join(', ');
        const extra = node.members.length > 6 ? ', ...' : '';
        const signature = `${exported ? 'export ' : ''}enum ${name} { ${members}${extra} }`;

        symbols.push({
          symbolName: name,
          symbolType: 'enum',
          signature,
          exports: exported
        });
      }

      // 6. Variáveis e Arrow Functions exportadas
      else if (ts.isVariableStatement(node)) {
        const exported = isExported(node);
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            const name = decl.name.text;
            const isArrow = decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer));

            if (isArrow) {
              const fn = decl.initializer as ts.ArrowFunction | ts.FunctionExpression;
              const params = fn.parameters.map(p => p.getText(sourceFile)).join(', ');
              const retType = fn.type ? `: ${fn.type.getText(sourceFile)}` : '';
              symbols.push({
                symbolName: name,
                symbolType: 'function',
                signature: `${exported ? 'export ' : ''}const ${name} = (${params})${retType}`,
                exports: exported
              });
            } else if (exported) {
              const typeAnn = decl.type ? `: ${decl.type.getText(sourceFile)}` : '';
              symbols.push({
                symbolName: name,
                symbolType: 'const',
                signature: `export const ${name}${typeAnn}`,
                exports: true
              });
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return symbols;
  }

  /**
   * Analisador sintático rápido baseado em Regex para fallback e resiliência máxima.
   */
  static extractSymbolsWithRegex(code: string, fileName: string): ExtractedSymbol[] {
    const symbols: ExtractedSymbol[] = [];
    const lines = code.split(/\r?\n/);

    const fnRegex = /^(export\s+)?(async\s+)?function\s+([a-zA-Z0-9_$]+)\s*(\([^)]*\))(?:\s*:\s*([^{]+))?/m;
    const arrowRegex = /^(export\s+)?const\s+([a-zA-Z0-9_$]+)\s*=\s*(async\s+)?\(([^)]*)\)(?:\s*:\s*([^=]+))?\s*=>/m;
    const classRegex = /^(export\s+)?(?:default\s+)?class\s+([a-zA-Z0-9_$]+)(?:\s+extends\s+[^{]+)?(?:\s+implements\s+[^{]+)?/m;
    const ifaceRegex = /^(export\s+)?interface\s+([a-zA-Z0-9_$]+)(?:\s+extends\s+[^{]+)?\s*\{/m;
    const typeRegex = /^(export\s+)?type\s+([a-zA-Z0-9_$]+)\s*=\s*([^;]+);?/m;
    const enumRegex = /^(export\s+)?enum\s+([a-zA-Z0-9_$]+)\s*\{/m;
    const cjsFnRegex = /^(?:module\.)?exports\.([a-zA-Z0-9_$]+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>)/m;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) continue;

      const fnMatch = line.match(fnRegex);
      if (fnMatch) {
        const isExp = Boolean(fnMatch[1]);
        const isAsync = Boolean(fnMatch[2]);
        const name = fnMatch[3];
        const params = fnMatch[4];
        const ret = fnMatch[5] ? `: ${fnMatch[5].trim()}` : '';
        symbols.push({
          symbolName: name,
          symbolType: 'function',
          signature: `${isExp ? 'export ' : ''}${isAsync ? 'async ' : ''}function ${name}${params}${ret}`,
          exports: isExp
        });
        continue;
      }

      const arrowMatch = line.match(arrowRegex);
      if (arrowMatch) {
        const isExp = Boolean(arrowMatch[1]);
        const name = arrowMatch[2];
        const isAsync = Boolean(arrowMatch[3]);
        const params = arrowMatch[4];
        const ret = arrowMatch[5] ? `: ${arrowMatch[5].trim()}` : '';
        symbols.push({
          symbolName: name,
          symbolType: 'function',
          signature: `${isExp ? 'export ' : ''}const ${name} = ${isAsync ? 'async ' : ''}(${params})${ret}`,
          exports: isExp
        });
        continue;
      }

      const classMatch = line.match(classRegex);
      if (classMatch) {
        const isExp = Boolean(classMatch[1]);
        const name = classMatch[2];
        symbols.push({
          symbolName: name,
          symbolType: 'class',
          signature: classMatch[0].trim(),
          exports: isExp
        });
        continue;
      }

      const ifaceMatch = line.match(ifaceRegex);
      if (ifaceMatch) {
        const isExp = Boolean(ifaceMatch[1]);
        const name = ifaceMatch[2];
        symbols.push({
          symbolName: name,
          symbolType: 'interface',
          signature: `${isExp ? 'export ' : ''}interface ${name}`,
          exports: isExp
        });
        continue;
      }

      const typeMatch = line.match(typeRegex);
      if (typeMatch) {
        const isExp = Boolean(typeMatch[1]);
        const name = typeMatch[2];
        const typeDef = typeMatch[3].trim().slice(0, 100);
        symbols.push({
          symbolName: name,
          symbolType: 'type',
          signature: `${isExp ? 'export ' : ''}type ${name} = ${typeDef}`,
          exports: isExp
        });
        continue;
      }

      const enumMatch = line.match(enumRegex);
      if (enumMatch) {
        const isExp = Boolean(enumMatch[1]);
        const name = enumMatch[2];
        symbols.push({
          symbolName: name,
          symbolType: 'enum',
          signature: `${isExp ? 'export ' : ''}enum ${name}`,
          exports: isExp
        });
        continue;
      }

      const cjsMatch = line.match(cjsFnRegex);
      if (cjsMatch) {
        const name = cjsMatch[1];
        symbols.push({
          symbolName: name,
          symbolType: 'function',
          signature: `exports.${name} = function(...)`,
          exports: true
        });
        continue;
      }
    }

    return symbols;
  }

  /**
   * Extrai símbolos do código tentando primeiro TypeScript AST e recorrendo à Regex se necessário.
   */
  static extractSymbols(code: string, fileName = 'file.ts'): ExtractedSymbol[] {
    if (!code || typeof code !== 'string') return [];
    try {
      const tsSymbols = this.extractSymbolsWithTsAst(code, fileName);
      if (tsSymbols && tsSymbols.length > 0) {
        return tsSymbols;
      }
    } catch {}

    return this.extractSymbolsWithRegex(code, fileName);
  }

  /**
   * Atualiza atomicamente os símbolos de um arquivo específico em SQLite.
   */
  static updateIndexForFile(
    projectId: string,
    projectPath: string,
    relativeFilePath: string,
    explicitContent?: string
  ): AstSymbol[] {
    if (!projectId || !projectPath || !relativeFilePath) return [];

    const normRelPath = normalizeFilePath(relativeFilePath, projectPath);
    const absPath = path.isAbsolute(relativeFilePath) ? relativeFilePath : path.join(projectPath, normRelPath);

    let content = explicitContent;
    if (content === undefined && fs.existsSync(absPath)) {
      try {
        content = fs.readFileSync(absPath, 'utf8');
      } catch (err: any) {
        Logger.warn(`[AstSymbolIndexService] Falha ao ler arquivo para indexação (${normRelPath}): ${err.message}`);
        return [];
      }
    }

    if (content === undefined) {
      // Arquivo foi excluído; remover do índice
      this.removeIndexForFile(projectId, normRelPath);
      return [];
    }

    const extracted = this.extractSymbols(content, normRelPath);
    const nowIso = new Date().toISOString();
    const resultSymbols: AstSymbol[] = [];

    const deleteStmt = db.prepare('DELETE FROM project_ast_symbols WHERE project_id = ? AND file_path = ?');
    const insertStmt = db.prepare(`
      INSERT INTO project_ast_symbols (
        id, project_id, file_path, symbol_name, symbol_type, signature, exports, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      db.exec('BEGIN IMMEDIATE');
      deleteStmt.run(projectId, normRelPath);
      for (const s of extracted) {
        const id = crypto.randomUUID();
        const exportVal = s.exports ? 1 : 0;
        insertStmt.run(id, projectId, normRelPath, s.symbolName, s.symbolType, s.signature, exportVal, nowIso);
        resultSymbols.push({
          id,
          projectId,
          filePath: normRelPath,
          symbolName: s.symbolName,
          symbolType: s.symbolType,
          signature: s.signature,
          exports: exportVal,
          updatedAt: nowIso
        });
      }
      db.exec('COMMIT');
    } catch (txErr: any) {
      try { db.exec('ROLLBACK'); } catch {}
      Logger.warn(`[AstSymbolIndexService] Erro na transação de atualização para ${normRelPath}: ${txErr.message}`);
      return [];
    }

    ObservabilityService.emit({
      level: 'INFO',
      event: 'AST_SYMBOLS_INDEXED',
      message: `AST Symbol Index: ${resultSymbols.length} símbolos indexados para ${normRelPath}`,
      service: 'ast-symbol-index',
      metadata: {
        projectId,
        filePath: normRelPath,
        symbolCount: resultSymbols.length
      }
    });

    return resultSymbols;
  }

  /**
   * Atualiza símbolos para uma lista de arquivos.
   */
  static updateIndexForFiles(
    projectId: string,
    projectPath: string,
    filePaths: string[]
  ): number {
    let count = 0;
    for (const f of filePaths) {
      const syms = this.updateIndexForFile(projectId, projectPath, f);
      count += syms.length;
    }
    return count;
  }

  /**
   * Remove símbolos de um arquivo.
   */
  static removeIndexForFile(projectId: string, relativeFilePath: string): void {
    const normRelPath = normalizeFilePath(relativeFilePath);
    try {
      db.prepare('DELETE FROM project_ast_symbols WHERE project_id = ? AND file_path = ?').run(projectId, normRelPath);
    } catch (err: any) {
      Logger.warn(`[AstSymbolIndexService] Falha ao remover índice para ${normRelPath}: ${err.message}`);
    }
  }

  /**
   * Indexa todos os arquivos de código de um projeto.
   */
  static async indexProjectFiles(
    projectId: string,
    projectPath: string,
    options: {
      maxFiles?: number;
      extensions?: string[];
      ignoreDirs?: string[];
    } = {}
  ): Promise<{ indexedFiles: number; totalSymbols: number }> {
    if (!projectPath || !fs.existsSync(projectPath)) {
      return { indexedFiles: 0, totalSymbols: 0 };
    }

    const maxFiles = options.maxFiles || 150;
    const extensions = options.extensions || ['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs'];
    const ignoreDirs = options.ignoreDirs || ['node_modules', 'dist', '.git', '.ai-dev-arena', 'coverage', '.ai-dev-hub'];

    const matchedFiles: string[] = [];

    const walk = (dir: string) => {
      if (matchedFiles.length >= maxFiles) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (matchedFiles.length >= maxFiles) break;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!ignoreDirs.includes(entry.name)) {
              walk(fullPath);
            }
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (extensions.includes(ext) && !entry.name.endsWith('.d.ts')) {
              matchedFiles.push(path.relative(projectPath, fullPath));
            }
          }
        }
      } catch {}
    };

    walk(projectPath);

    let totalSymbols = 0;
    for (const relFile of matchedFiles) {
      const symbols = this.updateIndexForFile(projectId, projectPath, relFile);
      totalSymbols += symbols.length;
    }

    Logger.info(`[AstSymbolIndexService] Indexação de projeto concluída para ${projectId}: ${matchedFiles.length} arquivos, ${totalSymbols} símbolos.`);
    return { indexedFiles: matchedFiles.length, totalSymbols };
  }

  /**
   * Consulta símbolos indexados aplicando filtros de escopo, tipo e texto.
   */
  static querySymbols(filter: SymbolIndexFilter): AstSymbol[] {
    let sql = 'SELECT * FROM project_ast_symbols WHERE project_id = ?';
    const params: any[] = [filter.projectId];

    if (filter.onlyExported) {
      sql += ' AND exports = 1';
    }

    if (filter.symbolTypes && filter.symbolTypes.length > 0) {
      const placeholders = filter.symbolTypes.map(() => '?').join(',');
      sql += ` AND symbol_type IN (${placeholders})`;
      params.push(...filter.symbolTypes);
    }

    if (filter.filePaths && filter.filePaths.length > 0) {
      const normPaths = filter.filePaths.map(p => normalizeFilePath(p));
      const placeholders = normPaths.map(() => '?').join(',');
      sql += ` AND file_path IN (${placeholders})`;
      params.push(...normPaths);
    }

    if (filter.query) {
      sql += ' AND (symbol_name LIKE ? OR signature LIKE ?)';
      params.push(`%${filter.query}%`, `%${filter.query}%`);
    }

    sql += ' ORDER BY file_path ASC, symbol_name ASC';

    if (filter.limit && filter.limit > 0) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    try {
      const rows = db.prepare(sql).all(...params) as any[];
      return rows.map(r => ({
        id: r.id,
        projectId: r.project_id,
        filePath: r.file_path,
        symbolName: r.symbol_name,
        symbolType: r.symbol_type as AstSymbolType,
        signature: r.signature,
        exports: r.exports,
        updatedAt: r.updated_at
      }));
    } catch (err: any) {
      Logger.warn(`[AstSymbolIndexService] Falha ao consultar símbolos: ${err.message}`);
      return [];
    }
  }

  /**
   * Gera um resumo estruturado de assinaturas públicas para injeção no prompt do Worker,
   * garantindo que o consumo de tokens permaneça estritamente controlado (< 30% da janela).
   */
  static generateStructuredSymbolSummary(
    projectId: string,
    options: {
      projectPath?: string;
      targetFiles?: string[];
      maxChars?: number;
      onlyExported?: boolean;
    } = {}
  ): string {
    const maxChars = options.maxChars || 8000;
    const onlyExported = options.onlyExported ?? true;

    // Se temos arquivos no escopo e o caminho do projeto, auto-indexa se necessário
    if (options.projectPath && options.targetFiles && options.targetFiles.length > 0) {
      for (const tf of options.targetFiles) {
        const norm = normalizeFilePath(tf);
        const existing = this.querySymbols({ projectId, filePaths: [norm], limit: 1 });
        if (existing.length === 0) {
          this.updateIndexForFile(projectId, options.projectPath, norm);
        }
      }
    }

    // 1. Consultar símbolos
    let symbols = this.querySymbols({
      projectId,
      onlyExported,
      filePaths: options.targetFiles && options.targetFiles.length > 0 ? options.targetFiles : undefined
    });

    // Se retornou poucos símbolos com os arquivos alvo, buscar os módulos principais do projeto
    if (symbols.length < 5) {
      symbols = this.querySymbols({
        projectId,
        onlyExported,
        limit: 80
      });
    }

    if (symbols.length === 0) {
      return '';
    }

    // Agrupar por arquivo
    const groupedByFile = new Map<string, AstSymbol[]>();
    for (const s of symbols) {
      const list = groupedByFile.get(s.filePath) || [];
      list.push(s);
      groupedByFile.set(s.filePath, list);
    }

    const lines: string[] = [
      '### [ESTRUTURA DE MÓDULOS E SÍMBOLOS EXPORTADOS (AST Symbol Index)]',
      'Assinaturas públicas de módulos existentes no projeto (utilize para imports consistentes e prevenção de duplicações):'
    ];

    let currentLength = lines.join('\n').length;
    let truncated = false;

    for (const [file, fileSymbols] of groupedByFile.entries()) {
      const fileHeader = `\n#### \`${file}\``;
      if (currentLength + fileHeader.length > maxChars) {
        truncated = true;
        break;
      }
      lines.push(fileHeader);
      currentLength += fileHeader.length;

      for (const s of fileSymbols) {
        const itemLine = `- [${s.symbolType}] \`${s.signature}\``;
        if (currentLength + itemLine.length + 1 > maxChars) {
          truncated = true;
          break;
        }
        lines.push(itemLine);
        currentLength += itemLine.length + 1;
      }

      if (truncated) break;
    }

    if (truncated) {
      lines.push('\n[... assinaturas adicionais preservadas em SQLite project_ast_symbols para respeitar o teto de tokens ...]');
    }

    return lines.join('\n');
  }

  /**
   * Retorna a contagem total de símbolos indexados para um projeto.
   */
  static getProjectSymbolCount(projectId: string): number {
    try {
      const row = db.prepare('SELECT COUNT(*) as c FROM project_ast_symbols WHERE project_id = ?').get(projectId) as any;
      return row ? Number(row.c) : 0;
    } catch {
      return 0;
    }
  }
}
