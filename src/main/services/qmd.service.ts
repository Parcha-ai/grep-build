import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as https from 'https';
import { app } from 'electron';
import Store from 'electron-store';

const execAsync = promisify(exec);

const BUN_VERSION = '1.1.38';

export interface QMDCollection {
  name: string;
  path: string;
  fileCount?: number;
  lastIndexed?: string;
}

export interface QMDStatus {
  installed: boolean;
  version?: string;
  collections: QMDCollection[];
  embeddingsReady: boolean;
  bundled: boolean;
}

interface QMDServiceStore {
  collections: Record<string, { name: string; lastIndexed: string }>;
  qmdPath?: string;
  // Per-project QMD preferences: 'enabled' | 'disabled' | 'pending' (not yet asked)
  projectPreferences: Record<string, 'enabled' | 'disabled'>;
}

export class QMDService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private store: any;
  private qmdPath: string | null = null;
  private isBundled = false;
  private isChecking = false;

  constructor() {
    this.store = new Store<QMDServiceStore>({
      name: 'claudette-qmd',
      defaults: { collections: {}, projectPreferences: {} },
    });
  }

  /**
   * Convert a project path to a safe key for storage
   * Uses MD5 hash to avoid special characters in keys
   */
  private getProjectKey(projectPath: string): string {
    return crypto.createHash('md5').update(projectPath).digest('hex');
  }

  /**
   * Check if QMD is enabled for a specific project
   * Returns: 'enabled' | 'disabled' | 'unknown' (not yet decided)
   */
  getProjectPreference(projectPath: string): 'enabled' | 'disabled' | 'unknown' {
    const key = this.getProjectKey(projectPath);
    const pref = this.store.get(`projectPreferences.${key}`) as 'enabled' | 'disabled' | undefined;
    return pref || 'unknown';
  }

  /**
   * Set QMD preference for a project
   */
  setProjectPreference(projectPath: string, preference: 'enabled' | 'disabled'): void {
    const key = this.getProjectKey(projectPath);
    this.store.set(`projectPreferences.${key}`, preference);
    console.log(`[QMD Service] Set preference for ${projectPath}: ${preference}`);
  }

  /**
   * Check if we should prompt the user about enabling QMD for this project
   * Returns true if QMD is available and user hasn't decided yet
   */
  async shouldPromptForProject(projectPath: string): Promise<boolean> {
    const installed = await this.checkInstalled();
    if (!installed) {
      return false;
    }

    const preference = this.getProjectPreference(projectPath);
    return preference === 'unknown';
  }

  /**
   * Check if QMD should be used for a project (both globally enabled and project enabled)
   */
  isEnabledForProject(projectPath: string, globalEnabled: boolean): boolean {
    if (!globalEnabled) {
      return false;
    }

    const preference = this.getProjectPreference(projectPath);
    return preference === 'enabled';
  }

  /**
   * Get the user-local QMD installation path (for runtime installs)
   */
  private getUserQmdPath(): string {
    const platform = os.platform();
    const arch = os.arch();
    const platformKey = `${platform}-${arch}`;
    const qmdDir = path.join(app.getPath('userData'), 'qmd', platformKey);
    return platform === 'win32'
      ? path.join(qmdDir, 'qmd.cmd')
      : path.join(qmdDir, 'qmd');
  }

  /**
   * Get the path to bundled QMD based on platform
   *
   * Note: In development mode, the bundled QMD may have module resolution conflicts
   * with the parent project's node_modules (specifically ajv-formats version mismatch).
   * The bundled QMD works correctly in the packaged app where it's isolated.
   * During development, check user-local install first, then fall back to system QMD.
   */
  private getBundledQmdPath(): string | null {
    const platform = os.platform();
    const arch = os.arch();
    const platformKey = `${platform}-${arch}`;

    // In development mode, check user-local QMD first (installed via auto-download)
    if (!app.isPackaged) {
      const userQmdPath = this.getUserQmdPath();
      if (fs.existsSync(userQmdPath)) {
        console.log('[QMD Service] Development mode - using user-local QMD at:', userQmdPath);
        return userQmdPath;
      }
      console.log('[QMD Service] Development mode - no user-local QMD found');
      return null;
    }

    // Packaged app: look in Resources folder
    let resourcesPath: string;
    if (platform === 'darwin') {
      resourcesPath = path.join(path.dirname(app.getPath('exe')), '..', 'Resources');
    } else {
      resourcesPath = path.join(path.dirname(app.getPath('exe')), 'resources');
    }

    const qmdWrapper = platform === 'win32'
      ? path.join(resourcesPath, 'qmd', platformKey, 'qmd.cmd')
      : path.join(resourcesPath, 'qmd', platformKey, 'qmd');

    console.log('[QMD Service] Checking bundled QMD at:', qmdWrapper);

    if (fs.existsSync(qmdWrapper)) {
      return qmdWrapper;
    }

    return null;
  }

  /**
   * Download a file from URL with redirect support
   */
  private downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`[QMD Service] Downloading: ${url}`);
      const file = fs.createWriteStream(dest);

      const request = (downloadUrl: string) => {
        https.get(downloadUrl, (response) => {
          // Handle redirects
          if (response.statusCode === 302 || response.statusCode === 301) {
            const redirectUrl = response.headers.location;
            if (redirectUrl) {
              request(redirectUrl);
              return;
            }
          }

          if (response.statusCode !== 200) {
            reject(new Error(`Failed to download: ${response.statusCode}`));
            return;
          }

          response.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        }).on('error', (err) => {
          fs.unlinkSync(dest);
          reject(err);
        });
      };

      request(url);
    });
  }

  /**
   * Auto-install QMD (Bun + QMD) to user's local data folder
   * Used in development mode or when bundled QMD is not available
   */
  async autoInstall(onProgress?: (message: string) => void): Promise<boolean> {
    const platform = os.platform();
    const arch = os.arch();
    const platformKey = `${platform}-${arch}`;

    const bunUrls: Record<string, string> = {
      'darwin-arm64': `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-darwin-aarch64.zip`,
      'darwin-x64': `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-darwin-x64.zip`,
      'linux-x64': `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64.zip`,
      'win32-x64': `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-windows-x64.zip`,
    };

    const bunUrl = bunUrls[platformKey];
    if (!bunUrl) {
      onProgress?.(`Unsupported platform: ${platformKey}`);
      return false;
    }

    const qmdDir = path.join(app.getPath('userData'), 'qmd', platformKey);
    const bunDir = path.join(qmdDir, 'bun');
    const bunBinary = platform === 'win32' ? 'bun.exe' : 'bun';
    const bunPath = path.join(bunDir, bunBinary);

    try {
      // Create directories
      fs.mkdirSync(qmdDir, { recursive: true });

      // Download Bun if not exists
      if (!fs.existsSync(bunPath)) {
        onProgress?.('Downloading Bun runtime...');
        const zipPath = path.join(qmdDir, 'bun.zip');
        await this.downloadFile(bunUrl, zipPath);

        onProgress?.('Extracting Bun...');
        fs.mkdirSync(bunDir, { recursive: true });

        if (platform === 'win32') {
          await execAsync(`powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${qmdDir}' -Force"`);
        } else {
          await execAsync(`unzip -o "${zipPath}" -d "${qmdDir}"`);
        }

        // Move extracted files (Bun extracts to a subdirectory)
        const extractedDirs = fs.readdirSync(qmdDir).filter(f => f.startsWith('bun-'));
        if (extractedDirs.length > 0) {
          const extractedDir = path.join(qmdDir, extractedDirs[0]);
          // Move contents to bunDir
          const files = fs.readdirSync(extractedDir);
          for (const file of files) {
            fs.renameSync(path.join(extractedDir, file), path.join(bunDir, file));
          }
          fs.rmdirSync(extractedDir);
        }

        // Cleanup zip
        fs.unlinkSync(zipPath);

        // Make executable
        if (platform !== 'win32') {
          fs.chmodSync(bunPath, 0o755);
        }

        onProgress?.('Bun installed');
      }

      // Install QMD
      const qmdPackageDir = path.join(qmdDir, 'qmd-package');
      const qmdBin = path.join(qmdPackageDir, 'node_modules', '.bin', 'qmd');

      if (!fs.existsSync(qmdBin) && !fs.existsSync(qmdBin + '.exe')) {
        onProgress?.('Installing QMD...');
        fs.mkdirSync(qmdPackageDir, { recursive: true });

        // Create minimal package.json
        fs.writeFileSync(path.join(qmdPackageDir, 'package.json'), JSON.stringify({
          name: 'qmd-bundle',
          private: true,
          dependencies: {},
        }));

        // Install QMD from GitHub using Bun
        await new Promise<void>((resolve, reject) => {
          const installProcess = spawn(bunPath, ['add', 'https://github.com/tobi/qmd'], {
            cwd: qmdPackageDir,
            env: { ...process.env, BUN_INSTALL_CACHE_DIR: path.join(qmdDir, '.bun-cache') },
          });

          installProcess.stdout?.on('data', (data) => {
            onProgress?.(data.toString().trim());
          });

          installProcess.stderr?.on('data', (data) => {
            console.log('[QMD Service] install stderr:', data.toString());
          });

          installProcess.on('close', (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`QMD installation failed with code ${code}`));
            }
          });

          installProcess.on('error', reject);
        });

        onProgress?.('QMD installed');
      }

      // Create wrapper script
      const wrapperPath = this.getUserQmdPath();
      if (!fs.existsSync(wrapperPath)) {
        onProgress?.('Creating QMD wrapper...');

        if (platform === 'win32') {
          const wrapperContent = `@echo off
set "SCRIPT_DIR=%~dp0"
"%SCRIPT_DIR%bun\\bun.exe" --cwd="%SCRIPT_DIR%qmd-package\\node_modules\\qmd" "src\\qmd.ts" %*
`;
          fs.writeFileSync(wrapperPath, wrapperContent);
        } else {
          const wrapperContent = `#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
QMD_DIR="$DIR/qmd-package/node_modules/qmd"
"$DIR/bun/bun" --cwd="$QMD_DIR" "src/qmd.ts" "$@"
`;
          fs.writeFileSync(wrapperPath, wrapperContent);
          fs.chmodSync(wrapperPath, 0o755);
        }
      }

      // Update our cached path
      this.qmdPath = wrapperPath;
      this.isBundled = false;

      onProgress?.('QMD setup complete!');
      return true;
    } catch (error) {
      console.error('[QMD Service] Auto-install failed:', error);
      onProgress?.(`Installation failed: ${error}`);
      return false;
    }
  }

  /**
   * Generate a collection name from a project path
   */
  private getCollectionName(projectPath: string): string {
    const basename = path.basename(projectPath);
    const hash = crypto.createHash('md5').update(projectPath).digest('hex').substring(0, 6);
    // Sanitize name: lowercase, replace spaces/special chars with hyphens
    const sanitized = basename.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    return `${sanitized}-${hash}`;
  }

  /**
   * Check if QMD is installed and available (bundled or system)
   */
  async checkInstalled(): Promise<boolean> {
    if (this.qmdPath) {
      return true;
    }

    // First, check for bundled QMD
    const bundledPath = this.getBundledQmdPath();
    if (bundledPath) {
      this.qmdPath = bundledPath;
      this.isBundled = true;
      console.log('[QMD Service] Using bundled QMD at:', this.qmdPath);
      return true;
    }

    // Fall back to system-installed QMD
    try {
      // Try to find qmd in PATH
      const { stdout } = await execAsync('which qmd');
      this.qmdPath = stdout.trim();
      this.store.set('qmdPath', this.qmdPath);
      console.log('[QMD Service] Found system QMD at:', this.qmdPath);
      return true;
    } catch {
      // Try common installation paths
      const commonPaths = [
        '/usr/local/bin/qmd',
        '/opt/homebrew/bin/qmd',
        `${process.env.HOME}/.bun/bin/qmd`,
        `${process.env.HOME}/.local/bin/qmd`,
      ];

      for (const p of commonPaths) {
        try {
          await execAsync(`test -x "${p}"`);
          this.qmdPath = p;
          this.store.set('qmdPath', this.qmdPath);
          console.log('[QMD Service] Found system QMD at:', this.qmdPath);
          return true;
        } catch {
          // Try next path
        }
      }

      console.log('[QMD Service] QMD not found (bundled or system)');
      return false;
    }
  }

  /**
   * Get QMD version
   */
  async getVersion(): Promise<string | undefined> {
    if (!this.qmdPath) {
      const installed = await this.checkInstalled();
      if (!installed) return undefined;
    }

    try {
      const { stdout } = await execAsync(`"${this.qmdPath}" --version`);
      return stdout.trim();
    } catch (error) {
      console.error('[QMD Service] Failed to get version:', error);
      return undefined;
    }
  }

  /**
   * List all QMD collections
   */
  async listCollections(): Promise<QMDCollection[]> {
    if (!this.qmdPath) {
      const installed = await this.checkInstalled();
      if (!installed) return [];
    }

    try {
      const { stdout } = await execAsync(`"${this.qmdPath}" collection list --json`);
      const collections = JSON.parse(stdout);
      return collections.map((c: { name: string; path: string; files?: number }) => ({
        name: c.name,
        path: c.path,
        fileCount: c.files,
      }));
    } catch (error) {
      console.error('[QMD Service] Failed to list collections:', error);
      return [];
    }
  }

  /**
   * Check if a collection exists for a project
   */
  async hasCollection(projectPath: string): Promise<boolean> {
    const collections = await this.listCollections();
    const collectionName = this.getCollectionName(projectPath);
    return collections.some((c) => c.name === collectionName || c.path === projectPath);
  }

  /**
   * Create a collection for a project
   */
  async createCollection(
    projectPath: string,
    options?: { mask?: string; onProgress?: (message: string) => void }
  ): Promise<boolean> {
    if (!this.qmdPath) {
      const installed = await this.checkInstalled();
      if (!installed) {
        console.error('[QMD Service] QMD not installed, cannot create collection');
        return false;
      }
    }

    const collectionName = this.getCollectionName(projectPath);
    const mask = options?.mask || '**/*.{ts,tsx,js,jsx,py,go,rs,java,md,json,yaml,yml,toml}';

    try {
      options?.onProgress?.(`Creating collection "${collectionName}" for ${projectPath}...`);

      const args = ['collection', 'add', projectPath, '--name', collectionName, '--mask', mask];
      await execAsync(`"${this.qmdPath}" ${args.map((a) => `"${a}"`).join(' ')}`);

      // Store collection info
      this.store.set(`collections.${collectionName}`, {
        name: collectionName,
        lastIndexed: new Date().toISOString(),
      });

      console.log('[QMD Service] Created collection:', collectionName);
      options?.onProgress?.(`Collection "${collectionName}" created successfully.`);
      return true;
    } catch (error) {
      console.error('[QMD Service] Failed to create collection:', error);
      options?.onProgress?.(`Failed to create collection: ${error}`);
      return false;
    }
  }

  /**
   * Generate embeddings for all collections (or a specific one)
   */
  async generateEmbeddings(
    collectionName?: string,
    onProgress?: (message: string) => void
  ): Promise<boolean> {
    if (!this.qmdPath) {
      const installed = await this.checkInstalled();
      if (!installed) return false;
    }

    try {
      onProgress?.('Generating embeddings (this may take a while on first run)...');

      const args = ['embed'];
      if (collectionName) {
        args.push('--collection', collectionName);
      }

      // Run embed command - this downloads models on first run and generates embeddings
      if (!this.qmdPath) {
        onProgress?.('QMD path not set');
        return false;
      }

      const child = spawn(this.qmdPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      return new Promise((resolve) => {
        child.stdout?.on('data', (data) => {
          // Parse progress if QMD outputs it
          const lines = data.toString().split('\n');
          for (const line of lines) {
            if (line.trim()) {
              onProgress?.(line.trim());
            }
          }
        });

        child.stderr?.on('data', (data) => {
          console.error('[QMD Service] embed stderr:', data.toString());
        });

        child.on('close', (code) => {
          if (code === 0) {
            console.log('[QMD Service] Embeddings generated successfully');
            onProgress?.('Embeddings generated successfully.');
            resolve(true);
          } else {
            console.error('[QMD Service] embed failed with code:', code);
            onProgress?.(`Embedding generation failed with code ${code}`);
            resolve(false);
          }
        });

        child.on('error', (error) => {
          console.error('[QMD Service] embed error:', error);
          onProgress?.(`Embedding error: ${error.message}`);
          resolve(false);
        });
      });
    } catch (error) {
      console.error('[QMD Service] Failed to generate embeddings:', error);
      onProgress?.(`Failed to generate embeddings: ${error}`);
      return false;
    }
  }

  /**
   * Ensure a project has a QMD collection with embeddings
   */
  async ensureProjectIndexed(
    projectPath: string,
    onProgress?: (message: string) => void
  ): Promise<boolean> {
    if (this.isChecking) {
      console.log('[QMD Service] Already checking/indexing, skipping');
      return false;
    }

    this.isChecking = true;

    try {
      // Check if QMD is installed
      const installed = await this.checkInstalled();
      if (!installed) {
        onProgress?.('QMD not installed. Install with: bun install -g https://github.com/tobi/qmd');
        return false;
      }

      // Check if collection exists
      const hasCollection = await this.hasCollection(projectPath);
      if (!hasCollection) {
        onProgress?.('Creating QMD collection for this project...');
        const created = await this.createCollection(projectPath, { onProgress });
        if (!created) {
          return false;
        }
      } else {
        onProgress?.('QMD collection found for project.');
      }

      // Generate/update embeddings
      const collectionName = this.getCollectionName(projectPath);
      const embeddingsOk = await this.generateEmbeddings(collectionName, onProgress);

      return embeddingsOk;
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Get full QMD status
   */
  async getStatus(): Promise<QMDStatus> {
    const installed = await this.checkInstalled();

    if (!installed) {
      return {
        installed: false,
        collections: [],
        embeddingsReady: false,
        bundled: false,
      };
    }

    const version = await this.getVersion();
    const collections = await this.listCollections();

    // Check if embeddings exist (qmd status command)
    let embeddingsReady = false;
    try {
      const { stdout } = await execAsync(`"${this.qmdPath}" status --json`);
      const status = JSON.parse(stdout);
      embeddingsReady = status.embeddingsReady || status.hasEmbeddings || false;
    } catch {
      // Embeddings not ready or command failed
    }

    return {
      installed: true,
      version,
      collections,
      embeddingsReady,
      bundled: this.isBundled,
    };
  }

  /**
   * Get MCP server configuration for QMD
   * Returns null if QMD is not installed
   */
  getMcpServerConfig(): { command: string; args: string[] } | null {
    if (!this.qmdPath) {
      return null;
    }

    return {
      command: this.qmdPath,
      args: ['mcp'],
    };
  }

  /**
   * Search using QMD (for testing/direct use)
   */
  async search(
    query: string,
    options?: { collection?: string; mode?: 'search' | 'vsearch' | 'query'; limit?: number }
  ): Promise<{ file: string; score: number; content: string }[]> {
    if (!this.qmdPath) {
      const installed = await this.checkInstalled();
      if (!installed) return [];
    }

    const mode = options?.mode || 'query';
    const limit = options?.limit || 10;

    try {
      const args = [mode, `"${query}"`, '--json', '-n', limit.toString()];
      if (options?.collection) {
        args.push('--collection', options.collection);
      }

      const { stdout } = await execAsync(`"${this.qmdPath}" ${args.join(' ')}`);
      return JSON.parse(stdout);
    } catch (error) {
      console.error('[QMD Service] Search failed:', error);
      return [];
    }
  }
}

// Singleton instance
export const qmdService = new QMDService();
