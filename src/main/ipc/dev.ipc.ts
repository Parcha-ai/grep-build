import { IpcMain, dialog } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import { v4 as uuid } from 'uuid';
import Store from 'electron-store';
import simpleGit from 'simple-git';
import type { Session } from '../../shared/types';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
          isGit: false,
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
          isGit: true,
        };
      }

      return {
        success: true,
        needsGitInit: false,
        repoPath,
        branch,
        name,
        isGit: true,
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

  // Check if a folder is a git repository
  ipcMain.handle(IPC_CHANNELS.DEV_CHECK_GIT_REPO, async (_event, repoPath: string) => {
    try {
      const git = simpleGit(repoPath);
      const isGit = await git.checkIsRepo();

      if (!isGit) {
        return { isGit: false };
      }

      // Try to get current branch
      let branch = 'main';
      try {
        branch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
      } catch {
        // Git repo exists but has no commits
        branch = 'main';
      }

      return { isGit: true, branch };
    } catch (error) {
      return { isGit: false, error: error instanceof Error ? error.message : 'Failed to check git repo' };
    }
  });

  // Create a dev session from local repo (no Docker, no cloning)
  ipcMain.handle(IPC_CHANNELS.DEV_CREATE_SESSION, async (_event, data: {
    name: string;
    repoPath: string;
    branch: string;
    createWorktree?: boolean;
  }) => {
    const sessionId = uuid();
    let worktreePath = data.repoPath;

    // If creating a worktree, set up a new worktree directory
    if (data.createWorktree) {
      try {
        const git = simpleGit(data.repoPath);
        const isGit = await git.checkIsRepo();

        if (isGit) {
          // Create worktree in a subdirectory of the repo
          const worktreeName = `worktree-${sessionId.substring(0, 8)}`;
          worktreePath = `${data.repoPath}/.claudette-worktrees/${worktreeName}`;

          // Create the worktree
          await git.raw(['worktree', 'add', worktreePath, data.branch]);

          // Execute worktree setup if configured
          const claudetteDir = path.join(data.repoPath, '.claudette');
          const scriptPath = path.join(claudetteDir, 'worktree-setup.sh');
          const instructionsPath = path.join(claudetteDir, 'worktree-setup.md');

          const [scriptExists, instructionsExist] = await Promise.all([
            fs.access(scriptPath).then(() => true).catch(() => false),
            fs.access(instructionsPath).then(() => true).catch(() => false),
          ]);

          if (scriptExists) {
            console.log(`[Worktree Setup] Executing script: ${scriptPath}`);
            try {
              const { stdout, stderr } = await execAsync(`bash "${scriptPath}"`, {
                cwd: worktreePath,
                env: { ...process.env, WORKTREE_PATH: worktreePath, REPO_PATH: data.repoPath },
              });
              console.log(`[Worktree Setup] Script output:`, stdout);
              if (stderr) console.warn(`[Worktree Setup] Script stderr:`, stderr);
            } catch (error) {
              console.error(`[Worktree Setup] Script execution failed:`, error);
            }
          } else if (instructionsExist) {
            const instructions = await fs.readFile(instructionsPath, 'utf-8');
            console.log(`[Worktree Setup] Instructions found (will be provided to Claude):`, instructions.substring(0, 100) + '...');
            // Instructions will be provided to Claude through the session
          }
        }
      } catch (error) {
        console.error('Failed to create worktree:', error);
        // Fall back to using the main repo path
        worktreePath = data.repoPath;
      }
    }

    const session: Session = {
      id: sessionId,
      name: data.name,
      repoPath: data.repoPath,
      worktreePath: worktreePath,
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

  // Check if worktree setup files exist in project
  ipcMain.handle(IPC_CHANNELS.DEV_CHECK_WORKTREE_SETUP, async (_event, repoPath: string) => {
    try {
      const claudetteDir = path.join(repoPath, '.claudette');
      const scriptPath = path.join(claudetteDir, 'worktree-setup.sh');
      const instructionsPath = path.join(claudetteDir, 'worktree-setup.md');

      const [scriptExists, instructionsExist] = await Promise.all([
        fs.access(scriptPath).then(() => true).catch(() => false),
        fs.access(instructionsPath).then(() => true).catch(() => false),
      ]);

      return {
        success: true,
        hasScript: scriptExists,
        hasInstructions: instructionsExist,
        scriptPath: scriptExists ? scriptPath : undefined,
        instructionsPath: instructionsExist ? instructionsPath : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to check worktree setup',
      };
    }
  });

  // Save worktree setup script by copying from provided path
  ipcMain.handle(IPC_CHANNELS.DEV_SAVE_WORKTREE_SCRIPT, async (_event, data: {
    repoPath: string;
    sourcePath: string;
  }) => {
    try {
      const claudetteDir = path.join(data.repoPath, '.claudette');
      await fs.mkdir(claudetteDir, { recursive: true });

      const targetPath = path.join(claudetteDir, 'worktree-setup.sh');
      await fs.copyFile(data.sourcePath, targetPath);
      await fs.chmod(targetPath, 0o755); // Make executable

      return { success: true, path: targetPath };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save worktree script',
      };
    }
  });

  // Save worktree setup instructions from text
  ipcMain.handle(IPC_CHANNELS.DEV_SAVE_WORKTREE_INSTRUCTIONS, async (_event, data: {
    repoPath: string;
    instructions: string;
  }) => {
    try {
      const claudetteDir = path.join(data.repoPath, '.claudette');
      await fs.mkdir(claudetteDir, { recursive: true });

      const targetPath = path.join(claudetteDir, 'worktree-setup.md');
      await fs.writeFile(targetPath, data.instructions, 'utf-8');

      return { success: true, path: targetPath };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save worktree instructions',
      };
    }
  });

  // Create a teleport session from a remote session ID
  // NOTE: The Agent SDK's resume only works with local sessions (UUIDs).
  // Web sessions (session_xxx format) need to be teleported first using:
  // 1. Open Claude Code CLI: `claude`
  // 2. Run `/teleport` and select the session
  // 3. This downloads the session to ~/.claude/projects/
  // 4. Then you can open that session in Grep
  //
  // This handler creates a placeholder session that will attempt to resume
  // when you send the first message. If the transcript doesn't exist locally,
  // you'll need to use the CLI teleport first.
  ipcMain.handle(IPC_CHANNELS.DEV_CREATE_TELEPORT_SESSION, async (_event, data: {
    sessionId: string;
    name: string;
    cwd?: string;
  }) => {
    try {
      const remoteSessionId = data.sessionId;
      const workingDir = data.cwd || process.cwd();

      console.log('[Dev] Creating teleport session reference:', remoteSessionId);

      // Check if this session already exists locally (was already teleported via CLI)
      const claudeDir = path.join(os.homedir(), '.claude', 'projects');
      const transcriptFilename = `${remoteSessionId}.jsonl`;
      let foundLocally = false;

      if (fs.existsSync(claudeDir)) {
        const projectDirs = fs.readdirSync(claudeDir);
        for (const projectDir of projectDirs) {
          const transcriptPath = path.join(claudeDir, projectDir, transcriptFilename);
          if (fs.existsSync(transcriptPath)) {
            console.log('[Dev] Found local transcript for teleported session:', transcriptPath);
            foundLocally = true;
            break;
          }
        }
      }

      if (!foundLocally) {
        console.log('[Dev] No local transcript found. User may need to run /teleport in Claude CLI first.');
      }

      // Create a Grep session that references the remote session
      const session: Session = {
        id: remoteSessionId,
        name: data.name,
        repoPath: workingDir,
        worktreePath: workingDir,
        branch: 'main',
        status: 'running',
        ports: {
          web: 3000,
          api: 8080,
          debug: 9229,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        setupScript: '',
        isDevMode: true,
        isTeleported: true,
      };

      // Store the session
      store.set(`sessions.${session.id}`, session);
      store.set(`sdkSessionMappings.${session.id}`, remoteSessionId);

      console.log('[Dev] Created teleport session:', session.id, foundLocally ? '(transcript found locally)' : '(no local transcript)');

      return session;
    } catch (error) {
      console.error('[Dev] Failed to create teleport session:', error);
      throw error;
    }
  });

  // Debug: Get registered webviews
  ipcMain.handle('dev:get-registered-webviews', async () => {
    const { browserService } = await import('../services/browser.service');
    const registered = Array.from((browserService as any).sessionWebContents.entries());
    return { success: true, webviews: registered };
  });

  // Execute worktree setup (called after worktree creation)
  ipcMain.handle(IPC_CHANNELS.DEV_EXECUTE_WORKTREE_SETUP, async (_event, data: {
    repoPath: string;
    worktreePath: string;
  }) => {
    try {
      const claudetteDir = path.join(data.repoPath, '.claudette');
      const scriptPath = path.join(claudetteDir, 'worktree-setup.sh');
      const instructionsPath = path.join(claudetteDir, 'worktree-setup.md');

      // Check which setup method exists
      const [scriptExists, instructionsExist] = await Promise.all([
        fs.access(scriptPath).then(() => true).catch(() => false),
        fs.access(instructionsPath).then(() => true).catch(() => false),
      ]);

      if (scriptExists) {
        // Execute the script in the worktree directory
        const { stdout, stderr } = await execAsync(`bash "${scriptPath}"`, {
          cwd: data.worktreePath,
          env: { ...process.env, WORKTREE_PATH: data.worktreePath, REPO_PATH: data.repoPath },
        });

        return {
          success: true,
          type: 'script',
          output: stdout,
          error: stderr || undefined,
        };
      } else if (instructionsExist) {
        // Read instructions and return them for Claude to execute
        const instructions = await fs.readFile(instructionsPath, 'utf-8');

        return {
          success: true,
          type: 'instructions',
          instructions,
        };
      } else {
        return {
          success: true,
          type: 'none',
          message: 'No worktree setup configured',
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to execute worktree setup',
      };
    }
  });
}
