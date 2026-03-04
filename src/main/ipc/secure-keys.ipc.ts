/**
 * Secure Keys IPC Handlers
 *
 * Handles secure storage and retrieval of API keys/tokens detected in chat messages.
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import { secureKeysService } from '../services/secure-keys.service';

export function registerSecureKeysIPC(): void {
  /**
   * Intercept message text, detect keys, store securely, and return modified text
   */
  ipcMain.handle(
    IPC_CHANNELS.SECURE_KEYS_INTERCEPT,
    async (_event, sessionId: string, text: string) => {
      const result = secureKeysService.interceptAndReplaceKeys(sessionId, text);
      return result;
    }
  );

  /**
   * Retrieve a key by its reference ID (for agent use)
   */
  ipcMain.handle(
    IPC_CHANNELS.SECURE_KEYS_GET,
    async (_event, keyId: string) => {
      const value = secureKeysService.getKey(keyId);
      return { success: !!value, value };
    }
  );

  /**
   * List all keys for a session (metadata only, no actual values)
   */
  ipcMain.handle(
    IPC_CHANNELS.SECURE_KEYS_LIST,
    async (_event, sessionId: string) => {
      const keys = secureKeysService.getSessionKeys(sessionId);
      return { keys };
    }
  );

  /**
   * Clear all keys for a session (called when session ends)
   */
  ipcMain.handle(
    IPC_CHANNELS.SECURE_KEYS_CLEAR_SESSION,
    async (_event, sessionId: string) => {
      secureKeysService.clearSessionKeys(sessionId);
      return { success: true };
    }
  );
}
