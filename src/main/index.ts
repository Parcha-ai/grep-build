import { app, BrowserWindow, ipcMain, protocol, session } from 'electron';
import * as path from 'path';
import { registerAuthHandlers } from './ipc/auth.ipc';
import { registerSessionHandlers } from './ipc/session.ipc';
import { registerGitHandlers } from './ipc/git.ipc';
import { registerTerminalHandlers } from './ipc/terminal.ipc';
import { registerClaudeHandlers } from './ipc/claude.ipc';
import { registerSettingsHandlers } from './ipc/settings.ipc';
import { registerDevHandlers } from './ipc/dev.ipc';
import { registerFsHandlers } from './ipc/fs.ipc';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let mainWindow: BrowserWindow | null = null;

const createWindow = (): void => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required for node-pty
      webviewTag: true,
    },
  });

  // Load the index.html of the app.
  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  // Set Content Security Policy
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
          "style-src 'self' 'unsafe-inline'",
          "connect-src 'self' https://api.anthropic.com https://api.github.com ws://localhost:* http://localhost:*",
          "img-src 'self' data: https: blob:",
          "font-src 'self' data:",
        ].join('; ')
      }
    });
  });

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

// Register custom protocol for OAuth callback
app.whenReady().then(() => {
  protocol.registerHttpProtocol('claudette', (request) => {
    // Handle OAuth callback
    const url = new URL(request.url);
    if (url.pathname === '/oauth/callback') {
      const code = url.searchParams.get('code');
      if (code && mainWindow) {
        mainWindow.webContents.send('auth:oauth-callback', { code });
      }
    }
  });
});

// Register IPC handlers
function registerIPCHandlers(): void {
  registerAuthHandlers(ipcMain);
  registerSessionHandlers(ipcMain);
  registerGitHandlers(ipcMain);
  registerTerminalHandlers(ipcMain);
  registerClaudeHandlers(ipcMain);
  registerSettingsHandlers(ipcMain);
  registerDevHandlers(ipcMain);
  registerFsHandlers(ipcMain);
}

// This method will be called when Electron has finished initialization
app.on('ready', () => {
  registerIPCHandlers();
  createWindow();
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS, re-create a window when dock icon is clicked and no windows are open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Export mainWindow for use in IPC handlers
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
