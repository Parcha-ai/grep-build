import { WebSocketServer, WebSocket } from 'ws';
import { webContents } from 'electron';
import { browserService } from './browser.service';

/**
 * CDP WebSocket Proxy Service
 * Creates a WebSocket server that bridges external CDP clients (like Stagehand)
 * to Electron webview's debugger API
 */
export class CdpProxyService {
  private wss: WebSocketServer | null = null;
  private port = 9223; // Use different port than Electron's remote debugging
  private activeConnections = new Map<WebSocket, { webContentsId: number; sessionId: string }>();

  /**
   * Start the CDP proxy server
   */
  async start(): Promise<void> {
    if (this.wss) {
      console.log('[CDP Proxy] Already running on port', this.port);
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ port: this.port });

        this.wss.on('listening', () => {
          console.log('[CDP Proxy] WebSocket server listening on port', this.port);
          resolve();
        });

        this.wss.on('connection', (ws, req) => {
          console.log('[CDP Proxy] New connection from:', req.url);
          this.handleConnection(ws, req.url || '');
        });

        this.wss.on('error', (error) => {
          console.error('[CDP Proxy] Server error:', error);
          if (!this.wss) {
            reject(error);
          }
        });
      } catch (error) {
        console.error('[CDP Proxy] Failed to start:', error);
        reject(error);
      }
    });
  }

  /**
   * Stop the CDP proxy server
   */
  stop(): void {
    if (this.wss) {
      // Close all active connections
      for (const [ws] of this.activeConnections) {
        ws.close();
      }
      this.activeConnections.clear();

      this.wss.close();
      this.wss = null;
      console.log('[CDP Proxy] Server stopped');
    }
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
   * Get CDP targets list (for /json/list endpoint compatibility)
   */
  getTargets(): Array<{ id: string; type: string; url: string; webSocketDebuggerUrl: string }> {
    const targets: Array<{ id: string; type: string; url: string; webSocketDebuggerUrl: string }> = [];

    // Get all registered webviews from browserService
    const sessions = browserService.getRegisteredSessions();
    for (const sessionId of sessions) {
      const webContentsId = browserService.getWebContentsId(sessionId);
      if (webContentsId) {
        const wc = webContents.fromId(webContentsId);
        if (wc) {
          targets.push({
            id: sessionId,
            type: 'webview',
            url: wc.getURL() || '',
            webSocketDebuggerUrl: `ws://localhost:${this.port}/devtools/page/${sessionId}`,
          });
        }
      }
    }

    return targets;
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket, url: string): void {
    // Extract session ID from URL (format: /devtools/page/{sessionId})
    const match = url.match(/\/devtools\/page\/(.+)/);
    if (!match) {
      console.error('[CDP Proxy] Invalid URL format:', url);
      ws.close(1002, 'Invalid URL format');
      return;
    }

    const sessionId = match[1];
    const webContentsId = browserService.getWebContentsId(sessionId);

    if (!webContentsId) {
      console.error('[CDP Proxy] No webview found for session:', sessionId);
      ws.close(1002, 'Webview not found');
      return;
    }

    const wc = webContents.fromId(webContentsId);
    if (!wc) {
      console.error('[CDP Proxy] WebContents not found for ID:', webContentsId);
      ws.close(1002, 'WebContents not found');
      return;
    }

    console.log('[CDP Proxy] Connecting to webview:', sessionId, '-> webContentsId:', webContentsId);

    // Attach debugger if not already attached
    try {
      if (!wc.debugger.isAttached()) {
        wc.debugger.attach('1.3');
        console.log('[CDP Proxy] Debugger attached to webContents:', webContentsId);
      }
    } catch (error) {
      console.error('[CDP Proxy] Failed to attach debugger:', error);
      ws.close(1002, 'Failed to attach debugger');
      return;
    }

    // Store connection info
    this.activeConnections.set(ws, { webContentsId, sessionId });

    // Forward CDP events from debugger to WebSocket
    const eventHandler = (event: Electron.Event, method: string, params: unknown) => {
      if (ws.readyState === WebSocket.OPEN) {
        const message = JSON.stringify({ method, params });
        ws.send(message);
      }
    };
    wc.debugger.on('message', eventHandler);

    // Forward CDP commands from WebSocket to debugger
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        const { id, method, params } = message;

        console.log('[CDP Proxy] Command:', method);

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
        console.error('[CDP Proxy] Failed to parse message:', error);
      }
    });

    // Clean up on close
    ws.on('close', () => {
      console.log('[CDP Proxy] Connection closed for session:', sessionId);
      wc.debugger.off('message', eventHandler);
      this.activeConnections.delete(ws);
    });

    ws.on('error', (error) => {
      console.error('[CDP Proxy] WebSocket error:', error);
    });
  }

  /**
   * Check if the proxy is running
   */
  isRunning(): boolean {
    return this.wss !== null;
  }

  /**
   * Get the proxy port
   */
  getPort(): number {
    return this.port;
  }
}

export const cdpProxyService = new CdpProxyService();
