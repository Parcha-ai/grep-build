import { IpcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import Store from 'electron-store';
import * as fs from 'fs/promises';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sessionStore: any = new Store({ name: 'claudette-sessions' });

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

// File extensions that are commonly referenced
const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.rb', '.php', '.swift',
  '.kt', '.scala', '.vue', '.svelte', '.html', '.css', '.scss',
  '.json', '.yaml', '.yml', '.toml', '.md', '.sql', '.sh', '.bash',
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
        // Only include code files and common config files
        if (CODE_EXTENSIONS.has(ext) || item.name.includes('.config') || item.name.includes('.rc')) {
          entries.push({
            name: item.name,
            path: fullPath,
            relativePath,
            type: 'file',
            extension: ext,
          });
        }
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
    const session = sessionStore.get(`sessions.${sessionId}`) as { worktreePath?: string } | undefined;
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

  // Search files by content (basic grep-like)
  ipcMain.handle(IPC_CHANNELS.FS_SEARCH_FILES, async (_event, sessionId: string, searchTerm: string) => {
    const session = sessionStore.get(`sessions.${sessionId}`) as { worktreePath?: string } | undefined;
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
}
