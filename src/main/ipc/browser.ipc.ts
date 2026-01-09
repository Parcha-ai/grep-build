import { type IpcMain } from 'electron';
import { browserService } from '../services/browser.service';
import { IPC_CHANNELS } from '../../shared/constants/channels';

export function registerBrowserHandlers(ipcMain: IpcMain): void {
  // Capture snapshot
  ipcMain.handle(IPC_CHANNELS.BROWSER_CAPTURE_SNAPSHOT, async (_event, sessionId: string, url: string) => {
    try {
      const snapshot = await browserService.captureSnapshot(sessionId, url);
      return snapshot;
    } catch (error) {
      console.error('[Browser IPC] Error capturing snapshot:', error);
      throw error;
    }
  });

  // Navigate to URL
  ipcMain.handle(IPC_CHANNELS.BROWSER_NAVIGATE_TO, async (_event, sessionId: string, url: string) => {
    try {
      await browserService.navigate(sessionId, url);
      return { success: true };
    } catch (error) {
      console.error('[Browser IPC] Error navigating:', error);
      throw error;
    }
  });

  // Get last snapshot
  ipcMain.handle(IPC_CHANNELS.BROWSER_GET_SNAPSHOT, async (_event, sessionId: string) => {
    try {
      const snapshot = browserService.getSnapshot(sessionId);
      return snapshot;
    } catch (error) {
      console.error('[Browser IPC] Error getting snapshot:', error);
      throw error;
    }
  });

  // Clear all storage (cookies, localStorage, etc.)
  ipcMain.handle(IPC_CHANNELS.BROWSER_CLEAR_STORAGE, async (_event) => {
    try {
      const { session } = require('electron');
      const webviewSession = session.fromPartition('persist:browser');

      // Clear all cookies
      await webviewSession.clearStorageData({
        storages: ['cookies', 'localstorage', 'sessionstorage', 'indexdb', 'serviceworkers', 'cachestorage']
      });

      console.log('[Browser IPC] All storage cleared');
      return { success: true };
    } catch (error) {
      console.error('[Browser IPC] Error clearing storage:', error);
      throw error;
    }
  });
}
