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

// CRITICAL: Disable Chromium privacy features that break OAuth and localStorage for third-party contexts
// These must be set before app.ready
// ThirdPartyStoragePartitioning - Prevents localStorage from being partitioned by top-level site (breaks Descope token storage)
// BlockThirdPartyCookies - Prevents cookies from being blocked in third-party contexts
// PartitionedCookies - Prevents cookies from being partitioned (CHIPS)
app.commandLine.appendSwitch('disable-features', 'ThirdPartyCookieDeprecationTrialSettings,BlockThirdPartyCookies,SameSiteByDefaultCookies,CookiesWithoutSameSiteMustBeSecure,PartitionedCookies,ThirdPartyStoragePartitioning');
app.commandLine.appendSwitch('enable-features', 'AllowSameSiteNoneCookies');

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

  // DEBUG: Log all POST requests to descope to see what's being sent
  webviewSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://api.descope.com/*'] },
    (details, callback) => {
      console.log('[Main] Descope request:', details.method, details.url);
      console.log('[Main] Descope headers:', JSON.stringify(details.requestHeaders, null, 2));
      if (details.uploadData) {
        console.log('[Main] Descope uploadData:', JSON.stringify(details.uploadData));
      } else {
        console.log('[Main] Descope uploadData: NONE');
      }
      // Don't modify anything - just pass through
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  // Log cookies and response details from Descope
  webviewSession.webRequest.onHeadersReceived(
    { urls: ['*://api.descope.com/*'] },
    (details, callback) => {
      const setCookie = details.responseHeaders?.['set-cookie'] || details.responseHeaders?.['Set-Cookie'];
      if (setCookie) {
        console.log('[Main] Descope SET-COOKIE:', JSON.stringify(setCookie));
      }
      // Log response status for key endpoints
      if (details.url.includes('/flow/next') || details.url.includes('/auth/refresh')) {
        console.log('[Main] Descope RESPONSE:', details.url, 'status:', details.statusCode);
      }
      callback({ responseHeaders: details.responseHeaders });
    }
  );

  // Also log what cookies we currently have for descope
  webviewSession.cookies.get({ domain: 'descope.com' }).then(cookies => {
    console.log('[Main] Current Descope cookies:', JSON.stringify(cookies, null, 2));
  });

  // CRITICAL: Enable cross-site cookies for OAuth flows
  // Set sameSite=none to allow third-party cookies
  webviewSession.cookies.set({
    url: 'https://api.descope.com',
    name: 'test',
    value: 'test',
    expirationDate: Math.floor(Date.now() / 1000) + 3600,
    sameSite: 'no_restriction' as any // Allow cross-site cookies
  }).then(() => {
    console.log('[Main] Webview session cookies enabled with cross-site support');
  }).catch(err => {
    console.error('[Main] Failed to set test cookie:', err);
  });

  // Disable security features that block OAuth flows
  webviewSession.setPermissionRequestHandler((webContents, permission, callback) => {
    console.log('[Main] Permission requested:', permission);
    // Allow all permissions for browser preview
    callback(true);
  });

  // Cache for Descope tokens intercepted from flow/next responses
  // This persists across page navigations within the session
  const descopeTokenCache: { sessionJwt?: string; refreshJwt?: string; user?: any } = {};

  // Function to inject cached tokens into webview localStorage
  const injectTokensIntoWebview = async (webContents: Electron.WebContents) => {
    if (!descopeTokenCache.sessionJwt && !descopeTokenCache.refreshJwt) {
      return;
    }

    console.log('[Main] Injecting cached Descope tokens into webview');
    try {
      await webContents.executeJavaScript(`
        (function() {
          const DS = ${JSON.stringify(descopeTokenCache.sessionJwt || '')};
          const DSR = ${JSON.stringify(descopeTokenCache.refreshJwt || '')};
          if (DS) {
            localStorage.setItem('DS', DS);
            console.log('[Injected] Set DS token');
          }
          if (DSR) {
            localStorage.setItem('DSR', DSR);
            console.log('[Injected] Set DSR token');
          }
        })();
      `);
    } catch (err) {
      console.error('[Main] Failed to inject tokens:', err);
    }
  };

  // Track attached debuggers to avoid re-attaching
  const debuggerAttached = new Set<number>();

  // Attach debugger to webContents to intercept network responses
  const attachDebuggerForTokenCapture = (webContents: Electron.WebContents, label: string) => {
    const id = webContents.id;
    if (debuggerAttached.has(id)) return;

    try {
      webContents.debugger.attach('1.3');
      debuggerAttached.add(id);
      console.log(`[Main] Debugger attached to ${label} (id: ${id})`);

      webContents.debugger.sendCommand('Network.enable');

      // Track request IDs for flow/next requests
      const flowNextRequests = new Map<string, string>(); // requestId -> url

      webContents.debugger.on('message', async (event, method, params) => {
        // Track flow/next requests
        if (method === 'Network.requestWillBeSent') {
          const url = params.request?.url || '';
          if (url.includes('api.descope.com') && url.includes('/flow/next')) {
            flowNextRequests.set(params.requestId, url);
            console.log(`[Main] Tracking flow/next request: ${params.requestId}`);
          }
        }

        // When we get a response for flow/next, capture the body
        if (method === 'Network.responseReceived') {
          const requestId = params.requestId;
          if (flowNextRequests.has(requestId)) {
            console.log(`[Main] flow/next response received for ${requestId}`);
            try {
              // Wait a bit for the response body to be available
              await new Promise(resolve => setTimeout(resolve, 100));

              const response = await webContents.debugger.sendCommand('Network.getResponseBody', { requestId });
              const body = response.base64Encoded
                ? Buffer.from(response.body, 'base64').toString('utf8')
                : response.body;

              console.log('[Main] flow/next response body length:', body?.length || 0);

              const data = JSON.parse(body);
              if (data.sessionJwt) {
                descopeTokenCache.sessionJwt = data.sessionJwt;
                console.log('[Main] *** CAPTURED sessionJwt from flow/next ***');
              }
              if (data.refreshJwt) {
                descopeTokenCache.refreshJwt = data.refreshJwt;
                console.log('[Main] *** CAPTURED refreshJwt from flow/next ***');
              }
              if (data.user) {
                descopeTokenCache.user = data.user;
              }

              // If we got tokens, inject them into all webviews with our partition
              if (descopeTokenCache.sessionJwt || descopeTokenCache.refreshJwt) {
                // Find and inject into all webviews
                const allWebContents = require('electron').webContents.getAllWebContents();
                for (const wc of allWebContents) {
                  // Only inject into webviews in our partition
                  const wcUrl = wc.getURL();
                  if (wc.getType() === 'webview' || wcUrl.includes('localhost')) {
                    await injectTokensIntoWebview(wc);
                  }
                }
              }
            } catch (err) {
              console.error('[Main] Failed to get flow/next response body:', err);
            }
            flowNextRequests.delete(requestId);
          }
        }
      });

      webContents.on('destroyed', () => {
        debuggerAttached.delete(id);
        console.log(`[Main] WebContents ${label} destroyed, debugger cleaned up`);
      });
    } catch (err) {
      console.error(`[Main] Failed to attach debugger to ${label}:`, err);
    }
  };

  // Handle webview creation - configure for OAuth flows
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    console.log('[Main] Attaching webview with partition:', params.partition);
    // Configure webview for OAuth (sandbox must be false for webview to work)
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = false; // CHANGED: Allow preload to share context with page
    webPreferences.sandbox = false; // CRITICAL: webview requires sandbox disabled
    webPreferences.webSecurity = false; // CRITICAL: Allow cross-site cookies for OAuth
    // CRITICAL: Enable persistent storage for localStorage/cookies
    webPreferences.partition = params.partition || 'persist:browser';
    webPreferences.enableWebSQL = false;
    webPreferences.experimentalFeatures = true;
  });

  // After webview is attached, set up debugger and event handlers
  mainWindow.webContents.on('did-attach-webview', (event, webviewContents) => {
    console.log('[Main] Webview attached, id:', webviewContents.id);

    // Attach debugger to capture flow/next responses
    attachDebuggerForTokenCapture(webviewContents, 'webview');

    // When webview navigates, inject any cached tokens
    webviewContents.on('did-finish-load', async () => {
      console.log('[Main] Webview finished loading:', webviewContents.getURL());
      // Small delay to ensure page is ready
      await new Promise(resolve => setTimeout(resolve, 200));
      await injectTokensIntoWebview(webviewContents);
    });

    // Handle popups/new windows from within the webview
    webviewContents.setWindowOpenHandler(({ url }) => {
      console.log('[Main] Webview popup requested:', url);
      // Allow OAuth-related popups
      if (url.includes('google.com') || url.includes('descope.com') ||
          url.includes('accounts.google') || url.includes('auth')) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            webPreferences: {
              partition: 'persist:browser',
              webSecurity: false,
            }
          }
        };
      }
      return { action: 'deny' };
    });

    // When a popup window is created from the webview, attach debugger to it too
    webviewContents.on('did-create-window', (childWindow) => {
      console.log('[Main] Webview created popup window:', childWindow.webContents.getURL());
      attachDebuggerForTokenCapture(childWindow.webContents, 'oauth-popup');

      // Also handle OAuth completion in popup
      childWindow.webContents.on('did-navigate', async (event, url) => {
        console.log('[Main] Popup navigated to:', url);
        // After OAuth completes, the popup may have the tokens - inject them
        if (descopeTokenCache.sessionJwt || descopeTokenCache.refreshJwt) {
          await injectTokensIntoWebview(webviewContents);
        }
      });
    });
  });

  // Handle new windows from main window (fallback)
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
