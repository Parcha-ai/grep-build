import { IpcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import { Session } from '../../shared/types';
import { SessionService } from '../services/session.service';
import { getMainWindow } from '../index';
import { browserService } from '../services/browser.service';
import { claudeService } from './claude.ipc';

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
    // Clean up service-level Maps before deleting the session data
    claudeService.cleanupSession(sessionId);
    browserService.cleanupSession(sessionId);
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

  ipcMain.handle(IPC_CHANNELS.SESSION_REWIND_FORK, async (_, sessionId: string, rewindToMessageId: string) => {
    return sessionService.rewindAndForkSession(sessionId, rewindToMessageId);
  });

  // Conversation fork handlers
  ipcMain.handle(IPC_CHANNELS.SESSION_CREATE_FORK, async (
    _,
    parentSessionId: string,
    forkPoint: string,
    initialMessage?: string
  ) => {
    return sessionService.createForkFromInput(parentSessionId, forkPoint, initialMessage);
  });

  ipcMain.handle(IPC_CHANNELS.SESSION_GET_FORK_GROUP, async (_, sessionId: string) => {
    const allSessions = await sessionService.listSessions();
    const currentSession = allSessions.find(s => s.id === sessionId);
    if (!currentSession) return [];

    // Find root session (walk up parentSessionId chain)
    let rootId = sessionId;
    let session: Session | undefined = currentSession;
    while (session?.parentSessionId) {
      rootId = session.parentSessionId;
      session = allSessions.find(s => s.id === rootId);
      if (!session) break; // Guard against missing parent
    }

    // Collect all sessions in fork group (root + all descendants)
    const root = allSessions.find(s => s.id === rootId);
    if (!root) return [];

    const forkGroup = [root, ...allSessions.filter(s => s.parentSessionId === rootId)];

    // Sort by creation order
    return forkGroup.sort((a, b) =>
      (a.forkCreatedAt || a.createdAt).getTime() - (b.forkCreatedAt || b.createdAt).getTime()
    );
  });
}
