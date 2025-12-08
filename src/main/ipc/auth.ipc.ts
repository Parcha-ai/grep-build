import { IpcMain, BrowserWindow, shell } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import { AuthService } from '../services/auth.service';

const authService = new AuthService();

export function registerAuthHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC_CHANNELS.AUTH_LOGIN, async () => {
    try {
      const authUrl = await authService.initiateOAuth();

      // Open auth URL in a new window
      const authWindow = new BrowserWindow({
        width: 800,
        height: 700,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      authWindow.loadURL(authUrl);

      return new Promise((resolve, reject) => {
        authWindow.webContents.on('will-redirect', async (event, url) => {
          if (url.startsWith('grep://oauth/callback')) {
            event.preventDefault();
            const urlObj = new URL(url);
            const code = urlObj.searchParams.get('code');

            if (code) {
              try {
                const tokens = await authService.exchangeCode(code);
                authWindow.close();
                resolve(tokens);
              } catch (error) {
                authWindow.close();
                reject(error);
              }
            } else {
              authWindow.close();
              reject(new Error('No authorization code received'));
            }
          }
        });

        authWindow.on('closed', () => {
          reject(new Error('Auth window was closed'));
        });
      });
    } catch (error) {
      console.error('Auth login error:', error);
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, async () => {
    await authService.logout();
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_GET_USER, async () => {
    return authService.getUser();
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_GET_REPOS, async () => {
    return authService.getRepos();
  });
}
