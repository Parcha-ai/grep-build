import { IpcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import { qmdService, QMDStatus } from '../services/qmd.service';

export function registerQmdHandlers(ipcMain: IpcMain, getMainWindow: () => BrowserWindow | null): void {
  // Get QMD status (installed, collections, embeddings ready)
  ipcMain.handle(IPC_CHANNELS.QMD_GET_STATUS, async (): Promise<QMDStatus> => {
    return qmdService.getStatus();
  });

  // Ensure a project is indexed (create collection + embeddings if needed)
  ipcMain.handle(
    IPC_CHANNELS.QMD_ENSURE_INDEXED,
    async (_, projectPath: string): Promise<boolean> => {
      const mainWindow = getMainWindow();

      const onProgress = (message: string) => {
        console.log('[QMD IPC] Progress:', message);
        if (mainWindow) {
          mainWindow.webContents.send(IPC_CHANNELS.QMD_INDEXING_PROGRESS, {
            projectPath,
            message,
          });
        }
      };

      return qmdService.ensureProjectIndexed(projectPath, onProgress);
    }
  );

  // Create a collection for a project
  ipcMain.handle(
    IPC_CHANNELS.QMD_CREATE_COLLECTION,
    async (_, projectPath: string, mask?: string): Promise<boolean> => {
      const mainWindow = getMainWindow();

      const onProgress = (message: string) => {
        if (mainWindow) {
          mainWindow.webContents.send(IPC_CHANNELS.QMD_INDEXING_PROGRESS, {
            projectPath,
            message,
          });
        }
      };

      return qmdService.createCollection(projectPath, { mask, onProgress });
    }
  );

  // Generate embeddings for collections
  ipcMain.handle(
    IPC_CHANNELS.QMD_GENERATE_EMBEDDINGS,
    async (_, collectionName?: string): Promise<boolean> => {
      const mainWindow = getMainWindow();

      const onProgress = (message: string) => {
        if (mainWindow) {
          mainWindow.webContents.send(IPC_CHANNELS.QMD_INDEXING_PROGRESS, {
            collectionName,
            message,
          });
        }
      };

      return qmdService.generateEmbeddings(collectionName, onProgress);
    }
  );

  // Direct search (for testing/UI purposes)
  ipcMain.handle(
    IPC_CHANNELS.QMD_SEARCH,
    async (
      _,
      query: string,
      options?: { collection?: string; mode?: 'search' | 'vsearch' | 'query'; limit?: number }
    ): Promise<{ file: string; score: number; content: string }[]> => {
      return qmdService.search(query, options);
    }
  );

  // Get project preference for QMD
  ipcMain.handle(
    IPC_CHANNELS.QMD_GET_PROJECT_PREFERENCE,
    async (_, projectPath: string): Promise<'enabled' | 'disabled' | 'unknown'> => {
      return qmdService.getProjectPreference(projectPath);
    }
  );

  // Set project preference for QMD
  ipcMain.handle(
    IPC_CHANNELS.QMD_SET_PROJECT_PREFERENCE,
    async (_, projectPath: string, preference: 'enabled' | 'disabled'): Promise<void> => {
      qmdService.setProjectPreference(projectPath, preference);
    }
  );

  // Check if we should prompt user about QMD for this project
  ipcMain.handle(
    IPC_CHANNELS.QMD_SHOULD_PROMPT,
    async (_, projectPath: string): Promise<boolean> => {
      return qmdService.shouldPromptForProject(projectPath);
    }
  );

  // Auto-install QMD (downloads Bun + QMD if not available)
  ipcMain.handle(
    IPC_CHANNELS.QMD_AUTO_INSTALL,
    async (): Promise<boolean> => {
      const mainWindow = getMainWindow();

      const onProgress = (message: string) => {
        console.log('[QMD IPC] Install progress:', message);
        if (mainWindow) {
          mainWindow.webContents.send(IPC_CHANNELS.QMD_INDEXING_PROGRESS, {
            message,
          });
        }
      };

      return qmdService.autoInstall(onProgress);
    }
  );
}
