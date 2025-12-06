import { IpcMain, dialog } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import { v4 as uuid } from 'uuid';
import Store from 'electron-store';
import simpleGit from 'simple-git';
import type { Session } from '../../shared/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const store: any = new Store({ name: 'claudette-sessions' });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const settingsStore: any = new Store({ name: 'claudette-settings' });

export function registerDevHandlers(ipcMain: IpcMain): void {
  // Open folder picker and check if it's a git repo
  ipcMain.handle(IPC_CHANNELS.DEV_OPEN_LOCAL_REPO, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select a Folder or Git Repository',
      buttonLabel: 'Open Folder',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    const repoPath = result.filePaths[0];
    const name = repoPath.split('/').pop() || 'Local Folder';

    // Check if it's a git repository
    try {
      const git = simpleGit(repoPath);
      const isRepo = await git.checkIsRepo();

      if (!isRepo) {
        // Not a git repo - return with flag to offer init
        return {
          success: true,
          needsGitInit: true,
          repoPath,
          name,
        };
      }

      // Try to get current branch - may fail if no commits yet
      let branch = 'main';
      try {
        branch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
      } catch {
        // Git repo exists but has no commits - offer to initialize properly
        return {
          success: true,
          needsGitInit: true,
          repoPath,
          name,
        };
      }

      return {
        success: true,
        needsGitInit: false,
        repoPath,
        branch,
        name,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to open folder',
      };
    }
  });

  // Initialize git in a folder
  ipcMain.handle('dev:init-git', async (_event, repoPath: string) => {
    try {
      const git = simpleGit(repoPath);
      await git.init();
      // Create initial commit with .gitignore
      await git.add('.gitignore').catch(() => {}); // Ignore if no .gitignore
      await git.commit('Initial commit', { '--allow-empty': null });
      const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
      return { success: true, branch: branch.trim() };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to initialize git repository',
      };
    }
  });

  // Get/Set active session ID for persistence
  ipcMain.handle('dev:get-active-session', async () => {
    return settingsStore.get('activeSessionId') || null;
  });

  ipcMain.handle('dev:set-active-session', async (_event, sessionId: string | null) => {
    if (sessionId) {
      settingsStore.set('activeSessionId', sessionId);
    } else {
      settingsStore.delete('activeSessionId');
    }
  });

  // Get/Set dev mode for persistence
  ipcMain.handle('dev:get-dev-mode', async () => {
    return settingsStore.get('isDevMode') || false;
  });

  ipcMain.handle('dev:set-dev-mode', async (_event, enabled: boolean) => {
    settingsStore.set('isDevMode', enabled);
  });

  // Create a dev session from local repo (no Docker, no cloning)
  ipcMain.handle(IPC_CHANNELS.DEV_CREATE_SESSION, async (_event, data: {
    name: string;
    repoPath: string;
    branch: string;
  }) => {
    const sessionId = uuid();

    const session: Session = {
      id: sessionId,
      name: data.name,
      repoPath: data.repoPath,
      worktreePath: data.repoPath, // For dev mode, worktree = repo
      branch: data.branch,
      status: 'running', // Dev sessions are always "running"
      ports: {
        web: 3000,
        api: 8080,
        debug: 9229,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      setupScript: '',
      isDevMode: true, // Flag for dev mode sessions
    };

    // Save session
    store.set(`sessions.${sessionId}`, session);

    return session;
  });
}
