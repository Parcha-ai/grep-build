import { Client, ClientChannel } from 'ssh2';
import { Readable, Writable, PassThrough } from 'stream';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import type { SSHConfig } from '../../shared/types';

/**
 * Interface matching the Claude Agent SDK's SpawnedProcess
 * Used to wrap SSH exec channels for remote Claude Code execution
 */
export interface SpawnedProcess {
  stdin: Writable;
  stdout: Readable;
  readonly killed: boolean;
  readonly exitCode: number | null;
  kill(signal: NodeJS.Signals): boolean;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  once(event: 'error', listener: (error: Error) => void): void;
  off(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  off(event: 'error', listener: (error: Error) => void): void;
}

/**
 * SDK's spawn options passed to spawnClaudeCodeProcess hook
 */
export interface SDKSpawnOptions {
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string | undefined>;
  signal: AbortSignal;
}

/**
 * Wraps an SSH exec channel to satisfy the SpawnedProcess interface
 */
class RemoteSpawnedProcess extends EventEmitter implements SpawnedProcess {
  public stdin: Writable;
  public stdout: Readable;
  private _killed = false;
  private _exitCode: number | null = null;
  private channel: ClientChannel;

  constructor(channel: ClientChannel) {
    super();
    this.channel = channel;

    // Create pass-through streams for stdin/stdout
    this.stdin = channel.stdin;
    this.stdout = channel;

    // Handle channel close/exit
    channel.on('close', (code: number, signal: string | undefined) => {
      this._exitCode = code;
      this.emit('exit', code, signal as NodeJS.Signals | null);
    });

    channel.on('exit', (code: number, signal: string | undefined) => {
      this._exitCode = code;
      this.emit('exit', code, signal as NodeJS.Signals | null);
    });

    channel.on('error', (err: Error) => {
      this.emit('error', err);
    });
  }

  get killed(): boolean {
    return this._killed;
  }

  get exitCode(): number | null {
    return this._exitCode;
  }

  kill(signal: NodeJS.Signals): boolean {
    if (this._killed) return false;

    try {
      // SSH doesn't support signals directly, but we can close the channel
      // which will terminate the remote process
      this.channel.signal(signal === 'SIGKILL' ? 'KILL' : 'TERM');
      this._killed = true;
      return true;
    } catch {
      // If signal fails, try closing the channel
      try {
        this.channel.close();
        this._killed = true;
        return true;
      } catch {
        return false;
      }
    }
  }

}

export interface SSHConnectionTestResult {
  success: boolean;
  error?: string;
  claudeCodeVersion?: string;
  hostname?: string;
}

export interface SSHConnectionInfo {
  client: Client;
  config: SSHConfig;
}

/**
 * Service for managing SSH connections and remote process execution
 */
export class SSHService {
  private connections: Map<string, SSHConnectionInfo> = new Map();
  private connectionTimeout = 30000; // 30 seconds

  /**
   * Test an SSH connection and verify Claude Code is installed on the remote
   */
  async testConnection(config: SSHConfig): Promise<SSHConnectionTestResult> {
    const client = new Client();

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        client.end();
        resolve({ success: false, error: 'Connection timeout after 30 seconds' });
      }, this.connectionTimeout);

