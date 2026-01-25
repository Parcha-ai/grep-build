import { IpcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import { SessionService } from '../services/session.service';
import { getMainWindow } from '../index';

const sessionService = new SessionService();

// Export sessionService for use by other IPC handlers that need session data
export { sessionService };

export function registerSessionHandlers(ipcMain: IpcMain): void {
  // Subscribe to session status changes
  sessionService.on('statusChanged', (session) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.SESSION_STATUS_CHANGED, session);
    }
  });

  // Subscribe to sessions list updates (from background discovery)
  sessionService.on('sessionsUpdated', (sessions) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.SESSION_LIST_UPDATED, sessions);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SESSION_CREATE, async (_, config) => {
    return sessionService.createSession(config);
  });

  ipcMain.handle(IPC_CHANNELS.SESSION_START, async (_, sessionId: string) => {
    return sessionService.startSession(sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.SESSION_STOP, async (_, sessionId: string) => {
    return sessionService.stopSession(sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.SESSION_DELETE, async (_, sessionId: string) => {
    return sessionService.deleteSession(sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.SESSION_LIST, async () => {
    return sessionService.listSessions();
  });

  ipcMain.handle(IPC_CHANNELS.SESSION_GET, async (_, sessionId: string) => {
    return sessionService.getSession(sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.SESSION_UPDATE, async (_, sessionId: string, updates) => {
    return sessionService.updateSession(sessionId, updates);
  });
}
