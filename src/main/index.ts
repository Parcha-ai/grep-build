import { app, BrowserWindow, ipcMain, protocol, session, net } from 'electron';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { registerAuthHandlers } from './ipc/auth.ipc';
import { registerSessionHandlers } from './ipc/session.ipc';
import { registerGitHandlers } from './ipc/git.ipc';
import { registerTerminalHandlers } from './ipc/terminal.ipc';
import { registerClaudeHandlers } from './ipc/claude.ipc';
import { registerSettingsHandlers } from './ipc/settings.ipc';
import { registerDevHandlers } from './ipc/dev.ipc';
import { registerFsHandlers } from './ipc/fs.ipc';
import { registerAudioHandlers } from './ipc/audio.ipc';
import { registerRealtimeHandlers } from './ipc/realtime.ipc';
import { registerExtensionHandlers } from './ipc/extension.ipc';
import { registerBrowserHandlers } from './ipc/browser.ipc';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

// Register custom protocol for Monaco assets - MUST be before app.ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'monaco-asset',
    privileges: {
      standard: true,
      supportFetchAPI: true,
      bypassCSP: true,
      secure: true,
    },
  },
]);

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
    trafficLightPosition: { x: 15, y: 10 },
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
          "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: monaco-asset:",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' monaco-asset:",
          "style-src 'self' 'unsafe-inline' monaco-asset:",
          "connect-src 'self' https://api.anthropic.com https://api.github.com https://api.elevenlabs.io https://api.openai.com ws://localhost:* http://localhost:* monaco-asset:",
          "img-src 'self' data: https: blob:",
          "font-src 'self' data: monaco-asset:",
          "worker-src 'self' blob: data: monaco-asset:",
        ].join('; ')
      }
    });
  });

  // Configure webview partition session for browser preview
  const webviewSession = session.fromPartition('persist:browser');

  // Log storage path to verify it's persistent
  console.log('[Main] Webview session storage path:', webviewSession.getStoragePath());

  // Enable third-party cookies (critical for OAuth)
  webviewSession.cookies.set({
    url: 'https://api.descope.com',
    name: 'test',
    value: 'test',
    expirationDate: Math.floor(Date.now() / 1000) + 3600
  }).then(() => {
    console.log('[Main] Webview session cookies enabled');
  }).catch(err => {
    console.error('[Main] Failed to set test cookie:', err);
  });

  // Disable security features that block OAuth flows
  webviewSession.setPermissionRequestHandler((webContents, permission, callback) => {
    console.log('[Main] Permission requested:', permission);
    // Allow all permissions for browser preview
    callback(true);
  });

  // Handle webview creation - configure for OAuth flows
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    console.log('[Main] Attaching webview with partition:', params.partition);
    // Keep web security enabled but configure for OAuth
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    // CRITICAL: Enable persistent storage for localStorage/cookies
    webPreferences.partition = params.partition || 'persist:browser';
    webPreferences.enableWebSQL = false;
    webPreferences.experimentalFeatures = true;
  });

  // Handle new windows from webview (OAuth popups)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.log('[Main] Window open requested:', url);
    // Allow OAuth popups
    if (url.includes('google.com') || url.includes('descope.com') || url.includes('auth.app.parcha.ai')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          webPreferences: {
            partition: 'persist:browser'
          }
        }
      };
    }
    return { action: 'deny' };
  });

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

// Register custom protocols
app.whenReady().then(() => {
  // OAuth callback protocol
  protocol.registerHttpProtocol('grep', (request) => {
    const url = new URL(request.url);
    if (url.pathname === '/oauth/callback') {
      const code = url.searchParams.get('code');
      if (code && mainWindow) {
        mainWindow.webContents.send('auth:oauth-callback', { code });
      }
    }
  });

  // Monaco assets protocol - serves files from node_modules
  protocol.handle('monaco-asset', (request) => {
    const url = new URL(request.url);
    // URL format: monaco-asset://app/node_modules/monaco-editor/min/vs/...
    // Extract the path after /node_modules/
    const relativePath = url.pathname.replace(/^\/node_modules\//, '');

    // Get the project root directory (where node_modules lives)
    // __dirname in webpack main is: /Users/aj/dev/parcha/claudette/.webpack/main
    // We need to go up 2 levels to get to project root
    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
    const baseDir = isDev
      ? path.join(__dirname, '..', '..') // .webpack/main -> project root
      : app.getAppPath();

    const filePath = path.join(baseDir, 'node_modules', relativePath);
    const fileUrl = pathToFileURL(filePath).toString();

    console.log('[Monaco Protocol] Serving:', filePath);
    return net.fetch(fileUrl, { bypassCustomProtocolHandlers: true });
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
  registerAudioHandlers(ipcMain);
  registerRealtimeHandlers(ipcMain);
  registerExtensionHandlers(ipcMain);
  registerBrowserHandlers(ipcMain);
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
