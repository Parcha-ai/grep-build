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
 * Get the last N path segments from a path (truncate from left)
 * e.g., "/home/ubuntu/dev/parcha/grep3" with 2 segments -> "parcha/grep3"
 */
function getPathTail(path: string, segments: number = 2): string {
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= segments) {
    return parts.join('/');
  }
  return parts.slice(-segments).join('/');
}

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
        // Use host:parent/folder format for name if no custom name provided
        const folderPath = getPathTail(data.sshConfig.remoteWorkdir, 2);
        const defaultName = `${data.sshConfig.host}:${folderPath}`;
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
                // Update session name to show host and last 2 path segments
                // Format: "host:parent/folder" e.g. "greppy2:parcha/grep3"
                const folderPath = getPathTail(setupResult.workingDirectory, 2);
                session.name = `${data.sshConfig.host}:${folderPath}`;
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

  /**
   * Check if a persistent tmux session exists on the remote
   */
  ipcMain.handle(
    IPC_CHANNELS.SSH_CHECK_PERSISTENT_SESSION,
    async (_event, data: { sessionId: string; config: SSHConfig }) => {
      console.log('[SSH IPC] Checking persistent session for', data.sessionId);
      try {
        const result = await sshService.checkPersistentSession(data.sessionId, data.config);
        return result;
      } catch (error) {
        console.error('[SSH IPC] Failed to check persistent session:', error);
        return null;
      }
    }
  );

  /**
   * Kill a persistent tmux session on the remote
   */
  ipcMain.handle(
    IPC_CHANNELS.SSH_KILL_PERSISTENT_SESSION,
    async (_event, data: { sessionId: string; config: SSHConfig }) => {
      console.log('[SSH IPC] Killing persistent session for', data.sessionId);
      try {
        const result = await sshService.killPersistentSession(data.sessionId, data.config);
        return result;
      } catch (error) {
        console.error('[SSH IPC] Failed to kill persistent session:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * Check if SSH connection is available (quick ping)
   */
  ipcMain.handle(
    IPC_CHANNELS.SSH_CHECK_CONNECTION,
    async (_event, config: SSHConfig) => {
      console.log('[SSH IPC] Checking connection to', config.host);
      try {
        const result = await sshService.testConnection(config);
        return { connected: result.success, error: result.error };
      } catch (error) {
        return {
          connected: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * Teleport a local session to an SSH remote
   * Copies transcript files so Claude can resume with full context
   *
   * Order of operations:
   * 1. Run worktree script FIRST to get final working directory
   * 2. Copy transcripts to the FINAL working directory's project folder
   * 3. Create session pointing to the final directory
   */
  ipcMain.handle(
    IPC_CHANNELS.SSH_TELEPORT_SESSION,
    async (
      _event,
      data: {
        sourceSessionId: string;
        destinationConfig: SSHConfig;
      }
    ) => {
      console.log('[SSH IPC] Teleporting session', data.sourceSessionId, 'to', data.destinationConfig.host);

      try {
        // Get source session from store
        const sessions = sessionStore.get('sessions') || {};
        const sourceSession = sessions[data.sourceSessionId] as Session | undefined;

        if (!sourceSession) {
          return { success: false, error: 'Source session not found' };
        }

        if (sourceSession.sshConfig) {
          return { success: false, error: 'Cannot teleport an SSH session (already remote)' };
        }

        // Send progress updates
        const sendProgress = (message: string) => {
          sendSetupProgress(data.sourceSessionId, 'running', message);
        };

        // Create new SSH session ID
        const newSessionId = uuid();
        let finalWorkdir = data.destinationConfig.remoteWorkdir;
        let setupOutput: string | undefined;

        // STEP 1: Run pre-session setup FIRST to get the final working directory
        // This must happen before copying transcripts so we copy to the right place
        if (data.destinationConfig.worktreeScript || data.destinationConfig.syncSettings !== false) {
          sendProgress('Running pre-session setup...');

          // Connect for setup
          await sshService.connect(newSessionId, data.destinationConfig);

          const setupResult = await sshService.runPreSessionSetup(
            newSessionId,
            data.destinationConfig,
            (message) => {
              console.log('[SSH IPC] Teleport setup progress:', message);
              sendProgress(message);
            }
          );

          if (!setupResult.success) {
            console.error('[SSH IPC] Pre-session setup failed:', setupResult.error);
            sendSetupProgress(data.sourceSessionId, 'error', undefined, undefined, setupResult.error);
            return { success: false, error: setupResult.error };
          }

          // Update working directory if script output one
          if (setupResult.workingDirectory) {
            console.log('[SSH IPC] Final working directory from setup:', setupResult.workingDirectory);
            finalWorkdir = setupResult.workingDirectory;
          }

          setupOutput = setupResult.setupOutput;
        }

        // STEP 2: Now copy transcripts to the FINAL working directory
        // Create a modified config with the final workdir for transcript placement
        const teleportConfig: SSHConfig = {
          ...data.destinationConfig,
          remoteWorkdir: finalWorkdir,
          // Don't sync settings again - we already did it above
          syncSettings: false,
        };

        sendProgress('Copying session transcripts...');
        const result = await sshService.teleportSession(
          sourceSession.worktreePath,
          sourceSession.sdkSessionId,
          teleportConfig,
          sendProgress
        );

        if (!result.success) {
          sendSetupProgress(data.sourceSessionId, 'error', undefined, undefined, result.error);
          return result;
        }

        // STEP 3: Create the session record
        const folderPath = getPathTail(finalWorkdir, 2);

        const newSession: Session = {
          id: newSessionId,
          name: `${data.destinationConfig.host}:${folderPath}`,
          repoPath: finalWorkdir,
          worktreePath: finalWorkdir,
          branch: sourceSession.branch || 'main',
          sshConfig: {
            ...data.destinationConfig,
            remoteWorkdir: finalWorkdir, // Use the final workdir from setup script
          },
          status: 'stopped', // Ready to start
          ports: { web: 0, api: 0, debug: 0 },
          createdAt: new Date(),
          updatedAt: new Date(),
          setupScript: '',
          setupOutput,
          isDevMode: true,
          // Preserve SDK session ID so Claude can find the transcript
          sdkSessionId: sourceSession.sdkSessionId,
          // Track teleportation origin
          teleportedFrom: data.sourceSessionId,
        };

        // Save new session
        sessions[newSessionId] = newSession;
        sessionStore.set('sessions', sessions);

        sendSetupProgress(data.sourceSessionId, 'completed', 'Teleportation complete!');

        console.log('[SSH IPC] Teleported session created:', newSessionId);
        return {
          success: true,
          newSessionId,
        };
      } catch (error) {
        console.error('[SSH IPC] Teleport failed:', error);
        sendSetupProgress(data.sourceSessionId, 'error', undefined, undefined, error instanceof Error ? error.message : 'Unknown error');
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );
}
