import { WebSocketServer, WebSocket } from 'ws';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { webContents } from 'electron';
import { browserService } from './browser.service';

/**
 * CDP WebSocket Proxy Service
 * Creates a full CDP-compatible endpoint that bridges external tools (like Playwright/Stagehand)
 * to Electron webview's debugger API.
 *
 * Implements:
 * - HTTP endpoints: /json/version, /json/list, /json/protocol
 * - Browser-level WebSocket connections with Target domain support
 * - Page-level WebSocket connections for direct page control
 */
export class CdpProxyService {
  private httpServer: ReturnType<typeof createServer> | null = null;
  private wss: WebSocketServer | null = null;
  private port = 9223;
  private activeConnections = new Map<WebSocket, {
    webContentsId: number;
    sessionId: string;
    targetId: string;
    type: 'browser' | 'page';
  }>();

  // Track attached sessions for Target domain
  private attachedSessions = new Map<string, { targetId: string; sessionId: string }>();
  private sessionCounter = 0;

  /**
   * Start the CDP proxy server (HTTP + WebSocket)
   */
  async start(): Promise<void> {
    if (this.httpServer) {
      console.log('[CDP Proxy] Already running on port', this.port);
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        // Create HTTP server for /json endpoints
        this.httpServer = createServer((req, res) => this.handleHttpRequest(req, res));

        // Create WebSocket server attached to HTTP server
        this.wss = new WebSocketServer({ server: this.httpServer });

        this.wss.on('connection', (ws, req) => {
          console.log('[CDP Proxy] New WebSocket connection:', req.url);
          this.handleWebSocketConnection(ws, req.url || '');
        });

        this.wss.on('error', (error) => {
          console.error('[CDP Proxy] WebSocket server error:', error);
        });

        this.httpServer.on('error', (error: NodeJS.ErrnoException) => {
          if (error.code === 'EADDRINUSE') {
            console.log('[CDP Proxy] Port', this.port, 'in use, trying', this.port + 1);
            this.port++;
            this.httpServer?.close();
            this.httpServer = null;
            this.wss = null;
            // Retry with new port
            this.start().then(resolve).catch(reject);
          } else {
            console.error('[CDP Proxy] HTTP server error:', error);
            reject(error);
          }
        });

        this.httpServer.listen(this.port, () => {
          console.log('[CDP Proxy] Server listening on port', this.port);
          console.log('[CDP Proxy] HTTP endpoints: http://localhost:' + this.port + '/json/version');
          console.log('[CDP Proxy] Browser WS: ws://localhost:' + this.port + '/devtools/browser');
          resolve();
        });
      } catch (error) {
        console.error('[CDP Proxy] Failed to start:', error);
        reject(error);
      }
    });
  }

  /**
   * Handle HTTP requests for CDP discovery endpoints
   */
  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url || '';

    // Set CORS headers for browser access
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    if (url === '/json/version' || url === '/json') {
      // Browser version info - Playwright uses this to get the WebSocket URL
      const version = {
        'Browser': 'Claudette/1.0',
        'Protocol-Version': '1.3',
        'User-Agent': 'Mozilla/5.0 Claudette Electron Webview',
        'V8-Version': process.versions.v8,
        'WebKit-Version': '537.36',
        'webSocketDebuggerUrl': `ws://localhost:${this.port}/devtools/browser`
      };
      res.writeHead(200);
      res.end(JSON.stringify(version));
      return;
    }

    if (url === '/json/list') {
      // List available page targets
      const targets = this.getTargets();
      res.writeHead(200);
      res.end(JSON.stringify(targets));
      return;
    }

    if (url === '/json/protocol') {
      // Return minimal protocol description
      res.writeHead(200);
      res.end(JSON.stringify({ domains: [] }));
      return;
    }

    if (url === '/json/new' || url.startsWith('/json/new?')) {
      // Can't create new tabs in our webview, but return existing target
      const targets = this.getTargets();
      if (targets.length > 0) {
        res.writeHead(200);
        res.end(JSON.stringify(targets[0]));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'No webview available' }));
      }
      return;
    }

    // Unknown endpoint
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  /**
   * Handle WebSocket connections
   */
  private handleWebSocketConnection(ws: WebSocket, url: string): void {
    // Browser-level connection: /devtools/browser or /devtools/browser/{id}
    if (url.startsWith('/devtools/browser')) {
      this.handleBrowserConnection(ws);
      return;
    }

    // Page-level connection: /devtools/page/{targetId}
    const pageMatch = url.match(/\/devtools\/page\/(.+)/);
    if (pageMatch) {
      this.handlePageConnection(ws, pageMatch[1]);
      return;
    }

    console.error('[CDP Proxy] Invalid WebSocket URL:', url);
    ws.close(1002, 'Invalid URL');
  }

  /**
   * Handle browser-level WebSocket connection
   * This is what Playwright connects to via connectOverCDP
   */
  private handleBrowserConnection(ws: WebSocket): void {
    console.log('[CDP Proxy] Browser-level connection established');

    // Find the first available webview to use as the default target
    const sessions = browserService.getRegisteredSessions();
    const sessionId = sessions.length > 0 ? sessions[0] : 'default';
    const webContentsId = browserService.getWebContentsId(sessionId);

    this.activeConnections.set(ws, {
      webContentsId: webContentsId || 0,
      sessionId,
      targetId: sessionId,
      type: 'browser'
    });

    // Handle incoming CDP commands
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await this.handleBrowserCommand(ws, message);
      } catch (error) {
        console.error('[CDP Proxy] Failed to handle browser message:', error);
      }
    });

    ws.on('close', () => {
      console.log('[CDP Proxy] Browser connection closed');
      this.activeConnections.delete(ws);
    });

    ws.on('error', (error) => {
      console.error('[CDP Proxy] Browser WebSocket error:', error);
    });
  }

  /**
   * Handle browser-level CDP commands
   * Implements Target domain for Playwright compatibility
   */
  private async handleBrowserCommand(ws: WebSocket, message: { id: number; method: string; params?: any }): Promise<void> {
    const { id, method, params } = message;
    console.log('[CDP Proxy] Browser command:', method);

    try {
      let result: any;

      switch (method) {
        // Target domain - required for Playwright
        case 'Target.setDiscoverTargets':
          result = {};
          // Send existing targets as discovered
          if (params?.discover) {
            const targets = this.getTargets();
            for (const target of targets) {
              this.sendEvent(ws, 'Target.targetCreated', {
                targetInfo: {
                  targetId: target.id,
                  type: 'page',
                  title: target.title || '',
                  url: target.url,
                  attached: false,
                  browserContextId: 'default'
                }
              });
            }
          }
          break;

        case 'Target.getTargets':
          const targetList = this.getTargets().map(t => ({
            targetId: t.id,
            type: 'page',
            title: t.title || '',
            url: t.url,
            attached: this.attachedSessions.has(t.id),
            browserContextId: 'default'
          }));
          result = { targetInfos: targetList };
          break;

        case 'Target.attachToTarget':
          const targetId = params?.targetId;
          const flatten = params?.flatten ?? true;

          if (!targetId) {
            throw new Error('targetId required');
          }

          const sessionIdStr = `session-${++this.sessionCounter}`;
          this.attachedSessions.set(targetId, { targetId, sessionId: sessionIdStr });

          // Attach debugger to the webview
          const wcId = browserService.getWebContentsId(targetId);
          if (wcId) {
            const wc = webContents.fromId(wcId);
            if (wc && !wc.debugger.isAttached()) {
              try {
                wc.debugger.attach('1.3');
                console.log('[CDP Proxy] Debugger attached for target:', targetId);

                // Forward debugger events to WebSocket
                wc.debugger.on('message', (_event, eventMethod, eventParams) => {
                  if (flatten) {
                    this.sendEvent(ws, eventMethod, eventParams, sessionIdStr);
                  }
                });
              } catch (err) {
                console.log('[CDP Proxy] Debugger attach note:', err);
              }
            }
          }

          // Send attachment confirmation
          this.sendEvent(ws, 'Target.attachedToTarget', {
            sessionId: sessionIdStr,
            targetInfo: {
              targetId,
              type: 'page',
              title: '',
              url: this.getTargetUrl(targetId),
              attached: true,
              browserContextId: 'default'
            },
            waitingForDebugger: false
          });

          result = { sessionId: sessionIdStr };
          break;

        case 'Target.detachFromTarget':
          const detachSessionId = params?.sessionId;
          if (detachSessionId) {
            for (const [tid, session] of this.attachedSessions) {
              if (session.sessionId === detachSessionId) {
                this.attachedSessions.delete(tid);
                break;
              }
            }
          }
          result = {};
          break;

        case 'Target.createBrowserContext':
          // We only have one context (the webview)
          result = { browserContextId: 'default' };
          break;

        case 'Target.disposeBrowserContext':
          result = {};
          break;

        case 'Target.createTarget':
          // Can't create new targets, return existing one
          const existingTargets = this.getTargets();
          if (existingTargets.length > 0) {
            result = { targetId: existingTargets[0].id };
          } else {
            throw new Error('No webview available');
          }
          break;

        case 'Target.closeTarget':
          // Can't close the webview from here
          result = { success: false };
          break;

        case 'Target.setAutoAttach':
          result = {};
          // If autoAttach is enabled, auto-attach to existing targets
          if (params?.autoAttach && params?.waitForDebuggerOnStart === false) {
            const targets = this.getTargets();
            for (const target of targets) {
              if (!this.attachedSessions.has(target.id)) {
                const autoSessionId = `session-${++this.sessionCounter}`;
                this.attachedSessions.set(target.id, { targetId: target.id, sessionId: autoSessionId });

                // Attach debugger
                const autoWcId = browserService.getWebContentsId(target.id);
                if (autoWcId) {
                  const autoWc = webContents.fromId(autoWcId);
                  if (autoWc && !autoWc.debugger.isAttached()) {
                    try {
                      autoWc.debugger.attach('1.3');
                      autoWc.debugger.on('message', (_event, eventMethod, eventParams) => {
                        if (params?.flatten) {
                          this.sendEvent(ws, eventMethod, eventParams, autoSessionId);
                        }
                      });
                    } catch (err) {
                      // Already attached
                    }
                  }
                }

                this.sendEvent(ws, 'Target.attachedToTarget', {
                  sessionId: autoSessionId,
                  targetInfo: {
                    targetId: target.id,
                    type: 'page',
                    title: target.title || '',
                    url: target.url,
                    attached: true,
                    browserContextId: 'default'
                  },
                  waitingForDebugger: false
                });
              }
            }
          }
          break;

        // Browser domain
        case 'Browser.getVersion':
          result = {
            protocolVersion: '1.3',
            product: 'Claudette',
            revision: '1.0',
            userAgent: 'Mozilla/5.0 Claudette Electron Webview',
            jsVersion: process.versions.v8
          };
          break;

        case 'Browser.close':
          // Don't actually close the browser
          result = {};
          break;

        // Forward other commands to the page if we have a session
        default:
          // Check if this is a session-specific command
          const sessionId = params?.sessionId || (message as any).sessionId;
          if (sessionId) {
            result = await this.forwardToPage(sessionId, method, params);
          } else {
            // Try to forward to first available page
            const defaultTarget = this.getTargets()[0];
            if (defaultTarget) {
              result = await this.forwardToPageByTargetId(defaultTarget.id, method, params);
            } else {
              throw new Error(`Unknown browser method: ${method}`);
            }
          }
          break;
      }

      this.sendResponse(ws, id, result);
    } catch (error) {
      console.error('[CDP Proxy] Browser command error:', method, error);
      this.sendError(ws, id, error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Forward a command to a page via session ID
   */
  private async forwardToPage(sessionId: string, method: string, params?: any): Promise<any> {
    // Find the target for this session
    for (const [targetId, session] of this.attachedSessions) {
      if (session.sessionId === sessionId) {
        return this.forwardToPageByTargetId(targetId, method, params);
      }
    }
    throw new Error(`Session not found: ${sessionId}`);
  }

  /**
   * Forward a command to a page via target ID
   */
  private async forwardToPageByTargetId(targetId: string, method: string, params?: any): Promise<any> {
    const webContentsId = browserService.getWebContentsId(targetId);
    if (!webContentsId) {
      throw new Error(`Target not found: ${targetId}`);
    }

    const wc = webContents.fromId(webContentsId);
    if (!wc) {
      throw new Error(`WebContents not found for target: ${targetId}`);
    }

    // Ensure debugger is attached
    if (!wc.debugger.isAttached()) {
      wc.debugger.attach('1.3');
    }

    // Remove sessionId from params before sending to debugger
    const cleanParams = { ...params };
    delete cleanParams.sessionId;

    return wc.debugger.sendCommand(method, cleanParams);
  }

  /**
   * Handle page-level WebSocket connection (direct page control)
   */
  private handlePageConnection(ws: WebSocket, targetId: string): void {
    const webContentsId = browserService.getWebContentsId(targetId);

    if (!webContentsId) {
      console.error('[CDP Proxy] No webview found for target:', targetId);
      ws.close(1002, 'Target not found');
      return;
    }

    const wc = webContents.fromId(webContentsId);
    if (!wc) {
      console.error('[CDP Proxy] WebContents not found:', webContentsId);
      ws.close(1002, 'WebContents not found');
      return;
    }

    console.log('[CDP Proxy] Page-level connection to target:', targetId);

    // Attach debugger
    try {
      if (!wc.debugger.isAttached()) {
        wc.debugger.attach('1.3');
      }
    } catch (error) {
      console.error('[CDP Proxy] Failed to attach debugger:', error);
      ws.close(1002, 'Failed to attach debugger');
      return;
    }

    this.activeConnections.set(ws, {
      webContentsId,
      sessionId: targetId,
      targetId,
      type: 'page'
    });

    // Forward debugger events to WebSocket
    const eventHandler = (_event: Electron.Event, method: string, params: unknown) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ method, params }));
      }
    };
    wc.debugger.on('message', eventHandler);

    // Handle incoming commands
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        const { id, method, params } = message;

        try {
          const result = await wc.debugger.sendCommand(method, params || {});
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ id, result }));
          }
        } catch (error) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              id,
              error: {
                code: -32000,
                message: error instanceof Error ? error.message : String(error),
              },
            }));
          }
        }
      } catch (error) {
        console.error('[CDP Proxy] Failed to parse page message:', error);
      }
    });

    ws.on('close', () => {
      console.log('[CDP Proxy] Page connection closed:', targetId);
      wc.debugger.off('message', eventHandler);
      this.activeConnections.delete(ws);
    });
  }

  /**
   * Send a CDP response
   */
  private sendResponse(ws: WebSocket, id: number, result: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ id, result: result || {} }));
    }
  }

  /**
   * Send a CDP error
   */
  private sendError(ws: WebSocket, id: number, message: string): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        id,
        error: { code: -32000, message }
      }));
    }
  }

  /**
   * Send a CDP event
   */
  private sendEvent(ws: WebSocket, method: string, params: any, sessionId?: string): void {
    if (ws.readyState === WebSocket.OPEN) {
      const event: any = { method, params };
      if (sessionId) {
        event.sessionId = sessionId;
      }
      ws.send(JSON.stringify(event));
    }
  }

  /**
   * Get URL for a target
   */
  private getTargetUrl(targetId: string): string {
    const wcId = browserService.getWebContentsId(targetId);
    if (wcId) {
      const wc = webContents.fromId(wcId);
      return wc?.getURL() || '';
    }
    return '';
  }

  /**
   * Stop the CDP proxy server
   */
  stop(): void {
    // Close all active connections
    for (const [ws] of this.activeConnections) {
      ws.close();
    }
    this.activeConnections.clear();
    this.attachedSessions.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }

    console.log('[CDP Proxy] Server stopped');
  }

  /**
   * Get the WebSocket URL for connecting to a specific webview
   */
  getWebSocketUrl(sessionId: string): string | null {
    const webContentsId = browserService.getWebContentsId(sessionId);
    if (!webContentsId) {
      return null;
    }
    return `ws://localhost:${this.port}/devtools/page/${sessionId}`;
  }

  /**
   * Get the browser-level WebSocket URL (for Playwright connectOverCDP)
   */
  getBrowserWebSocketUrl(): string {
    return `ws://localhost:${this.port}/devtools/browser`;
  }

  /**
   * Get the HTTP endpoint URL (for Playwright connectOverCDP)
   */
  getHttpEndpoint(): string {
    return `http://localhost:${this.port}`;
  }

  /**
   * Get CDP targets list (for /json/list endpoint compatibility)
   */
  getTargets(): Array<{ id: string; type: string; title?: string; url: string; webSocketDebuggerUrl: string }> {
    const targets: Array<{ id: string; type: string; title?: string; url: string; webSocketDebuggerUrl: string }> = [];

    const sessions = browserService.getRegisteredSessions();
    for (const sessionId of sessions) {
      const webContentsId = browserService.getWebContentsId(sessionId);
      if (webContentsId) {
        const wc = webContents.fromId(webContentsId);
        if (wc) {
          targets.push({
            id: sessionId,
            type: 'page',
            title: wc.getTitle?.() || '',
            url: wc.getURL() || '',
            webSocketDebuggerUrl: `ws://localhost:${this.port}/devtools/page/${sessionId}`,
          });
        }
      }
    }

    return targets;
  }

  /**
   * Check if the proxy is running
   */
  isRunning(): boolean {
    return this.httpServer !== null;
  }

  /**
   * Get the proxy port
   */
  getPort(): number {
    return this.port;
  }
}

export const cdpProxyService = new CdpProxyService();
