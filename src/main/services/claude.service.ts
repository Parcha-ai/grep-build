import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ImageBlockParam, TextBlockParam } from '@anthropic-ai/sdk/resources';
import { z } from 'zod';
import Store from 'electron-store';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ChatMessage, ToolCall, Session, QuestionRequest, QuestionResponse, Attachment } from '../../shared/types';
import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import { browserService } from './browser.service';

interface StreamEvent {
  type: 'text_delta' | 'thinking_delta' | 'tool_use' | 'tool_result' | 'message_complete' | 'error' | 'system' | 'permission_request';
  content?: string;
  toolCall?: ToolCall;
  result?: unknown;
  message?: ChatMessage;
  error?: string;
  systemInfo?: {
    tools: string[];
    model: string;
  };
  // Permission request fields
  sessionId?: string;
  requestId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  approvalMessage?: string; // Message about why approval is needed
}

interface PendingQuestion {
  resolve: (answers: Record<string, string>) => void;
  reject: (error: Error) => void;
}

export class ClaudeService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private store: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sessionStore: any;
  private activeQueries: Map<string, AbortController> = new Map();
  private pendingQuestions: Map<string, PendingQuestion> = new Map();
  private mainWindow: BrowserWindow | null = null;
  private browserMcpServers: Map<string, any> = new Map();

  constructor() {
    this.store = new Store({ name: 'claudette-settings' });
    this.sessionStore = new Store({ name: 'claudette-sessions' });
  }

  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  getApiKey(): string | undefined {
    return this.store.get('anthropicApiKey') as string | undefined;
  }

  // Get available Claude models
  getAvailableModels(): Array<{ id: string; name: string; description: string }> {
    return [
      {
        id: 'claude-opus-4-5-20251101',
        name: 'Opus 4.5',
        description: 'Most capable model - best for complex tasks'
      },
      {
        id: 'claude-sonnet-4-5-20250929',
        name: 'Sonnet 4.5',
        description: 'Balanced performance and speed'
      },
      {
        id: 'claude-sonnet-4-20250514',
        name: 'Sonnet 4',
        description: 'Fast and capable'
      },
      {
        id: 'claude-3-5-haiku-20241022',
        name: 'Haiku 3.5',
        description: 'Fastest model - best for simple tasks'
      },
    ];
  }

  // Get or create MCP server with browser snapshot tool for session
  private getBrowserMcpServer(sessionId: string) {
    if (this.browserMcpServers.has(sessionId)) {
      return this.browserMcpServers.get(sessionId);
    }

    const browserSnapshotTool = tool(
      'BrowserSnapshot',
      'Capture a snapshot of a webpage in the browser preview. Takes a screenshot and extracts the HTML content. Use this to inspect web pages, debug UI issues, or verify how pages render.',
      {
        url: z.string().describe('The URL to navigate to and capture'),
        waitForLoad: z.boolean().optional().describe('Wait for page to fully load before capturing (default: true)'),
        waitTime: z.number().optional().describe('Time to wait in milliseconds after navigation (default: 2000ms)'),
      },
      async (args) => {
        try {
          const { url, waitForLoad = true, waitTime = 2000 } = args;

          console.log('[Claude Service] Capturing browser snapshot:', url);

          // Navigate to URL first
          await browserService.navigate(sessionId, url);

          // Wait for page to load if requested (configurable timeout)
          if (waitForLoad && waitTime > 0) {
            await new Promise(resolve => setTimeout(resolve, Math.min(waitTime, 10000)));
          }

          // Capture snapshot
          const snapshot = await browserService.captureSnapshot(sessionId, url);

          // Clean up the screenshot data - strip any data URL prefix
          let screenshotData = snapshot.screenshot;
          if (screenshotData.startsWith('data:')) {
            // Handle multiple data URL formats: data:image/png;base64, or data:image/jpeg;base64, etc.
            const base64Index = screenshotData.indexOf('base64,');
            if (base64Index !== -1) {
              screenshotData = screenshotData.substring(base64Index + 7);
            }
          }

          // Validate screenshot data
          if (!screenshotData || screenshotData.length === 0) {
            return {
              content: [{
                type: 'text',
                text: `Captured snapshot of ${url} but screenshot failed to capture. HTML is available:\n\n${snapshot.html.slice(0, 10000)}${snapshot.html.length > 10000 ? '...(truncated)' : ''}`,
              }],
            };
          }

          // Return snapshot info with image (MCP format)
          return {
            content: [
              {
                type: 'text',
                text: `Captured snapshot of ${url}\n\nHTML Preview:\n${snapshot.html.slice(0, 10000)}${snapshot.html.length > 10000 ? '...(truncated)' : ''}`,
              },
              {
                type: 'image',
                data: screenshotData,
                mimeType: 'image/png',
              },
            ],
          };
        } catch (error) {
          console.error('[Claude Service] Browser snapshot error:', error);
          return {
            content: [{
              type: 'text',
              text: `Failed to capture browser snapshot: ${error instanceof Error ? error.message : String(error)}`,
            }],
            isError: true,
          };
        }
      }
    );

    // BrowserNavigate tool - simpler navigation without snapshot
    const browserNavigateTool = tool(
      'BrowserNavigate',
      'Navigate the browser preview to a URL without capturing a snapshot. Use this when you just want to go to a page.',
      {
        url: z.string().describe('The URL to navigate to'),
      },
      async (args) => {
        try {
          const { url } = args;
          console.log('[Claude Service] Navigating browser to:', url);
          await browserService.navigate(sessionId, url);
          return {
            content: [{
              type: 'text',
              text: `Navigated to ${url}`,
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Failed to navigate: ${error instanceof Error ? error.message : String(error)}`,
            }],
            isError: true,
          };
        }
      }
    );

    // BrowserClick tool - click on elements
    const browserClickTool = tool(
      'BrowserClick',
      'Click on an element in the browser preview using a CSS selector. Use this to interact with buttons, links, or other clickable elements.',
      {
        selector: z.string().describe('CSS selector for the element to click (e.g., "button.submit", "#login-btn", "a[href=\'/about\']")'),
      },
      async (args) => {
        try {
          const { selector } = args;
          console.log('[Claude Service] Clicking element:', selector);
          const result = await browserService.click(sessionId, selector);
          if (result.success) {
            return {
              content: [{
                type: 'text',
                text: `Clicked element: ${selector}`,
              }],
            };
          } else {
            return {
              content: [{
                type: 'text',
                text: `Failed to click: ${result.error}`,
              }],
              isError: true,
            };
          }
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Failed to click: ${error instanceof Error ? error.message : String(error)}`,
            }],
            isError: true,
          };
        }
      }
    );

    // BrowserType tool - type text into inputs
    const browserTypeTool = tool(
      'BrowserType',
      'Type text into an input field or textarea in the browser preview using a CSS selector.',
      {
        selector: z.string().describe('CSS selector for the input element (e.g., "input[name=\'email\']", "#search-box", "textarea.comment")'),
        text: z.string().describe('The text to type into the element'),
      },
      async (args) => {
        try {
          const { selector, text } = args;
          console.log('[Claude Service] Typing into element:', selector);
          const result = await browserService.type(sessionId, selector, text);
          if (result.success) {
            return {
              content: [{
                type: 'text',
                text: `Typed "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}" into ${selector}`,
              }],
            };
          } else {
            return {
              content: [{
                type: 'text',
                text: `Failed to type: ${result.error}`,
              }],
              isError: true,
            };
          }
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Failed to type: ${error instanceof Error ? error.message : String(error)}`,
            }],
            isError: true,
          };
        }
      }
    );

    // BrowserExtract tool - extract text from page
    const browserExtractTool = tool(
      'BrowserExtract',
      'Extract text content from the browser preview. Can extract from the whole page or a specific element using a CSS selector.',
      {
        selector: z.string().optional().describe('Optional CSS selector to extract from specific element. If not provided, extracts all page text.'),
      },
      async (args) => {
        try {
          const { selector } = args;
          console.log('[Claude Service] Extracting text:', selector || 'full page');
          const result = await browserService.extractText(sessionId, selector);
          if (result.success && result.text !== undefined) {
            const truncated = result.text.length > 5000;
            return {
              content: [{
                type: 'text',
                text: `Extracted text${selector ? ` from ${selector}` : ''}:\n\n${result.text.slice(0, 5000)}${truncated ? '\n\n...(truncated)' : ''}`,
              }],
            };
          } else {
            return {
              content: [{
                type: 'text',
                text: `Failed to extract: ${result.error}`,
              }],
              isError: true,
            };
          }
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Failed to extract: ${error instanceof Error ? error.message : String(error)}`,
            }],
            isError: true,
          };
        }
      }
    );

    // BrowserGetInfo tool - get current page info
    const browserGetInfoTool = tool(
      'BrowserGetInfo',
      'Get information about the current page in the browser preview (URL, title).',
      {},
      async () => {
        try {
          console.log('[Claude Service] Getting page info');
          const result = await browserService.getPageInfo(sessionId);
          if (result.success) {
            return {
              content: [{
                type: 'text',
                text: `Current page:\nURL: ${result.url}\nTitle: ${result.title}`,
              }],
            };
          } else {
            return {
              content: [{
                type: 'text',
                text: `Failed to get page info: ${result.error}`,
              }],
              isError: true,
            };
          }
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Failed to get page info: ${error instanceof Error ? error.message : String(error)}`,
            }],
            isError: true,
          };
        }
      }
    );

    // BrowserGetDOM tool - get full DOM without truncation
    const browserGetDOMTool = tool(
      'BrowserGetDOM',
      'Get the complete HTML DOM of the current page without truncation. Use this when you need to find elements that may not be visible in the initial snapshot preview.',
      {
        selector: z.string().optional().describe('Optional CSS selector to get HTML of specific element instead of whole document'),
      },
      async (args) => {
        try {
          const { selector } = args;
          console.log('[Claude Service] Getting DOM:', selector || 'full page');
          const result = await browserService.getDOM(sessionId);

          if (!result.success || !result.html) {
            return {
              content: [{
                type: 'text',
                text: `Failed to get DOM: ${result.error || 'Unknown error'}`,
              }],
              isError: true,
            };
          }

          let html = result.html;

          // If selector provided, extract that element only
          if (selector) {
            const extractResult = await browserService.executeScript(
              sessionId,
              `document.querySelector(${JSON.stringify(selector)})?.outerHTML || ''`
            );
            if (extractResult.success && extractResult.result) {
              html = String(extractResult.result);
            }
          }

          // Cap at reasonable limit to avoid overwhelming Claude
          const maxLength = 50000;
          const truncated = html.length > maxLength;

          return {
            content: [{
              type: 'text',
              text: `DOM HTML${selector ? ` for ${selector}` : ''}:\n\n${html.slice(0, maxLength)}${truncated ? '\n\n...(truncated - use selector to narrow scope)' : ''}`,
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Failed to get DOM: ${error instanceof Error ? error.message : String(error)}`,
            }],
            isError: true,
          };
        }
      }
    );

    // BrowserEnableDebugging tool - enable console and network capture
    const browserEnableDebuggingTool = tool(
      'BrowserEnableDebugging',
      'Enable browser debugging to capture console logs and network requests. Call this before trying to read console logs or network requests.',
      {},
      async () => {
        try {
          console.log('[Claude Service] Enabling browser debugging');
          const result = await browserService.enableDebugging(sessionId);
          if (result.success) {
            return {
              content: [{
                type: 'text',
                text: 'Browser debugging enabled. Console logs and network requests are now being captured.',
              }],
            };
          } else {
            return {
              content: [{
                type: 'text',
                text: `Failed to enable debugging: ${result.error}`,
              }],
              isError: true,
            };
          }
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Failed to enable debugging: ${error instanceof Error ? error.message : String(error)}`,
            }],
            isError: true,
          };
        }
      }
    );

    // BrowserGetConsoleLogs tool - get captured console logs
    const browserGetConsoleLogsTool = tool(
      'BrowserGetConsoleLogs',
      'Get captured console logs from the browser. Must call BrowserEnableDebugging first. Can filter by type (log, warning, error, info, debug) and limit the number of results.',
      {
        type: z.string().optional().describe('Filter by log type: "log", "warning", "error", "info", or "debug"'),
        limit: z.number().optional().describe('Maximum number of logs to return (default: all)'),
      },
      async (args) => {
        try {
          const { type, limit } = args;
          const logType = type as 'log' | 'warning' | 'error' | 'info' | 'debug' | undefined;
          console.log('[Claude Service] Getting console logs:', { type: logType, limit });
          const logs = browserService.getConsoleLogs(sessionId, { type: logType, limit });

          if (logs.length === 0) {
            return {
              content: [{
                type: 'text',
                text: 'No console logs captured. Make sure to call BrowserEnableDebugging first and that the page has logged something.',
              }],
            };
          }

          const formatted = logs.map(log => {
            let line = `[${log.type.toUpperCase()}] ${log.text}`;
            if (log.url) {
              line += `\n  at ${log.url}${log.lineNumber !== undefined ? `:${log.lineNumber}` : ''}`;
            }
            return line;
          }).join('\n\n');

          return {
            content: [{
              type: 'text',
              text: `Console logs (${logs.length}):\n\n${formatted}`,
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Failed to get console logs: ${error instanceof Error ? error.message : String(error)}`,
            }],
            isError: true,
          };
        }
      }
    );

    // BrowserGetNetworkRequests tool - get captured network requests
    const browserGetNetworkRequestsTool = tool(
      'BrowserGetNetworkRequests',
      'Get captured network requests from the browser. Must call BrowserEnableDebugging first. Can filter by URL pattern, HTTP method, and status code.',
      {
        urlPattern: z.string().optional().describe('Regex pattern to filter URLs (e.g., "api", "\.json$")'),
        method: z.string().optional().describe('Filter by HTTP method (GET, POST, etc.)'),
        status: z.number().optional().describe('Filter by status code (e.g., 200, 404, 500)'),
        limit: z.number().optional().describe('Maximum number of requests to return (default: all)'),
      },
      async (args) => {
        try {
          const { urlPattern, method, status, limit } = args;
          console.log('[Claude Service] Getting network requests:', { urlPattern, method, status, limit });
          const requests = browserService.getNetworkRequests(sessionId, { urlPattern, method, status, limit });

          if (requests.length === 0) {
            return {
              content: [{
                type: 'text',
                text: 'No network requests captured. Make sure to call BrowserEnableDebugging first and that the page has made network requests.',
              }],
            };
          }

          const formatted = requests.map(req => {
            let line = `${req.method} ${req.url}`;
            if (req.status !== undefined) {
              line += ` → ${req.status} ${req.statusText || ''}`;
            }
            if (req.timing?.duration !== undefined) {
              line += ` (${req.timing.duration}ms)`;
            }
            if (req.responseSize !== undefined) {
              line += ` [${req.responseSize} bytes]`;
            }
            return line;
          }).join('\n');

          return {
            content: [{
              type: 'text',
              text: `Network requests (${requests.length}):\n\n${formatted}`,
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Failed to get network requests: ${error instanceof Error ? error.message : String(error)}`,
            }],
            isError: true,
          };
        }
      }
    );

    // BrowserGetResponseBody tool - get response body for a network request
    const browserGetResponseBodyTool = tool(
      'BrowserGetResponseBody',
      'Get the response body for a specific network request. Use BrowserGetNetworkRequests first to find the requestId.',
      {
        requestId: z.string().describe('The requestId from BrowserGetNetworkRequests'),
      },
      async (args) => {
        try {
          const { requestId } = args;
          console.log('[Claude Service] Getting response body:', requestId);
          const result = await browserService.getResponseBody(sessionId, requestId);

          if (result.success && result.body !== undefined) {
            let body = result.body;
            if (result.base64Encoded) {
              body = Buffer.from(result.body, 'base64').toString('utf-8');
            }
            const truncated = body.length > 10000;
            return {
              content: [{
                type: 'text',
                text: `Response body:\n\n${body.slice(0, 10000)}${truncated ? '\n\n...(truncated)' : ''}`,
              }],
            };
          } else {
            return {
              content: [{
                type: 'text',
                text: `Failed to get response body: ${result.error || 'Response not available (may have been evicted from browser cache)'}`,
              }],
              isError: true,
            };
          }
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Failed to get response body: ${error instanceof Error ? error.message : String(error)}`,
            }],
            isError: true,
          };
        }
      }
    );

    // BrowserClearLogs tool - clear console logs and network requests
    const browserClearLogsTool = tool(
      'BrowserClearLogs',
      'Clear captured console logs and/or network requests. Useful to start fresh when debugging.',
      {
        console: z.boolean().optional().describe('Clear console logs (default: true)'),
        network: z.boolean().optional().describe('Clear network requests (default: true)'),
      },
      async (args) => {
        const { console: clearConsole = true, network: clearNetwork = true } = args;
        const cleared: string[] = [];

        if (clearConsole) {
          browserService.clearConsoleLogs(sessionId);
          cleared.push('console logs');
        }
        if (clearNetwork) {
          browserService.clearNetworkRequests(sessionId);
          cleared.push('network requests');
        }

        return {
          content: [{
            type: 'text',
            text: `Cleared ${cleared.join(' and ')}.`,
          }],
        };
      }
    );

    const mcpServer = createSdkMcpServer({
      name: 'claudette-browser',
      version: '1.0.0',
      tools: [
        browserSnapshotTool,
        browserNavigateTool,
        browserClickTool,
        browserTypeTool,
        browserExtractTool,
        browserGetInfoTool,
        browserGetDOMTool,
        browserEnableDebuggingTool,
        browserGetConsoleLogsTool,
        browserGetNetworkRequestsTool,
        browserGetResponseBodyTool,
        browserClearLogsTool,
      ],
    });

    this.browserMcpServers.set(sessionId, mcpServer);
    return mcpServer;
  }

  setApiKey(apiKey: string): void {
    this.store.set('anthropicApiKey', apiKey);
  }

  // Handle question responses from the renderer
  handleQuestionResponse(response: QuestionResponse): void {
    const pending = this.pendingQuestions.get(response.requestId);
    if (pending) {
      pending.resolve(response.answers);
      this.pendingQuestions.delete(response.requestId);
    }
  }

  // Ask user a question via the renderer
  private async askUserQuestion(sessionId: string, questions: unknown[]): Promise<Record<string, string>> {
    const requestId = `question-${Date.now()}-${Math.random()}`;

    return new Promise((resolve, reject) => {
      // Store the promise resolve/reject functions
      this.pendingQuestions.set(requestId, { resolve, reject });

      // Send question request to renderer
      if (this.mainWindow) {
        const request: QuestionRequest = {
          sessionId,
          requestId,
          questions: questions as any, // SDK types match our Question type
        };
        this.mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_QUESTION_REQUEST, request);
      } else {
        reject(new Error('Main window not available'));
      }

      // Set a timeout in case the user never responds
      setTimeout(() => {
        if (this.pendingQuestions.has(requestId)) {
          this.pendingQuestions.delete(requestId);
          reject(new Error('Question response timeout'));
        }
      }, 5 * 60 * 1000); // 5 minute timeout
    });
  }

  async *streamMessage(
    sessionId: string,
    userMessage: string,
    attachments?: Attachment[],
    permissionMode?: string,
    thinkingMode?: string,
    model?: string
  ): AsyncGenerator<StreamEvent> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      yield { type: 'error', error: 'API key not configured. Please set your Anthropic API key in settings.' };
      return;
    }

    // Get session for working directory
    const session = this.sessionStore.get(`sessions.${sessionId}`) as Session | undefined;
    if (!session) {
      yield { type: 'error', error: 'Session not found' };
      return;
    }

    // Create abort controller for cancellation
    const abortController = new AbortController();
    this.activeQueries.set(sessionId, abortController);

    try {
      // Check if this session has been used before (has SDK session ID stored)
      // Try new location first, then fall back to old location for backwards compatibility
      const sdkSessionId = this.sessionStore.get(`sdkSessionMappings.${sessionId}`) as string | undefined
        || this.sessionStore.get(`sessions.${sessionId}.sdkSessionId`) as string | undefined;

      // Validate and cast permission mode to SDK type
      const validModes = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk'] as const;
      type SDKPermissionMode = typeof validModes[number];
      const sdkPermissionMode: SDKPermissionMode = validModes.includes(permissionMode as SDKPermissionMode)
        ? (permissionMode as SDKPermissionMode)
        : 'acceptEdits';

      // Check if bypassPermissions mode requires the danger flag
      const requiresDangerFlag = sdkPermissionMode === 'bypassPermissions';

      // Map thinking mode to token counts
      // off = undefined (no extended thinking)
      // thinking = 10000 tokens
      // ultrathink = 100000 tokens
      const thinkingTokensMap: Record<string, number | undefined> = {
        off: undefined,
        thinking: 10000,
        ultrathink: 100000,
      };
      const maxThinkingTokens = thinkingTokensMap[thinkingMode || 'thinking'];

      // Build prompt with attachments
      const imageAttachments = attachments?.filter(a => a.type === 'image') || [];
      const domElementAttachments = attachments?.filter(a => a.type === 'dom_element') || [];
      const hasImages = imageAttachments.length > 0;
      const hasDomElements = domElementAttachments.length > 0;

      console.log('[Claude Service] streamMessage - Attachments received:', attachments?.length || 0);
      console.log('[Claude Service] streamMessage - Image attachments:', imageAttachments.length);
      console.log('[Claude Service] streamMessage - DOM element attachments:', domElementAttachments.length);
      if (attachments) {
        attachments.forEach((a, i) => {
          console.log(`[Claude Service] Attachment ${i}: type=${a.type}, name=${a.name}, content exists=${!!a.content}, content length=${a.content?.length || 0}`);
        });
      }

      // Build the text message with DOM element context prepended
      let fullTextMessage = userMessage;
      if (hasDomElements) {
        const domContext = domElementAttachments.map((el, i) => {
          return `<selected-element index="${i + 1}" selector="${el.name}">\n${el.content}\n</selected-element>`;
        }).join('\n\n');
        fullTextMessage = `${domContext}\n\n${userMessage}`;
        console.log('[Claude Service] Added DOM element context to message');
      }

      if (hasImages) {
        console.log('[Claude Service] Will use multimodal prompt with images');
        imageAttachments.forEach((a, i) => {
          console.log(`[Claude Service] Image ${i}: name=${a.name}, base64 length=${a.content?.length || 0}, first 50 chars=${a.content?.slice(0, 50)}`);
        });
      }

      // Create async generator for prompt with images
      async function* createPromptWithImages(): AsyncIterable<SDKUserMessage> {
        const content: (TextBlockParam | ImageBlockParam)[] = [
          { type: 'text', text: fullTextMessage }
        ];

        for (const attachment of imageAttachments) {
          // Determine media type from filename or default to png
          const ext = attachment.name.split('.').pop()?.toLowerCase();
          const mediaType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
            : ext === 'gif' ? 'image/gif'
            : ext === 'webp' ? 'image/webp'
            : 'image/png';

          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: attachment.content,
            },
          });
        }

        yield {
          type: 'user',
          message: {
            role: 'user',
            content,
          },
          parent_tool_use_id: null,
          session_id: sdkSessionId || '',
        } as SDKUserMessage;
      }

      const prompt = hasImages ? createPromptWithImages() : fullTextMessage;
      console.log('[Claude Service] Using prompt type:', hasImages ? 'multimodal (async generator)' : 'text string');
      if (hasDomElements && !hasImages) {
        console.log('[Claude Service] DOM element context included in text prompt');
      }

      // Use the Claude Agent SDK query function with Claude Code's system prompt
      const messages = query({
        prompt,
        options: {
          cwd: session.worktreePath || session.repoPath || process.cwd(),
          abortController,
          permissionMode: sdkPermissionMode,
          ...(requiresDangerFlag ? { allowDangerouslySkipPermissions: true } : {}),
          includePartialMessages: true,
          // Use selected model or default to Claude Sonnet 4.5
          model: model || 'claude-sonnet-4-5-20250929',
          ...(maxThinkingTokens ? { maxThinkingTokens } : {}),
          // Use Claude Code's system prompt preset
          systemPrompt: {
            type: 'preset',
            preset: 'claude_code',
          },
          // Enable CLAUDE.md reading from project directory
          settingSources: ['project'],
          // Pass environment with API key
          env: {
            ...process.env,
            ANTHROPIC_API_KEY: apiKey,
          },
          // Resume previous conversation if we have an SDK session ID
          ...(sdkSessionId ? { resume: sdkSessionId } : {}),
          // Add custom browser tools via MCP server (controls internal webview)
          mcpServers: {
            'claudette-browser': this.getBrowserMcpServer(sessionId),
          },
          // Handle tool permission requests
          canUseTool: async (toolName: string, input: any) => {
            // Handle AskUserQuestion tool
            if (toolName === 'AskUserQuestion' && input.questions) {
              try {
                const answers = await this.askUserQuestion(sessionId, input.questions);
                return {
                  behavior: 'allow',
                  updatedInput: {
                    ...input,
                    answers,
                  },
                };
              } catch (error) {
                console.error('[Claude Service] Error asking user question:', error);
                return {
                  behavior: 'deny',
                  message: error instanceof Error ? error.message : 'Failed to get user response',
                };
              }
            }

            // For other tools, use default behavior
            return { behavior: 'allow', updatedInput: input };
          },
        },
      });

      let fullContent = '';
      const toolCalls: ToolCall[] = [];

      // Batching for stream events to reduce render overhead
      let textBuffer = '';
      let thinkingBuffer = '';
      let lastFlush = Date.now();
      const FLUSH_INTERVAL_MS = 100; // Batch updates every 100ms for smoother rendering

      const flushBuffers = () => {
        if (textBuffer) {
          fullContent += textBuffer;
          const content = textBuffer;
          textBuffer = '';
          return { text: content };
        }
        if (thinkingBuffer) {
          const content = thinkingBuffer;
          thinkingBuffer = '';
          return { thinking: content };
        }
        return null;
      };

      for await (const msg of messages) {
        if (abortController.signal.aborted) {
          yield { type: 'error', error: 'Query cancelled' };
          return;
        }

        // Log all message types with more detail to debug streaming
        console.log('[Claude SDK] Message:', msg.type, JSON.stringify(msg).slice(0, 200));

        // Handle different message types from the SDK
        switch (msg.type) {
          case 'system': {
            // System message with tool/model info - also contains SDK session ID
            const systemMsg = msg as SDKMessage & {
              session_id?: string;
              tools?: string[];
              model?: string;
            };

            // Store the SDK session ID for future resume calls in separate mappings object
            if (systemMsg.session_id) {
              this.sessionStore.set(`sdkSessionMappings.${sessionId}`, systemMsg.session_id);
            }

            yield {
              type: 'system',
              systemInfo: {
                tools: systemMsg.tools || [],
                model: systemMsg.model || '',
              },
            };
            break;
          }

          case 'assistant': {
            // Full assistant message - only process tool_use blocks here
            // Text and thinking are handled via stream_event for real-time streaming
            const assistantMsg = msg as SDKMessage & { message?: { content?: Array<{ type: string; text?: string; thinking?: string; name?: string; id?: string; input?: Record<string, unknown> }> } };
            if (assistantMsg.message?.content) {
              // Log all block types to debug tool detection
              const blockTypes = assistantMsg.message.content.map(b => `${b.type}${b.type === 'tool_use' ? ':' + (b.name || '?') : ''}`).join(', ');
              console.log('[Claude SDK] Assistant content blocks:', blockTypes);

              for (const block of assistantMsg.message.content) {
                if (block.type === 'text' && block.text) {
                  // Only use assistant message text if we somehow missed it in stream_event
                  // This can happen if includePartialMessages doesn't capture everything
                  if (block.text.length > fullContent.length) {
                    const newContent = block.text.slice(fullContent.length);
                    fullContent = block.text;
                    yield { type: 'text_delta', content: newContent };
                  }
                } else if (block.type === 'tool_use') {
                  // Only create tool call if we have a valid name and haven't seen it
                  if (!block.name) {
                    continue;
                  }

                  // Check if we already have this tool call (from stream_event)
                  const existingTool = toolCalls.find(tc => tc.id === block.id);
                  if (!existingTool) {
                    const toolCall: ToolCall = {
                      id: block.id || '',
                      name: block.name,
                      input: block.input || {},
                      status: 'running',
                      startedAt: new Date(),
                    };
                    toolCalls.push(toolCall);
                    yield { type: 'tool_use', toolCall };
                  } else {
                    // Update existing tool call with complete input from full assistant message
                    // stream_event often fires with empty input, this has the complete data
                    if (block.input && Object.keys(block.input).length > 0) {
                      existingTool.input = block.input;
                      // Emit tool_use again to trigger UI update with complete input
                      yield { type: 'tool_use', toolCall: existingTool };
                    }
                  }
                }
                // Note: thinking blocks from assistant message are ignored here
                // They should already have been streamed via stream_event thinking_delta
              }
            }
            break;
          }

          case 'stream_event': {
            // Partial/streaming message events - includes thinking deltas and tool use starts
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const streamMsg = msg as SDKMessage & { event?: any };
            if (streamMsg.event) {
              const event = streamMsg.event;

              if (event.type === 'content_block_delta' && event.delta) {
                if (event.delta.type === 'text_delta' && event.delta.text) {
                  // Buffer text deltas for batching
                  textBuffer += event.delta.text;

                  // Flush if enough time has passed or buffer is large
                  const now = Date.now();
                  if (now - lastFlush >= FLUSH_INTERVAL_MS || textBuffer.length >= 100) {
                    const flushed = flushBuffers();
                    if (flushed?.text) {
                      yield { type: 'text_delta', content: flushed.text };
                    }
                    lastFlush = now;
                  }
                } else if (event.delta.type === 'thinking_delta' && event.delta.thinking) {
                  // Buffer thinking deltas for batching
                  thinkingBuffer += event.delta.thinking;

                  // Flush if enough time has passed or buffer is large
                  const now = Date.now();
                  if (now - lastFlush >= FLUSH_INTERVAL_MS || thinkingBuffer.length >= 100) {
                    const flushed = flushBuffers();
                    if (flushed?.thinking) {
                      yield { type: 'thinking_delta', content: flushed.thinking };
                    }
                    lastFlush = now;
                  }
                }
                // Silently ignore input_json_delta - handled via full tool_use block
              } else if (event.type === 'content_block_start' && event.content_block) {
                // Handle tool use start events from streaming
                if (event.content_block.type === 'tool_use' && event.content_block.name) {
                  // Check if we already have this tool call (from assistant message)
                  const existingTool = toolCalls.find(tc => tc.id === event.content_block.id);
                  if (!existingTool) {
                    console.log('[Claude SDK] Tool start:', event.content_block.name);
                    const toolCall: ToolCall = {
                      id: event.content_block.id || `tool-${Date.now()}`,
                      name: event.content_block.name,
                      input: event.content_block.input || {},
                      status: 'running',
                      startedAt: new Date(),
                    };
                    toolCalls.push(toolCall);
                    yield { type: 'tool_use', toolCall };
                  }
                }
              }
            }
            break;
          }

          case 'tool_progress': {
            // Tool execution progress - may contain tool details we need
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const progressMsg = msg as SDKMessage & { tool_use_id?: string; tool_name?: string; content?: any };
            console.log('[Claude SDK] Tool progress:', JSON.stringify(progressMsg).slice(0, 300));

            // Check if this has tool information we should capture
            if (progressMsg.tool_name && progressMsg.tool_use_id) {
              const existingTool = toolCalls.find(tc => tc.id === progressMsg.tool_use_id);
              if (!existingTool) {
                console.log('[Claude SDK] Tool from progress:', progressMsg.tool_name);
                const toolCall: ToolCall = {
                  id: progressMsg.tool_use_id,
                  name: progressMsg.tool_name,
                  input: {},
                  status: 'running',
                  startedAt: new Date(),
                };
                toolCalls.push(toolCall);
                yield { type: 'tool_use', toolCall };
              }
            }
            break;
          }

          case 'user': {
            // User message (tool results)
            const userMsg = msg as SDKMessage & { message?: { content?: Array<{ type: string; tool_use_id?: string; content?: string }> } };
            if (userMsg.message?.content) {
              for (const block of userMsg.message.content) {
                if (block.type === 'tool_result') {
                  const content = block.content || '';

                  // Check if tool requires approval
                  if (typeof content === 'string' && content.includes('requires approval')) {
                    const toolCall = toolCalls.find(tc => tc.id === block.tool_use_id);
                    if (toolCall) {
                      // Emit permission request to renderer
                      yield {
                        type: 'permission_request',
                        sessionId,
                        requestId: block.tool_use_id || '',
                        toolName: toolCall.name,
                        toolInput: toolCall.input,
                        approvalMessage: content,
                      };
                      continue;
                    }
                  }

                  // Find and update the corresponding tool call
                  const toolCall = toolCalls.find(tc => tc.id === block.tool_use_id);
                  if (toolCall) {
                    toolCall.status = 'completed';
                    toolCall.result = content;
                    toolCall.completedAt = new Date();
                    yield { type: 'tool_result', toolCall, result: content };
                  }
                }
              }
            }
            break;
          }

          case 'result': {
            // Result message may contain errors from the API
            const resultMsg = msg as SDKMessage & { is_error?: boolean; result?: string };

            // Check for corrupted transcript error
            if (resultMsg.is_error && resultMsg.result?.includes('text content blocks must be non-empty')) {
              console.error('[Claude SDK] Corrupted transcript detected - clearing SDK session ID for:', sessionId);
              // Clear the SDK session ID so next message starts fresh
              this.sessionStore.delete(`sessions.${sessionId}.sdkSessionId`);
              yield {
                type: 'error',
                error: 'Session transcript was corrupted. Please try sending your message again - a fresh session will be started.'
              };
              return;
            }

            // Check for other API errors
            if (resultMsg.is_error && resultMsg.result) {
              yield { type: 'error', error: resultMsg.result };
              return;
            }

            // Final result message with cost info - no action needed
            // Flush any remaining buffered content
            const finalFlushed = flushBuffers();
            if (finalFlushed?.text) {
              yield { type: 'text_delta', content: finalFlushed.text };
            }
            if (finalFlushed?.thinking) {
              yield { type: 'thinking_delta', content: finalFlushed.thinking };
            }
            break;
          }

          default:
            // Silently ignore unhandled message types
            break;
        }
      }

      // Final flush before creating message
      const endFlushed = flushBuffers();
      if (endFlushed?.text) {
        yield { type: 'text_delta', content: endFlushed.text };
      }
      if (endFlushed?.thinking) {
        yield { type: 'thinking_delta', content: endFlushed.thinking };
      }

      // Create final message
      const message: ChatMessage = {
        id: Date.now().toString(),
        role: 'assistant',
        content: fullContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        timestamp: new Date(),
      };

      yield { type: 'message_complete', message };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      yield { type: 'error', error: errorMessage };
    } finally {
      this.activeQueries.delete(sessionId);
    }
  }

  cancelQuery(sessionId: string): void {
    const controller = this.activeQueries.get(sessionId);
    if (controller) {
      controller.abort();
      this.activeQueries.delete(sessionId);
    }
  }

  /**
   * Get project slug from path - matches SDK's convention
   * The SDK uses: leading dash, preserve case, replace / with -
   */
  private getProjectSlug(projectPath: string): string {
    // SDK uses a slug that starts with dash and preserves case
    // /Users/aj/dev/project -> -Users-aj-dev-project
    return projectPath.replace(/\//g, '-');
  }

  /**
   * Get messages from SDK transcript files for a session
   */
  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    const session = this.sessionStore.get(`sessions.${sessionId}`) as Session | undefined;
    if (!session) {
      console.error('Session not found:', sessionId);
      return [];
    }

    const projectPath = session.worktreePath || session.repoPath;
    if (!projectPath) {
      return [];
    }

    // Look for transcript files in ~/.claude/projects/{project-slug}/
    const claudeDir = path.join(os.homedir(), '.claude', 'projects');
    const projectSlug = this.getProjectSlug(projectPath);
    const projectDir = path.join(claudeDir, projectSlug);

    // Get the stored SDK session ID for this session
    // Try new location first, then fall back to old location for backwards compatibility
    const sdkSessionId = this.sessionStore.get(`sdkSessionMappings.${sessionId}`) as string | undefined
      || this.sessionStore.get(`sessions.${sessionId}.sdkSessionId`) as string | undefined;

    try {
      // Check if directory exists
      if (!fs.existsSync(projectDir)) {
        // Try alternate slug formats
        const dirs = fs.existsSync(claudeDir) ? fs.readdirSync(claudeDir) : [];
        const matchingDir = dirs.find(d =>
          d.toLowerCase().includes(path.basename(projectPath).toLowerCase())
        );
        if (!matchingDir) {
          console.log('No transcript directory found for project:', projectPath);
          return [];
        }
        return this.parseTranscriptsFromDir(path.join(claudeDir, matchingDir), sdkSessionId);
      }

      return this.parseTranscriptsFromDir(projectDir, sdkSessionId);
    } catch (error) {
      console.error('Error reading transcripts:', error);
      return [];
    }
  }

  /**
   * Parse JSONL transcript files from a directory into ChatMessages
   * If sdkSessionId is provided, only load that specific session's transcript
   * Otherwise, load the most recently modified transcript
   */
  private parseTranscriptsFromDir(dir: string, sdkSessionId?: string): ChatMessage[] {
    const messages: ChatMessage[] = [];
    const seenIds = new Set<string>();

    try {
      let targetFile: string | null = null;

      if (sdkSessionId) {
        // Look for the specific session's transcript file
        const sessionFile = `${sdkSessionId}.jsonl`;
        const sessionFilePath = path.join(dir, sessionFile);
        if (fs.existsSync(sessionFilePath)) {
          targetFile = sessionFile;
          console.log('[Claude] Loading specific session transcript:', sessionFile);
        } else {
          console.log('[Claude] Session transcript not found, will use most recent:', sdkSessionId);
        }
      }

      if (!targetFile) {
        // Fall back to most recently modified transcript (not agent files)
        const files = fs.readdirSync(dir)
          .filter(f => f.endsWith('.jsonl') && !f.startsWith('agent-'))
          .map(f => ({
            name: f,
            mtime: fs.statSync(path.join(dir, f)).mtime.getTime()
          }))
          .sort((a, b) => b.mtime - a.mtime); // Sort by most recent first

        if (files.length > 0) {
          targetFile = files[0].name;
          console.log('[Claude] Loading most recent transcript:', targetFile);
        }
      }

      if (!targetFile) {
        console.log('[Claude] No transcript files found in:', dir);
        return [];
      }

      const filePath = path.join(dir, targetFile);
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          const msg = this.parseTranscriptEntry(entry);
          if (msg && !seenIds.has(msg.id)) {
            seenIds.add(msg.id);
            messages.push(msg);
          }
        } catch {
          // Skip malformed lines
        }
      }
    } catch (error) {
      console.error('Error parsing transcripts from dir:', dir, error);
    }

    return messages;
  }

  /**
   * Parse a single transcript entry into a ChatMessage
   */
  private parseTranscriptEntry(entry: Record<string, unknown>): ChatMessage | null {
    // SDK transcript format varies - handle different message types
    const type = entry.type as string;

    if (type === 'user' || type === 'human') {
      const content = this.extractContent(entry);
      if (!content) return null;
      return {
        id: (entry.uuid as string) || (entry.id as string) || `user-${Date.now()}-${Math.random()}`,
        role: 'user',
        content,
        timestamp: entry.timestamp ? new Date(entry.timestamp as string) : new Date(),
      };
    }

    if (type === 'assistant') {
      const content = this.extractContent(entry);
      const toolCalls = this.extractToolCalls(entry);
      return {
        id: (entry.uuid as string) || (entry.id as string) || `assistant-${Date.now()}-${Math.random()}`,
        role: 'assistant',
        content: content || '',
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        timestamp: entry.timestamp ? new Date(entry.timestamp as string) : new Date(),
      };
    }

    return null;
  }

  /**
   * Extract text content from various message formats
   */
  private extractContent(entry: Record<string, unknown>): string {
    // Direct content string
    if (typeof entry.content === 'string') {
      return entry.content;
    }

    // Content array (Claude API format)
    if (Array.isArray(entry.content)) {
      return entry.content
        .filter((block: { type?: string; text?: string }) => block.type === 'text')
        .map((block: { text?: string }) => block.text || '')
        .join('\n');
    }

    // Message wrapper
    if (entry.message && typeof entry.message === 'object') {
      return this.extractContent(entry.message as Record<string, unknown>);
    }

    return '';
  }

  /**
   * Extract tool calls from message content
   */
  private extractToolCalls(entry: Record<string, unknown>): ToolCall[] {
    const toolCalls: ToolCall[] = [];

    const content = entry.content || (entry.message as Record<string, unknown>)?.content;
    if (!Array.isArray(content)) return toolCalls;

    for (const block of content) {
      if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id || '',
          name: block.name || '',
          input: block.input || {},
          status: 'completed',
          result: block.result,
          startedAt: new Date(),
          completedAt: new Date(),
        });
      }
    }

    return toolCalls;
  }
}
