import { IpcMain, BrowserWindow } from 'electron';
import { v4 as uuid } from 'uuid';
import Store from 'electron-store';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import { sshService } from '../services/ssh.service';
import type { SSHConfig, Session, SavedSSHConfig } from '../../shared/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sessionStore: any = new Store({ name: 'claudette-sessions' });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const settingsStore: any = new Store({ name: 'claudette-settings' });

/**
 * Send setup progress to all renderer windows
 */
function sendSetupProgress(sessionId: string, status: 'running' | 'completed' | 'error', message?: string, output?: string, error?: string): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send(IPC_CHANNELS.SSH_SETUP_PROGRESS, { sessionId, status, message, output, error });
  }
}

export function registerSSHHandlers(ipcMain: IpcMain): void {
  /**
   * Test an SSH connection and verify Claude Code is installed
   */
  ipcMain.handle(
    IPC_CHANNELS.SSH_TEST_CONNECTION,
    async (_event, config: SSHConfig) => {
      console.log('[SSH IPC] Testing connection to', config.host);

      try {
        const result = await sshService.testConnection(config);
        console.log('[SSH IPC] Connection test result:', result);
        return result;
      } catch (error) {
        console.error('[SSH IPC] Connection test error:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * Create a new SSH session
   */
  ipcMain.handle(
    IPC_CHANNELS.SSH_CREATE_SESSION,
    async (
      _event,
      data: {
        name: string;
        sshConfig: SSHConfig;
      }
    ) => {
      console.log('[SSH IPC] Creating SSH session:', data.name);

      try {
        const sessionId = uuid();

        // Create session object
        // Use host:folder format for name if no custom name provided
        const folderName = data.sshConfig.remoteWorkdir.split('/').filter(Boolean).pop() || data.sshConfig.remoteWorkdir;
        const defaultName = `${data.sshConfig.host}:${folderName}`;
        const session: Session = {
          id: sessionId,
          name: data.name || defaultName,
          repoPath: data.sshConfig.remoteWorkdir, // Remote path
          worktreePath: data.sshConfig.remoteWorkdir,
          branch: 'main', // We could detect this via SSH if needed
          sshConfig: data.sshConfig,
          status: 'creating',
          ports: { web: 0, api: 0, debug: 0 },
          createdAt: new Date(),
          updatedAt: new Date(),
          setupScript: '',
          isDevMode: true, // Mark as dev mode (no Docker)
        };

        // Establish the SSH connection
        try {
          sendSetupProgress(sessionId, 'running', 'Connecting to remote host...');
          await sshService.connect(sessionId, data.sshConfig);
          sendSetupProgress(sessionId, 'running', 'Connected to remote host');

          // Run pre-session setup (worktree script + settings sync)
          if (data.sshConfig.worktreeScript || data.sshConfig.syncSettings !== false) {
            console.log('[SSH IPC] Running pre-session setup...');
            const setupResult = await sshService.runPreSessionSetup(
              sessionId,
              data.sshConfig,
              (message) => {
                console.log('[SSH IPC] Setup progress:', message);
                sendSetupProgress(sessionId, 'running', undefined, message);
              }
            );

            if (!setupResult.success) {
              console.error('[SSH IPC] Pre-session setup failed:', setupResult.error);
              session.status = 'error';
              session.errorMessage = setupResult.error;
              sendSetupProgress(sessionId, 'error', undefined, undefined, setupResult.error);
            } else {
              // Update the working directory if the script output one
              if (setupResult.workingDirectory) {
                console.log('[SSH IPC] Updating session worktreePath to:', setupResult.workingDirectory);
                session.worktreePath = setupResult.workingDirectory;
                session.repoPath = setupResult.workingDirectory;
                // Also update the SSH config so Claude uses the correct directory
                if (session.sshConfig) {
                  session.sshConfig.remoteWorkdir = setupResult.workingDirectory;
                }
                // Update session name to show host and folder name only
                // Format: "host:folder" e.g. "greppy2:grep3" (not the full path)
                const folderName = setupResult.workingDirectory.split('/').filter(Boolean).pop() || setupResult.workingDirectory;
                session.name = `${data.sshConfig.host}:${folderName}`;
              }
              // Store the setup output for context in system prompt
              if (setupResult.setupOutput) {
                session.setupOutput = setupResult.setupOutput;
              }
              session.status = 'running';
              sendSetupProgress(sessionId, 'completed', 'Setup completed successfully');
            }
          } else {
            session.status = 'running';
            sendSetupProgress(sessionId, 'completed', 'Connected');
          }
        } catch (connError) {
          console.error('[SSH IPC] Failed to establish SSH connection:', connError);
          session.status = 'error';
          session.errorMessage = connError instanceof Error ? connError.message : 'Connection failed';
          sendSetupProgress(sessionId, 'error', undefined, undefined, session.errorMessage);
        }

        // Save session
        const sessions = sessionStore.get('sessions') || {};
        sessions[sessionId] = session;
        sessionStore.set('sessions', sessions);

        console.log('[SSH IPC] SSH session created:', sessionId);
        return session;
      } catch (error) {
        console.error('[SSH IPC] Failed to create SSH session:', error);
        throw error;
      }
    }
  );

  /**
   * Manually sync settings to an SSH session
   */
  ipcMain.handle(
    IPC_CHANNELS.SSH_SYNC_SETTINGS,
    async (_event, data: { sessionId: string; config: SSHConfig }) => {
      console.log('[SSH IPC] Syncing settings to', data.config.host);
      return sshService.syncSettings(data.sessionId, data.config);
    }
  );

  /**
   * Run a worktree script on a remote machine
   */
  ipcMain.handle(
    IPC_CHANNELS.SSH_RUN_WORKTREE_SCRIPT,
    async (
      _event,
      data: { sessionId: string; config: SSHConfig; script: string }
    ) => {
      console.log('[SSH IPC] Running worktree script on', data.config.host);
      return sshService.runWorktreeScript(data.sessionId, data.config, data.script);
    }
  );

  /**
   * Get saved SSH configuration
   */
  ipcMain.handle(
    IPC_CHANNELS.SSH_GET_SAVED_CONFIG,
    async () => {
      return settingsStore.get('lastSSHConfig') as SavedSSHConfig | null;
    }
  );

  /**
   * Save SSH configuration
   */
  ipcMain.handle(
    IPC_CHANNELS.SSH_SAVE_CONFIG,
    async (_event, config: SavedSSHConfig) => {
      settingsStore.set('lastSSHConfig', config);
    }
  );
}
