import { BrowserWindow, ipcMain } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export interface BrowserSnapshot {
  url: string;
  screenshot: string; // base64 encoded PNG
  html: string;
  timestamp: Date;
  requestId?: string; // Unique ID for matching async requests
}

/**
 * Service for browser automation and snapshot capture
 */
export class BrowserService {
  private webviewSnapshots = new Map<string, BrowserSnapshot>();
  private pendingSnapshots = new Map<string, { resolve: (snapshot: BrowserSnapshot) => void; reject: (error: Error) => void }>();

  constructor() {
    // Listen for snapshot data from renderer
    ipcMain.on('browser:snapshot-captured', (_event, snapshot: BrowserSnapshot) => {
      // Use requestId for matching if available, fall back to URL for backwards compatibility
      const key = snapshot.requestId || snapshot.url;
      const pending = this.pendingSnapshots.get(key);
      if (pending) {
        pending.resolve(snapshot);
        this.pendingSnapshots.delete(key);
      }
    });
  }

  /**
   * Capture a snapshot of the current browser view
   * Returns base64 encoded screenshot and HTML content
   */
  async captureSnapshot(sessionId: string, url: string): Promise<BrowserSnapshot> {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (!mainWindow) {
      throw new Error('No browser window available');
    }

    try {
      // Generate unique request ID to avoid race conditions
      const requestId = `${sessionId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Send message to renderer to capture webview content
      mainWindow.webContents.send('browser:capture-snapshot', { sessionId, requestId });

      // Wait for snapshot data from renderer
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pendingSnapshots.delete(requestId);
          reject(new Error('Snapshot capture timeout (10s)'));
        }, 10000);

        this.pendingSnapshots.set(requestId, {
          resolve: (snapshot) => {
            clearTimeout(timeout);
            this.webviewSnapshots.set(sessionId, snapshot);
            resolve(snapshot);
          },
          reject: (error) => {
            clearTimeout(timeout);
            this.pendingSnapshots.delete(requestId);
            reject(error);
          },
        });
      });
    } catch (error) {
      console.error('[Browser Service] Snapshot error:', error);
      throw error;
    }
  }

  /**
   * Navigate browser to a specific URL
   */
  async navigate(sessionId: string, url: string): Promise<void> {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (!mainWindow) {
      throw new Error('No browser window available');
    }

    mainWindow.webContents.send('browser:navigate', { sessionId, url });
  }

  /**
   * Get the last captured snapshot for a session
   */
  getSnapshot(sessionId: string): BrowserSnapshot | null {
    return this.webviewSnapshots.get(sessionId) || null;
  }

  /**
   * Save snapshot to disk
   */
  async saveSnapshotToDisk(sessionId: string, snapshot: BrowserSnapshot): Promise<string> {
    const snapshotDir = path.join(os.tmpdir(), 'claudette-snapshots');
    await fs.mkdir(snapshotDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `snapshot-${sessionId}-${timestamp}.png`;
    const filepath = path.join(snapshotDir, filename);

    // Strip data URL prefix if present (handles multiple formats)
    let base64Data = snapshot.screenshot;
    if (base64Data.startsWith('data:')) {
      const base64Index = base64Data.indexOf('base64,');
      if (base64Index !== -1) {
        base64Data = base64Data.substring(base64Index + 7);
      }
    }

    // Decode base64 and save
    const buffer = Buffer.from(base64Data, 'base64');
    await fs.writeFile(filepath, buffer);

    return filepath;
  }
}

export const browserService = new BrowserService();