      client.on('ready', async () => {
        clearTimeout(timeout);

        try {
          // Test by checking Claude Code version
          // Check common installation paths since non-interactive SSH doesn't load shell profile
          const versionResult = await this.execCommand(
            client,
            'export PATH="$HOME/.local/bin:$HOME/.nvm/versions/node/*/bin:/usr/local/bin:$PATH" && claude --version 2>/dev/null || echo "NOT_FOUND"'
          );

          if (versionResult.includes('NOT_FOUND') || !versionResult.trim()) {
            client.end();
            resolve({
              success: false,
              error: 'Claude Code CLI is not installed on the remote machine. Install it with: npm install -g @anthropic-ai/claude-code',
            });
            return;
          }

          // Get hostname for display
          const hostnameResult = await this.execCommand(client, 'hostname');
          const hostname = hostnameResult.trim();

          client.end();
          resolve({
            success: true,
            claudeCodeVersion: versionResult.trim(),
            hostname,
          });
        } catch (error) {
          client.end();
          resolve({
            success: false,
            error: `Failed to verify Claude Code: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      });

      client.on('error', (err) => {
        clearTimeout(timeout);
        let errorMessage = err.message;

        // Provide more helpful error messages
        if (err.message.includes('authentication')) {
          errorMessage = 'Authentication failed. Check your username and private key.';
        } else if (err.message.includes('ECONNREFUSED')) {
          errorMessage = `Connection refused. Is SSH running on ${config.host}:${config.port}?`;
        } else if (err.message.includes('ENOTFOUND')) {
          errorMessage = `Host not found: ${config.host}`;
        } else if (err.message.includes('ETIMEDOUT')) {
          errorMessage = `Connection timed out. Check if ${config.host} is reachable.`;
        }

        resolve({ success: false, error: errorMessage });
      });

      // Read private key
      let privateKey: Buffer;
      try {
        privateKey = fs.readFileSync(config.privateKeyPath);
      } catch (error) {
        resolve({
          success: false,
          error: `Cannot read private key: ${config.privateKeyPath}`,
        });
        return;
      }

      // Connect
      client.connect({
        host: config.host,
        port: config.port || 22,
        username: config.username,
        privateKey,
        passphrase: config.passphrase,
        readyTimeout: this.connectionTimeout,
      });
    });
  }

  /**
   * Execute a command on the remote and return stdout
   */
  private execCommand(client: Client, command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      client.exec(command, (err, channel) => {
        if (err) {
          reject(err);
          return;
        }

        let stdout = '';
        let stderr = '';

        channel.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        channel.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        channel.on('close', (code: number) => {
          if (code !== 0 && stderr) {
            reject(new Error(stderr));
          } else {
            resolve(stdout);
          }
        });
      });
    });
  }

  /**
   * Create a persistent connection for a session
   */
  async connect(sessionId: string, config: SSHConfig): Promise<void> {
    // Close existing connection if any
    this.disconnect(sessionId);

    const client = new Client();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.end();
        reject(new Error('Connection timeout'));
      }, this.connectionTimeout);

      client.on('ready', () => {
        clearTimeout(timeout);
        this.connections.set(sessionId, { client, config });
        console.log(`[SSH Service] Connected to ${config.host} for session ${sessionId}`);
        resolve();
      });

      client.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      client.on('close', () => {
        this.connections.delete(sessionId);
        console.log(`[SSH Service] Connection closed for session ${sessionId}`);
      });

      // Read private key
      let privateKey: Buffer;
      try {
        privateKey = fs.readFileSync(config.privateKeyPath);
      } catch (error) {
        reject(new Error(`Cannot read private key: ${config.privateKeyPath}`));
        return;
      }

      client.connect({
        host: config.host,
        port: config.port || 22,
        username: config.username,
        privateKey,
        passphrase: config.passphrase,
        readyTimeout: this.connectionTimeout,
        keepaliveInterval: 10000, // Keep connection alive
        keepaliveCountMax: 3,
      });
    });
  }

  /**
   * Get or create a connection for a session
   */
  private async getConnection(sessionId: string, config: SSHConfig): Promise<Client> {
    const existing = this.connections.get(sessionId);
    if (existing) {
      return existing.client;
    }

    await this.connect(sessionId, config);
    const conn = this.connections.get(sessionId);
    if (!conn) {
      throw new Error('Failed to establish connection');
    }
    return conn.client;
  }

  /**
   * Create a remote process that satisfies SpawnedProcess interface
   * Used by Claude Agent SDK's spawnClaudeCodeProcess hook
   */
  createRemoteProcess(
    sessionId: string,
    config: SSHConfig,
    sdkOptions: SDKSpawnOptions
  ): SpawnedProcess {
    // Create a deferred connection process
    // We need to return synchronously but establish connection async
    const passThrough = {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
    };

    let channel: ClientChannel | null = null;
    let killed = false;
    let exitCode: number | null = null;
    const emitter = new EventEmitter();

    // Build environment exports - only include essential variables for Claude
    // We explicitly whitelist rather than blacklist to avoid sending local machine paths/configs
    const includeVars = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_ENTRYPOINT', 'TERM', 'LANG'];
    const envExports = Object.entries(sdkOptions.env)
      .filter(([key, value]) => value !== undefined && includeVars.includes(key))
      .map(([key, value]) => `export ${key}="${value?.replace(/"/g, '\\"')}"`)
      .join('; ');

    // Build the command using the SDK's args
    // The SDK passes args like: ["/path/to/cli.js", "--output-format", "stream-json", "--verbose", ...]
    // The first arg may be the local path to the CLI file - we need to filter it out
    // because we'll use the globally installed 'claude' command on the remote machine
    const filteredArgs = sdkOptions.args.filter(arg => {
      // Filter out local paths to the CLI file
      if (arg.includes('claude-agent-sdk') || arg.includes('cli.js') || arg.includes('node_modules')) {
        console.log('[SSH Service] Filtering out local CLI path from args:', arg);
        return false;
      }
      return true;
    });

    // Escape args properly for shell execution
    const escapedArgs = filteredArgs.map(arg => {
      // If arg contains special characters, quote it
      if (arg.includes(' ') || arg.includes('"') || arg.includes("'") || arg.includes('{')) {
        return `'${arg.replace(/'/g, "'\\''")}'`;
      }
      return arg;
    }).join(' ');

    // Use absolute path to claude since ssh2 exec doesn't load shell profiles
    // Common locations: ~/.local/bin (curl installer), /usr/local/bin (npm -g)
    const claudePaths = `/home/${config.username}/.local/bin:/home/${config.username}/bin:/usr/local/bin`;
    const command = `export PATH="${claudePaths}:$PATH" && cd "${config.remoteWorkdir}" && ${envExports}; exec claude ${escapedArgs}`;

    console.log('[SSH Service] Config:', JSON.stringify(config, null, 2));
    console.log('[SSH Service] SDK args (original):', sdkOptions.args);
    console.log('[SSH Service] SDK args (filtered):', filteredArgs);
    console.log('[SSH Service] Remote command:', command);

    // Handle abort signal from SDK
    const abortHandler = () => {
      console.log('[SSH Service] Abort signal received, killing remote process');
      killed = true;
      if (channel) {
        try {
          channel.signal('TERM');
          channel.close();
        } catch (e) {
          console.error('[SSH Service] Error closing channel on abort:', e);
        }
      }
    };
    sdkOptions.signal.addEventListener('abort', abortHandler);

    // Buffer to store data written before channel is ready
    const pendingData: Buffer[] = [];
    let stdinEnded = false;
    let channelReady = false;

    // Set up buffering for data written before channel is ready
    passThrough.stdin.on('data', (data: Buffer) => {
      if (channelReady && channel) {
        console.log('[SSH Service] Sending to remote (direct):', data.toString().substring(0, 100));
        channel.stdin.write(data);
      } else {
        console.log('[SSH Service] Buffering data (channel not ready):', data.toString().substring(0, 100));
        pendingData.push(data);
      }
    });

    passThrough.stdin.on('end', () => {
      console.log('[SSH Service] stdin ended, channelReady:', channelReady);
      stdinEnded = true;
      if (channelReady && channel) {
        console.log('[SSH Service] Ending channel stdin');
        channel.stdin.end();
      }
    });

    // Establish connection and create channel asynchronously
    (async () => {
      try {
        const client = await this.getConnection(sessionId, config);

        client.exec(command, { pty: false }, (err, ch) => {
          if (err) {
            emitter.emit('error', err);
            passThrough.stdout.end();
            sdkOptions.signal.removeEventListener('abort', abortHandler);
            return;
          }

          channel = ch;
          channelReady = true;
          console.log('[SSH Service] Channel opened, flushing', pendingData.length, 'buffered chunks');

          // Flush any buffered data
          for (const data of pendingData) {
            console.log('[SSH Service] Flushing buffered data:', data.toString().substring(0, 100));
            ch.stdin.write(data);
          }
          pendingData.length = 0; // Clear the buffer

          // If stdin already ended, end the channel stdin too
          if (stdinEnded) {
            console.log('[SSH Service] stdin already ended, ending channel stdin');
            ch.stdin.end();
          }

          // Log channel events for debugging
          ch.on('end', () => {
            console.log('[SSH Service] Channel ended');
          });

          // Pipe channel output to stdout
          ch.on('data', (data: Buffer) => {
            console.log('[SSH Service] Received from remote:', data.toString().substring(0, 200));
            passThrough.stdout.write(data);
          });

          ch.stderr.on('data', (data: Buffer) => {
            // Emit stderr through stdout (Claude Code uses both)
            console.log('[SSH Service] Received stderr:', data.toString().substring(0, 200));
            passThrough.stdout.write(data);
          });

          ch.on('close', (code: number, signal: string) => {
            exitCode = code;
            emitter.emit('exit', code, signal as NodeJS.Signals | null);
            passThrough.stdout.end();
            sdkOptions.signal.removeEventListener('abort', abortHandler);
          });

          ch.on('exit', (code: number, signal: string) => {
            exitCode = code;
            emitter.emit('exit', code, signal as NodeJS.Signals | null);
          });

          ch.on('error', (error: Error) => {
            emitter.emit('error', error);
          });
        });
      } catch (error) {
        emitter.emit('error', error instanceof Error ? error : new Error(String(error)));
        passThrough.stdout.end();
        sdkOptions.signal.removeEventListener('abort', abortHandler);
      }
    })();

    // Return SpawnedProcess-compatible object
    // Use type assertion since the object satisfies the interface structurally
    return {
      stdin: passThrough.stdin,
      stdout: passThrough.stdout,
      get killed() {
        return killed;
      },
      get exitCode() {
        return exitCode;
      },
      kill(signal: NodeJS.Signals): boolean {
        if (killed) return false;
        killed = true;
        if (channel) {
          try {
            channel.signal(signal === 'SIGKILL' ? 'KILL' : 'TERM');
            return true;
          } catch {
            try {
              channel.close();
              return true;
            } catch {
              return false;
            }
          }
        }
        return false;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      on(event: string, listener: (...args: any[]) => void) {
        emitter.on(event, listener);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      once(event: string, listener: (...args: any[]) => void) {
        emitter.once(event, listener);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      off(event: string, listener: (...args: any[]) => void) {
        emitter.off(event, listener);
      },
    } as SpawnedProcess;
  }

  /**
   * Create an interactive shell for terminal use
   */
  async createShell(
    sessionId: string,
    config: SSHConfig
  ): Promise<ClientChannel> {
    const client = await this.getConnection(sessionId, config);

    return new Promise((resolve, reject) => {
      client.shell(
        {
          term: 'xterm-256color',
          cols: 80,
          rows: 24,
        },
        (err, channel) => {
          if (err) {
            reject(err);
            return;
          }

          // Change to remote workdir
          channel.write(`cd "${config.remoteWorkdir}" && clear\n`);
          resolve(channel);
        }
      );
    });
  }

  /**
   * Resize a shell channel
   */
  resizeShell(channel: ClientChannel, cols: number, rows: number): void {
    try {
      channel.setWindow(rows, cols, 0, 0);
    } catch (error) {
      console.error('[SSH Service] Failed to resize shell:', error);
    }
  }

  /**
   * Disconnect a session's SSH connection
   */
  disconnect(sessionId: string): void {
    const conn = this.connections.get(sessionId);
    if (conn) {
      try {
        conn.client.end();
      } catch (error) {
        console.error('[SSH Service] Error disconnecting:', error);
      }
      this.connections.delete(sessionId);
    }
  }

  /**
   * Check if a session has an active SSH connection
   */
  isConnected(sessionId: string): boolean {
    return this.connections.has(sessionId);
  }

  /**
   * Disconnect all sessions
   */
  disconnectAll(): void {
    for (const sessionId of this.connections.keys()) {
      this.disconnect(sessionId);
    }
  }

  /**
   * Get GitHub token from gh CLI (handles keychain storage)
   */
  private async getGitHubToken(): Promise<string | null> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      // gh auth token extracts the token regardless of storage method
      const { stdout } = await execAsync('gh auth token');
      return stdout.trim();
    } catch (error) {
      console.log('[SSH Service] Could not get GitHub token:', error);
      return null;
    }
  }

  /**
   * Get GitHub username from gh CLI
   */
  private async getGitHubUser(): Promise<string | null> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      const { stdout } = await execAsync('gh api user --jq .login');
      return stdout.trim();
    } catch (error) {
      console.log('[SSH Service] Could not get GitHub user:', error);
      return null;
    }
  }

  /**
   * Sync local Claude settings to remote machine via SFTP
   * Syncs: ~/.claude/agents/, ~/.claude/commands/, ~/.claude/CLAUDE.md, ~/.claude/settings.json
   * Also syncs GitHub credentials for git/gh operations
   */
  async syncSettings(sessionId: string, config: SSHConfig): Promise<{ success: boolean; error?: string }> {
    const os = await import('os');
    const path = await import('path');
    const fsPromises = await import('fs/promises');

    const homeDir = os.homedir();
    const claudeDir = path.join(homeDir, '.claude');

    // Check if local .claude directory exists
    try {
      await fsPromises.access(claudeDir);
    } catch {
      console.log('[SSH Service] No local ~/.claude directory, skipping sync');
      return { success: true }; // Nothing to sync, but not an error
    }

    let sftp: import('ssh2').SFTPWrapper | null = null;

    try {
      const client = await this.getConnection(sessionId, config);

      // Create SFTP session
      sftp = await new Promise<import('ssh2').SFTPWrapper>((resolve, reject) => {
        client.sftp((err, sftpSession) => {
          if (err) reject(err);
          else resolve(sftpSession);
        });
      });

      // Ensure remote directories exist
      console.log('[SSH Service] Creating remote directories...');
      await this.execCommand(client, 'mkdir -p ~/.claude/agents ~/.claude/commands ~/.config/gh');

      // Get GitHub token and create hosts.yml for remote
      const ghToken = await this.getGitHubToken();
      const ghUser = await this.getGitHubUser();
      let tempGhHostsPath: string | null = null;

      if (ghToken && ghUser) {
        console.log('[SSH Service] Creating GitHub hosts.yml for remote...');
        // Create a hosts.yml with the token embedded (for Linux remote without keychain)
        const hostsYml = `github.com:
    git_protocol: https
    user: ${ghUser}
    oauth_token: ${ghToken}
`;
        // Write to temp file
        const tmpDir = os.tmpdir();
        tempGhHostsPath = path.join(tmpDir, `gh-hosts-${sessionId}.yml`);
        await fsPromises.writeFile(tempGhHostsPath, hostsYml, { mode: 0o600 });
      }

      // Files/directories to sync
      const itemsToSync: Array<{ local: string; remote: string; isDir: boolean }> = [
        { local: path.join(claudeDir, 'agents'), remote: '.claude/agents', isDir: true },
        { local: path.join(claudeDir, 'commands'), remote: '.claude/commands', isDir: true },
        { local: path.join(claudeDir, 'CLAUDE.md'), remote: '.claude/CLAUDE.md', isDir: false },
        { local: path.join(claudeDir, 'settings.json'), remote: '.claude/settings.json', isDir: false },
        // Git config for identity
        { local: path.join(homeDir, '.gitconfig'), remote: '.gitconfig', isDir: false },
      ];

      // Add GitHub hosts.yml - use temp file with embedded token if available, otherwise original
      if (tempGhHostsPath) {
        itemsToSync.push({ local: tempGhHostsPath, remote: '.config/gh/hosts.yml', isDir: false });
      } else {
        itemsToSync.push({ local: path.join(homeDir, '.config', 'gh', 'hosts.yml'), remote: '.config/gh/hosts.yml', isDir: false });
      }
      // Always sync gh config.yml
      itemsToSync.push({ local: path.join(homeDir, '.config', 'gh', 'config.yml'), remote: '.config/gh/config.yml', isDir: false });

      // Helper to upload a file via SFTP
      const uploadFile = (localPath: string, remotePath: string): Promise<void> => {
        return new Promise((resolve, reject) => {
          sftp!.fastPut(localPath, remotePath, (err) => {
            if (err) {
              console.error(`[SSH Service] Failed to upload ${localPath}:`, err.message);
              reject(err);
            } else {
              resolve();
            }
          });
        });
      };

      // Helper to recursively upload a directory
      const uploadDir = async (localDir: string, remoteDir: string): Promise<void> => {
        // Ensure remote dir exists
        await new Promise<void>((resolve) => {
          sftp!.mkdir(remoteDir, () => resolve()); // Ignore error if exists
        });

        let entries;
        try {
          entries = await fsPromises.readdir(localDir, { withFileTypes: true });
        } catch (e) {
          console.log(`[SSH Service] Cannot read directory ${localDir}, skipping`);
          return;
        }

        for (const entry of entries) {
          const localPath = path.join(localDir, entry.name);
          const remotePath = `${remoteDir}/${entry.name}`;

          try {
            if (entry.isDirectory()) {
              await uploadDir(localPath, remotePath);
            } else if (entry.isFile()) {
              console.log(`[SSH Service] Uploading ${localPath} -> ${remotePath}`);
              await uploadFile(localPath, remotePath);
            }
          } catch (e) {
            console.error(`[SSH Service] Failed to sync ${localPath}:`, e);
            // Continue with other files
          }
        }
      };

      // Get remote home directory
      const homeResult = await this.execCommand(client, 'echo $HOME');
      const remoteHome = homeResult.trim();

      // Sync each item
      for (const item of itemsToSync) {
        try {
          const stat = await fsPromises.stat(item.local);
          const remotePath = `${remoteHome}/${item.remote}`;

          if (item.isDir && stat.isDirectory()) {
            console.log(`[SSH Service] Syncing directory ${item.local} -> ${remotePath}`);
            await uploadDir(item.local, remotePath);
          } else if (!item.isDir && stat.isFile()) {
            console.log(`[SSH Service] Syncing file ${item.local} -> ${remotePath}`);
            await uploadFile(item.local, remotePath);
          }
        } catch (e) {
          // File/dir doesn't exist locally, skip
          console.log(`[SSH Service] Skipping ${item.local} (does not exist or error)`);
        }
      }

      // Configure git to use gh as credential helper on remote
      if (ghToken) {
        console.log('[SSH Service] Configuring git credential helper on remote...');
        try {
          await this.execCommand(client, 'git config --global credential.helper "!gh auth git-credential"');
        } catch (e) {
          console.log('[SSH Service] Could not configure git credential helper (gh may not be installed on remote)');
        }
      }

      // Clean up temp file
      if (tempGhHostsPath) {
        try {
          await fsPromises.unlink(tempGhHostsPath);
        } catch (e) {
          // Ignore cleanup errors
        }
      }

      console.log('[SSH Service] Settings sync completed successfully');
      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[SSH Service] Settings sync failed:', errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      // Always close SFTP session
      if (sftp) {
        try {
          sftp.end();
        } catch (e) {
          // Ignore close errors
        }
      }
    }
  }

  /**
   * Run a worktree setup script on the remote machine
   */
  async runWorktreeScript(
    sessionId: string,
    config: SSHConfig,
    script: string,
    onOutput?: (data: string) => void
  ): Promise<{ success: boolean; error?: string; output: string; workingDirectory?: string }> {
    try {
      const client = await this.getConnection(sessionId, config);

      return new Promise((resolve) => {
        // Run the script from HOME directory - the script is responsible for setting up the workdir
        // (e.g., creating a git worktree, cloning a repo, etc.)
        // We capture the LAST LINE of the script's stdout as the working directory
        // Convention: worktree scripts should output the target directory path as their last line
        // Source shell config files to get PATH set up properly for non-interactive SSH
        // Try multiple files since different systems use different configs
        const sourceCmd = `source ~/.bash_profile 2>/dev/null; source ~/.profile 2>/dev/null; source ~/.bashrc 2>/dev/null; true`;
        // Run script, then echo marker to separate script output from working directory
        // The working directory is captured BEFORE the marker by looking at the last line of script output
        const command = `${sourceCmd}; cd ~ && ${script} && echo "___WORKDIR_END___"`;
        console.log('[SSH Service] Running worktree script:', command);

        client.exec(command, (err, channel) => {
          if (err) {
            resolve({ success: false, error: err.message, output: '' });
            return;
          }

          let stdout = '';
          let stderr = '';

          channel.on('data', (data: Buffer) => {
            const str = data.toString();
            stdout += str;
            if (onOutput) onOutput(str);
          });

          channel.stderr.on('data', (data: Buffer) => {
            const str = data.toString();
            stderr += str;
            if (onOutput) onOutput(str);
          });

          channel.on('close', (code: number) => {
            const output = stdout + (stderr ? `\n--- stderr ---\n${stderr}` : '');
            if (code !== 0) {
              // Include stderr in error message for better debugging
              const errorDetail = stderr.trim() || stdout.trim() || 'No output';
              resolve({
                success: false,
                error: `Script exited with code ${code}: ${errorDetail}`,
                output,
              });
            } else {
              // Extract the working directory from the output (last non-empty line BEFORE the marker)
              // Convention: worktree scripts output the target directory path as their last line
              let workingDirectory: string | undefined;
              const markerIndex = stdout.indexOf('___WORKDIR_END___');
              if (markerIndex !== -1) {
                // Get everything before the marker
                const beforeMarker = stdout.substring(0, markerIndex).trim();
                // Split into lines, filter out empty lines and ANSI color codes
                const lines = beforeMarker.split('\n')
                  .map(l => l.replace(/\x1b\[[0-9;]*m/g, '').trim()) // Strip ANSI codes
                  .filter(l => l.length > 0);
                if (lines.length > 0) {
                  // Get the last line - should be the working directory path
                  workingDirectory = lines[lines.length - 1];
                  console.log('[SSH Service] Captured working directory from script:', workingDirectory);
                }
              }
              console.log('[SSH Service] Worktree script completed successfully');
              resolve({ success: true, output, workingDirectory });
            }
          });
        });
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMsg, output: '' };
    }
  }

  /**
   * Run pre-session setup: worktree script (if provided) and settings sync (if enabled)
   * Returns the working directory if the worktree script outputs one (via pwd at end)
   */
  async runPreSessionSetup(
    sessionId: string,
    config: SSHConfig,
    onProgress?: (message: string) => void
  ): Promise<{ success: boolean; error?: string; workingDirectory?: string; setupOutput?: string }> {
    try {
      let workingDirectory: string | undefined;
      let setupOutput: string | undefined;

      // 1. Run worktree script if provided
      if (config.worktreeScript) {
        onProgress?.('Running worktree setup script...');
        const result = await this.runWorktreeScript(
          sessionId,
          config,
          config.worktreeScript,
          (output) => onProgress?.(output)
        );
        if (!result.success) {
          return { success: false, error: `Worktree script failed: ${result.error}` };
        }
        // Capture the working directory and output from the script
        workingDirectory = result.workingDirectory;
        setupOutput = result.output;
      }

      // 2. Sync settings if enabled
      if (config.syncSettings !== false) { // Default to true
        onProgress?.('Syncing Claude settings to remote...');
        const syncResult = await this.syncSettings(sessionId, config);
        if (!syncResult.success) {
          // Don't fail the whole setup if sync fails, just log warning
          console.warn('[SSH Service] Settings sync failed, continuing anyway:', syncResult.error);
          onProgress?.(`Warning: Settings sync failed: ${syncResult.error}`);
        } else {
          onProgress?.('Settings synced successfully');
        }
      }

      return { success: true, workingDirectory, setupOutput };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Fetch a transcript file from the remote machine
   * Returns the content of the transcript file or null if not found
   */
  async fetchRemoteTranscript(
    sessionId: string,
    config: SSHConfig,
    sdkSessionId: string,
    remoteWorkdir: string
  ): Promise<string | null> {
    try {
      const client = await this.getConnection(sessionId, config);

      // Construct the expected path to the transcript file
      // Claude Code stores transcripts in ~/.claude/projects/<escaped-path>/<session-id>.jsonl
      // The escaped path replaces / with - and uses the absolute workdir path
      const escapedPath = remoteWorkdir.replace(/\//g, '-').replace(/^-/, '-');
      const transcriptPath = `~/.claude/projects/${escapedPath}/${sdkSessionId}.jsonl`;

      console.log('[SSH Service] Fetching remote transcript:', transcriptPath);

      // Try to read the transcript file
      const result = await this.execCommand(
        client,
        `cat "${transcriptPath}" 2>/dev/null || echo "___TRANSCRIPT_NOT_FOUND___"`
      );

      if (result.includes('___TRANSCRIPT_NOT_FOUND___')) {
        // Try alternative path format (just the directory name)
        const altPath = `~/.claude/projects/*/${sdkSessionId}.jsonl`;
        console.log('[SSH Service] Trying alternative transcript path:', altPath);

        const altResult = await this.execCommand(
          client,
          `cat ${altPath} 2>/dev/null || echo "___TRANSCRIPT_NOT_FOUND___"`
        );

        if (altResult.includes('___TRANSCRIPT_NOT_FOUND___')) {
          console.log('[SSH Service] Transcript not found on remote');
          return null;
        }

        return altResult;
      }

      return result;
    } catch (error) {
      console.error('[SSH Service] Failed to fetch remote transcript:', error);
      return null;
    }
  }

  /**
   * List available transcript files on the remote machine for a given workdir
   * Returns array of {filename, mtime} sorted by most recent
   */
  async listRemoteTranscripts(
    sessionId: string,
    config: SSHConfig,
    remoteWorkdir: string
  ): Promise<Array<{ filename: string; sessionId: string; mtime: number }>> {
    try {
      const client = await this.getConnection(sessionId, config);

      // Construct the expected path to the transcripts directory
      const escapedPath = remoteWorkdir.replace(/\//g, '-').replace(/^-/, '-');
      const transcriptsDir = `~/.claude/projects/${escapedPath}`;

      console.log('[SSH Service] Listing remote transcripts in:', transcriptsDir);

      // List .jsonl files with their modification times, excluding agent files
      const result = await this.execCommand(
        client,
        `find ${transcriptsDir} -maxdepth 1 -name "*.jsonl" ! -name "agent-*" -printf "%T@ %f\\n" 2>/dev/null | sort -rn || echo ""`
      );

      if (!result.trim()) {
        return [];
      }

      const transcripts: Array<{ filename: string; sessionId: string; mtime: number }> = [];
      for (const line of result.trim().split('\n')) {
        const match = line.match(/^(\d+\.?\d*)\s+(.+\.jsonl)$/);
        if (match) {
          const mtime = parseFloat(match[1]);
          const filename = match[2];
          const sessionId = filename.replace('.jsonl', '');
          transcripts.push({ filename, sessionId, mtime });
        }
      }

      return transcripts;
    } catch (error) {
      console.error('[SSH Service] Failed to list remote transcripts:', error);
      return [];
    }
  }
}

// Export singleton instance
export const sshService = new SSHService();
