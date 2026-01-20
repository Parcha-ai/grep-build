import { IpcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import * as fs from 'fs/promises';
import * as path from 'path';
import { sessionService } from './session.ipc';

export interface FileEntry {
  name: string;
  path: string;
  relativePath: string;
  type: 'file' | 'folder';
  extension?: string;
}

// Directories to skip when listing files
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '__pycache__',
  '.pytest_cache',
  'dist',
  'build',
  '.venv',
  'venv',
  '.idea',
  '.vscode',
  'coverage',
  '.cache',
  '.turbo',
]);

async function listFilesRecursive(
  dirPath: string,
  basePath: string,
  maxDepth: number = 4,
  currentDepth: number = 0
): Promise<FileEntry[]> {
  if (currentDepth >= maxDepth) return [];

  const entries: FileEntry[] = [];

  try {
    const items = await fs.readdir(dirPath, { withFileTypes: true });

    for (const item of items) {
      // Skip ignored directories
      if (item.isDirectory() && IGNORED_DIRS.has(item.name)) continue;
      // Skip hidden files (except .env files which are often referenced)
      if (item.name.startsWith('.') && !item.name.startsWith('.env')) continue;

      const fullPath = path.join(dirPath, item.name);
      const relativePath = path.relative(basePath, fullPath);

      if (item.isDirectory()) {
        entries.push({
          name: item.name,
          path: fullPath,
          relativePath,
          type: 'folder',
        });

        // Recurse into subdirectories
        const subEntries = await listFilesRecursive(fullPath, basePath, maxDepth, currentDepth + 1);
        entries.push(...subEntries);
      } else if (item.isFile()) {
        const ext = path.extname(item.name).toLowerCase();
        // Include all files - no filtering
        entries.push({
          name: item.name,
          path: fullPath,
          relativePath,
          type: 'file',
          extension: ext,
        });
      }
    }
  } catch (error) {
    console.error(`Error listing directory ${dirPath}:`, error);
  }

  return entries;
}

export function registerFsHandlers(ipcMain: IpcMain): void {
  // List files in session working directory
  ipcMain.handle(IPC_CHANNELS.FS_LIST_FILES, async (_event, sessionId: string, query?: string) => {
    const session = await sessionService.getSession(sessionId);
    if (!session?.worktreePath) {
      return [];
    }

    const files = await listFilesRecursive(session.worktreePath, session.worktreePath);

    // Filter by query if provided
    if (query && query.trim()) {
      const lowerQuery = query.toLowerCase();
      return files.filter(
        (f) =>
          f.name.toLowerCase().includes(lowerQuery) ||
          f.relativePath.toLowerCase().includes(lowerQuery)
      ).slice(0, 20); // Limit results
    }

    return files.slice(0, 100); // Limit initial list
  });

  // Read file content
  ipcMain.handle(IPC_CHANNELS.FS_READ_FILE, async (_event, filePath: string) => {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return { success: true, content };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // Write file content
  ipcMain.handle(IPC_CHANNELS.FS_WRITE_FILE, async (_event, filePath: string, content: string) => {
    try {
      await fs.writeFile(filePath, content, 'utf-8');
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // Search files by content (basic grep-like)
  ipcMain.handle(IPC_CHANNELS.FS_SEARCH_FILES, async (_event, sessionId: string, searchTerm: string) => {
    const session = await sessionService.getSession(sessionId);
    if (!session?.worktreePath) {
      return [];
    }

    const files = await listFilesRecursive(session.worktreePath, session.worktreePath);
    const results: Array<{ file: FileEntry; matches: string[] }> = [];

    for (const file of files.filter((f) => f.type === 'file').slice(0, 50)) {
      try {
        const content = await fs.readFile(file.path, 'utf-8');
        const lines = content.split('\n');
        const matches = lines
          .filter((line) => line.toLowerCase().includes(searchTerm.toLowerCase()))
          .slice(0, 3);

        if (matches.length > 0) {
          results.push({ file, matches });
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return results.slice(0, 10);
  });

  // Search for symbols (functions, classes, methods, etc.)
  ipcMain.handle(IPC_CHANNELS.FS_SEARCH_SYMBOLS, async (_event, sessionId: string, query: string) => {
    const session = await sessionService.getSession(sessionId);
    if (!session?.worktreePath || !query?.trim()) {
      return [];
    }

    const files = await listFilesRecursive(session.worktreePath, session.worktreePath);
    const symbolResults: Array<{
      name: string;
      kind: string;
      path: string;
      relativePath: string;
      lineNumber: number;
      detail: string;
    }> = [];

    const lowerQuery = query.toLowerCase();

    // Symbol patterns for common languages
    const symbolPatterns = [
      // TypeScript/JavaScript function/const declarations
      /^(?:export\s+)?(?:async\s+)?(?:function|const|let|var)\s+(\w+)/,
      // TypeScript/JavaScript class declarations
      /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/,
      // TypeScript interface/type declarations
      /^(?:export\s+)?(?:interface|type)\s+(\w+)/,
      // TypeScript/JavaScript method declarations (class methods)
      /^\s*(?:public|private|protected|static|async|readonly|\s)*(\w+)\s*(?:<[^>]*>)?\s*\(/,
      // Python function/class
      /^(?:async\s+)?def\s+(\w+)/,
      /^class\s+(\w+)/,
      // Go function/type
      /^func\s+(?:\([^)]+\)\s+)?(\w+)/,
      /^type\s+(\w+)/,
      // Rust function/struct/impl
      /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/,
      /^(?:pub\s+)?struct\s+(\w+)/,
      /^impl(?:<[^>]*>)?\s+(\w+)/,
    ];

    for (const file of files.filter((f) => f.type === 'file').slice(0, 100)) {
      try {
        const content = await fs.readFile(file.path, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          for (const pattern of symbolPatterns) {
            const match = line.match(pattern);
            if (match && match[1]) {
              const symbolName = match[1];

              // Filter by query
              if (symbolName.toLowerCase().includes(lowerQuery)) {
                // Determine symbol kind
                let kind = 'symbol';
                if (/class\s/.test(line)) kind = 'class';
                else if (/interface\s/.test(line)) kind = 'interface';
                else if (/type\s/.test(line)) kind = 'type';
                else if (/(?:function|def|fn)\s/.test(line) || /^\s*(?:async\s+)?(\w+)\s*\(/.test(line)) kind = 'function';
                else if (/struct\s/.test(line)) kind = 'struct';
                else if (/const\s/.test(line)) kind = 'const';

                symbolResults.push({
                  name: symbolName,
                  kind,
                  path: file.path,
                  relativePath: file.relativePath,
                  lineNumber: i + 1,
                  detail: line.trim().substring(0, 80),
                });

                // Only include first match per line
                break;
              }
            }
          }
        }
      } catch {
        // Skip files that can't be read
      }
    }

    // Sort by relevance (exact match first, then starts with, then includes)
    symbolResults.sort((a, b) => {
      const aLower = a.name.toLowerCase();
      const bLower = b.name.toLowerCase();
      const aExact = aLower === lowerQuery;
      const bExact = bLower === lowerQuery;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      const aStarts = aLower.startsWith(lowerQuery);
      const bStarts = bLower.startsWith(lowerQuery);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return a.name.length - b.name.length;
    });

    return symbolResults.slice(0, 30);
  });
}
