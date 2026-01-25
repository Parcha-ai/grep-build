import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage, SDKUserMessage, Query } from '@anthropic-ai/claude-agent-sdk';
import type { ImageBlockParam, TextBlockParam } from '@anthropic-ai/sdk/resources';
import { z } from 'zod';
import Store from 'electron-store';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ChatMessage, ToolCall, Session, QuestionRequest, QuestionResponse, Attachment, ContentBlock, CompactionStatus, CompactionComplete, PlanApprovalRequest, PlanApprovalResponse } from '../../shared/types';
import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import { browserService } from './browser.service';
import { stagehandService } from './stagehand.service';
import { documentService } from './document.service';

interface StreamEvent {
  type: 'text_delta' | 'thinking_delta' | 'tool_use' | 'tool_result' | 'message_complete' | 'error' | 'system' | 'permission_request' | 'compaction_status' | 'compaction_complete' | 'plan_content';
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
  // Compaction fields
  compactionStatus?: CompactionStatus;
  compactionComplete?: CompactionComplete;
  // Plan content fields
  planContent?: string;
  planFilePath?: string;
}

interface PendingQuestion {
  resolve: (answers: Record<string, string>) => void;
  reject: (error: Error) => void;
}

interface PendingPermission {
  resolve: (response: { approved: boolean; modifiedInput?: Record<string, unknown> }) => void;
  reject: (error: Error) => void;
  sessionId: string;
  toolName: string;
  input: Record<string, unknown>;
}

interface PendingPlanApproval {
  resolve: (approved: boolean) => void;
  reject: (error: Error) => void;
}

export class ClaudeService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private store: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sessionStore: any;
  private activeQueries: Map<string, AbortController> = new Map();
  private activeQueryObjects: Map<string, Query> = new Map(); // Store Query objects for streamInput
  private sessionPermissionModes: Map<string, string> = new Map(); // Track current permission mode per session
  private pendingQuestions: Map<string, PendingQuestion> = new Map();
  private pendingPermissions: Map<string, PendingPermission> = new Map();
  private pendingPlanApprovals: Map<string, PendingPlanApproval> = new Map();
  private mainWindow: BrowserWindow | null = null;
  private browserMcpServers: Map<string, any> = new Map();

  constructor() {
    this.store = new Store({ name: 'claudette-settings' });
    this.sessionStore = new Store({ name: 'claudette-sessions' });
  }

  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  /**
   * Update the permission mode for an active session
   * This allows changing from 'default' to 'bypassPermissions' mid-stream
   */
  setSessionPermissionMode(sessionId: string, mode: string): void {
    console.log(`[Claude Service] Setting permission mode for ${sessionId}: ${mode}`);
    this.sessionPermissionModes.set(sessionId, mode);
  }

  /**
   * Get the current permission mode for a session
   */
  getSessionPermissionMode(sessionId: string): string | undefined {
    return this.sessionPermissionModes.get(sessionId);
  }

  /**
   * Emit browser update event to renderer for UI synchronization
   * Sends screenshot and URL to update the browser preview panel
   */
  private emitBrowserUpdate(sessionId: string, screenshot: string, url?: string): void {
    console.log('[Claude Service] emitBrowserUpdate called, mainWindow:', !!this.mainWindow, 'sessionId:', sessionId, 'url:', url);
    if (this.mainWindow) {
      console.log('[Claude Service] Sending BROWSER_UPDATE to renderer');
      this.mainWindow.webContents.send(IPC_CHANNELS.BROWSER_UPDATE, {
        sessionId,
        screenshot,
        url,
        timestamp: new Date().toISOString(),
      });
    } else {
      console.log('[Claude Service] WARNING: mainWindow is null, cannot emit browser update');
    }
  }

  /**
   * Ensure browser panel is open and webview is registered before Stagehand operations
   * This solves the chicken-and-egg problem where Stagehand needs a webview to connect to
   */
  private async ensureBrowserPanelOpen(sessionId: string): Promise<boolean> {
    // Check if webview is already registered
    if (browserService.getRegisteredSessions().length > 0) {
      console.log('[Claude Service] Webview already registered');
      return true;
    }

    // Request renderer to open browser panel
    if (this.mainWindow) {
      console.log('[Claude Service] Requesting browser panel to open for session:', sessionId);
      this.mainWindow.webContents.send(IPC_CHANNELS.BROWSER_OPEN_PANEL, { sessionId });

      // Wait for webview to register (poll with timeout)
      const maxWait = 5000; // 5 seconds
      const pollInterval = 200; // 200ms
      let waited = 0;

      while (waited < maxWait) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        waited += pollInterval;

        if (browserService.getRegisteredSessions().length > 0) {
          console.log('[Claude Service] Webview registered after', waited, 'ms');
          return true;
        }
      }

      console.log('[Claude Service] Timeout waiting for webview registration');
    }

    return false;
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

    // Initialize Stagehand with API keys
    const apiKey = this.getApiKey();
    if (apiKey) {
      stagehandService.setApiKey(apiKey);
    }
    // Pass Google API key for Gemini models (from store or environment)
    const googleApiKey = this.getGoogleApiKey() || process.env.GOOGLE_API_KEY;
    if (googleApiKey) {
      stagehandService.setGoogleApiKey(googleApiKey);
    }

    // ============ STAGEHAND-POWERED BROWSER TOOLS ============
    // These tools use AI-powered browser automation via Stagehand

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

          console.log('[Claude Service] Capturing browser snapshot via Stagehand:', url);

          // Also navigate the app's webview to keep it in sync
          browserService.navigate(sessionId, url).catch(err => {
            console.log('[Claude Service] Could not sync webview navigation:', err);
          });

          // Navigate using Stagehand
          const navResult = await stagehandService.navigate(url);
          if (!navResult.success) {
            return {
              content: [{
                type: 'text',
                text: `Failed to navigate to ${url}: ${navResult.error}`,
              }],
              isError: true,
            };
          }

          // Additional wait if requested
          if (waitForLoad && waitTime > 0) {
            await new Promise(resolve => setTimeout(resolve, Math.min(waitTime, 10000)));
          }

          // Capture full snapshot
          const snapshot = await stagehandService.captureSnapshot();
          if (!snapshot) {
            return {
              content: [{
                type: 'text',
                text: `Failed to capture snapshot of ${url}`,
              }],
              isError: true,
            };
          }

          // Emit navigation event to update UI
          this.emitBrowserUpdate(sessionId, snapshot.screenshot, snapshot.url);

          // Return snapshot info with image (MCP format)
          return {
            content: [
              {
                type: 'text',
                text: `Captured snapshot of ${snapshot.url} (${snapshot.title})\n\nHTML Preview:\n${snapshot.html.slice(0, 10000)}${snapshot.html.length > 10000 ? '...(truncated)' : ''}`,
              },
              {
                type: 'image',
                data: snapshot.screenshot,
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

          // Ensure browser panel is open before Stagehand operations
          await this.ensureBrowserPanelOpen(sessionId);

          console.log('[Claude Service] Navigating browser via Stagehand to:', url);
          const result = await stagehandService.navigate(url);

          if (result.success && result.screenshot) {
            this.emitBrowserUpdate(sessionId, result.screenshot, url);
          }

          return {
            content: [{
              type: 'text',
              text: result.success ? `Navigated to ${url}` : `Failed to navigate: ${result.error}`,
            }],
            isError: !result.success,
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

    // BrowserAct tool - AI-powered natural language actions (NEW - Stagehand feature!)
    const browserActTool = tool(
      'BrowserAct',
      'Execute a natural language action in the browser. This is the PRIMARY way to interact with web pages - use natural language like "click the login button", "fill in the email field with test@example.com", "scroll down to see more products". Much more reliable than CSS selectors!',
      {
        instruction: z.string().describe('Natural language instruction for what to do, e.g., "click the login button", "type hello in the search box", "scroll down"'),
      },
      async (args) => {
        try {
          const { instruction } = args;

          // Ensure browser panel is open before Stagehand operations
          await this.ensureBrowserPanelOpen(sessionId);

          console.log('[Claude Service] Browser act:', instruction);
          const result = await stagehandService.act(instruction);

          if (result.success && result.screenshot) {
            this.emitBrowserUpdate(sessionId, result.screenshot);
          }

          return {
            content: [
              {
                type: 'text',
                text: result.success ? `✓ ${result.message}` : `✗ Failed: ${result.error}`,
              },
              ...(result.screenshot ? [{
                type: 'image' as const,
                data: result.screenshot,
                mimeType: 'image/png' as const,
              }] : []),
            ],
            isError: !result.success,
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Failed to execute action: ${error instanceof Error ? error.message : String(error)}`,
            }],
            isError: true,
          };
        }
      }
    );

    // BrowserObserve tool - Discover available actions (NEW - Stagehand feature!)
    const browserObserveTool = tool(
      'BrowserObserve',
      'Analyze the current page to discover available actions and interactive elements. Returns a list of things you can do on the page. Use this when you need to understand what actions are possible.',
      {
        instruction: z.string().optional().describe('Optional: Focus on specific types of elements, e.g., "buttons for submitting forms" or "navigation links"'),
      },
      async (args) => {
        try {
          const { instruction } = args;
          console.log('[Claude Service] Browser observe:', instruction || 'all');
          const result = await stagehandService.observe(instruction);

          if (!result.success) {
            return {
              content: [{
                type: 'text',
                text: `Failed to observe page: ${result.error}`,
              }],
              isError: true,
            };
          }

          const actionsText = result.actions?.map((a, i) =>
            `${i + 1}. ${a.description}\n   Action: ${a.suggestedAction}\n   Selector: ${a.selector}`
          ).join('\n\n') || 'No actions found';

          return {
            content: [
              {
                type: 'text',
                text: `Available actions on page:\n\n${actionsText}`,
              },
              ...(result.screenshot ? [{
                type: 'image' as const,
                data: result.screenshot,
                mimeType: 'image/png' as const,
              }] : []),
            ],
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Failed to observe page: ${error instanceof Error ? error.message : String(error)}`,
            }],
            isError: true,
          };
        }
      }
    );

    // BrowserAgent tool - Autonomous multi-step workflows (NEW - Stagehand feature!)
    const browserAgentTool = tool(
      'BrowserAgent',
      'Execute a complex multi-step task autonomously. The agent will figure out the necessary steps and execute them. Use this for complex workflows like "log in to the website and navigate to settings".',
      {
        task: z.string().describe('The task to accomplish, e.g., "navigate to the pricing page and extract all plan names and prices"'),
      },
      async (args) => {
        try {
          const { task } = args;
          console.log('[Claude Service] Browser agent task:', task);
          const result = await stagehandService.agent(task);

          if (result.screenshot) {
            this.emitBrowserUpdate(sessionId, result.screenshot);
          }

          const actionsLog = result.actions?.map((a, i) =>
            `${i + 1}. ${a.description}`
          ).join('\n') || 'No actions recorded';

          return {
            content: [
              {
                type: 'text',
                text: result.success
                  ? `✓ Task completed: ${result.message}\n\nActions taken:\n${actionsLog}`
                  : `✗ Task failed: ${result.error}`,
              },
              ...(result.screenshot ? [{
                type: 'image' as const,
                data: result.screenshot,
                mimeType: 'image/png' as const,
              }] : []),
            ],
            isError: !result.success,
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Failed to execute agent task: ${error instanceof Error ? error.message : String(error)}`,
            }],
            isError: true,
          };
        }
      }
    );

    // BrowserClick tool - click on elements (fallback when CSS selector is needed)
    const browserClickTool = tool(
      'BrowserClick',
      'Click on an element using a CSS selector. NOTE: Prefer using BrowserAct with natural language (e.g., "click the login button") as it is more reliable and self-healing.',
      {
        selector: z.string().describe('CSS selector for the element to click (e.g., "button.submit", "#login-btn")'),
      },
      async (args) => {
        try {
          const { selector } = args;
          console.log('[Claude Service] BrowserClick ENTRY - selector:', selector);
          console.log('[Claude Service] stagehandService:', typeof stagehandService, Object.keys(stagehandService));
          const result = await stagehandService.click(selector);
          console.log('[Claude Service] BrowserClick result:', result);

          if (result.screenshot) {
            this.emitBrowserUpdate(sessionId, result.screenshot);
          }

          return {
            content: [{
              type: 'text',
              text: result.success ? `Clicked element: ${selector}` : `Failed to click: ${result.error}`,
            }],
            isError: !result.success,
          };
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

    // BrowserType tool - type text into inputs (fallback when CSS selector is needed)
    const browserTypeTool = tool(
      'BrowserType',
      'Type text into an input field using a CSS selector. NOTE: Prefer using BrowserAct with natural language (e.g., "type hello@example.com in the email field") as it is more reliable.',
      {
        selector: z.string().describe('CSS selector for the input element (e.g., "input[name=\'email\']", "#search-box")'),
        text: z.string().describe('The text to type into the element'),
      },
      async (args) => {
        try {
          const { selector, text } = args;
          console.log('[Claude Service] Typing into element via Stagehand:', selector);
          const result = await stagehandService.type(selector, text);

          if (result.screenshot) {
            this.emitBrowserUpdate(sessionId, result.screenshot);
          }

          return {
            content: [{
              type: 'text',
              text: result.success
                ? `Typed "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}" into ${selector}`
                : `Failed to type: ${result.error}`,
            }],
            isError: !result.success,
          };
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
      'Extract text content from the browser. Can extract from the whole page or a specific element. For structured data extraction, consider using BrowserExtractData instead.',
      {
        selector: z.string().optional().describe('Optional CSS selector to extract from specific element. If not provided, extracts all page text.'),
      },
      async (args) => {
        try {
          const { selector } = args;
          console.log('[Claude Service] Extracting text via Stagehand:', selector || 'full page');
          const result = await stagehandService.extractText(selector);

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

    // BrowserExtractData tool - AI-powered structured data extraction (NEW - Stagehand feature!)
    const browserExtractDataTool = tool(
      'BrowserExtractData',
      'Extract structured data from the page using AI. Describe what data you want and it will be extracted intelligently. Returns JSON data.',
      {
        instruction: z.string().describe('What to extract, e.g., "the product name, price, and rating", "all navigation menu items", "the main article title and author"'),
      },
      async (args) => {
        try {
          const { instruction } = args;
          console.log('[Claude Service] AI data extraction:', instruction);

          // Use a simple schema - Stagehand will interpret based on instruction
          const flexibleSchema = z.object({
            items: z.array(z.record(z.string(), z.string())).describe('Extracted items'),
          });

          const result = await stagehandService.extract<{ items: Array<Record<string, string>> }>(instruction, flexibleSchema);

          if (result.success && result.data) {
            return {
              content: [{
                type: 'text',
                text: `Extracted data:\n\n${JSON.stringify(result.data, null, 2)}`,
              }],
            };
          } else {
            return {
              content: [{
                type: 'text',
                text: `Failed to extract data: ${result.error}`,
              }],
              isError: true,
            };
          }
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Failed to extract data: ${error instanceof Error ? error.message : String(error)}`,
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
          console.log('[Claude Service] Getting page info via Stagehand');
          const info = await stagehandService.getPageInfo();

          if (info) {
            return {
              content: [{
                type: 'text',
                text: `Current page:\nURL: ${info.url}\nTitle: ${info.title}`,
              }],
            };
          } else {
            return {
              content: [{
                type: 'text',
                text: 'Browser not initialized. Navigate to a page first.',
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
      'Get the complete HTML DOM of the current page. Use this when you need to find elements that may not be visible in the initial snapshot preview.',
      {
        selector: z.string().optional().describe('Optional CSS selector to get HTML of specific element instead of whole document'),
      },
      async (args) => {
        try {
          const { selector } = args;
          console.log('[Claude Service] Getting DOM via Stagehand:', selector || 'full page');

          let html = await stagehandService.getHTML();
          if (!html) {
            return {
              content: [{
                type: 'text',
                text: 'Browser not initialized. Navigate to a page first.',
              }],
              isError: true,
            };
          }

          // If selector provided, we could filter but Stagehand doesn't have direct script execution
          // For now, return full HTML - user can use BrowserExtract for specific elements
          if (selector) {
            // Note: Stagehand's page.evaluate could be used here if needed
            console.log('[Claude Service] Note: selector filtering not implemented, returning full DOM');
          }

          // Cap at reasonable limit to avoid overwhelming Claude
          const maxLength = 50000;
          const truncated = html.length > maxLength;

          return {
            content: [{
              type: 'text',
              text: `DOM HTML:\n\n${html.slice(0, maxLength)}${truncated ? '\n\n...(truncated - use BrowserExtract for specific content)' : ''}`,
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

    // Note: CDP-based debugging tools (console logs, network requests) are not available with Stagehand
    // Stagehand provides AI-powered automation instead of low-level CDP access

    // UpdateSessionName tool - allow Claude to set descriptive session names
    const updateSessionNameTool = tool(
      'UpdateSessionName',
      'Update the current session name with a descriptive title. Call this when you understand what the session is about to help the user identify it later. Use concise, descriptive titles (3-5 words).',
      {
        name: z.string().describe('A concise descriptive name for this session (e.g., "Video Processing Workflow", "Entity Research Integration")'),
      },
      async (args) => {
        try {
          const { name } = args;
          console.log('[Claude Service] Updating session name:', sessionId, '→', name);

          // Store the custom name
          this.sessionStore.set(`sessionNames.${sessionId}`, name);

          return {
            content: [{
              type: 'text',
              text: `Session name updated to: "${name}"`,
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Failed to update session name: ${error instanceof Error ? error.message : String(error)}`,
            }],
            isError: true,
          };
        }
      }
    );

    // DocumentCreate tool - create DOCX, XLSX, or presentation files
    const documentCreateTool = tool(
      'DocumentCreate',
      'Create a new document (Word, Excel spreadsheet, or HTML slide presentation). Use this to generate office documents for reports, data exports, or presentations.',
      {
        type: z.string().describe('Document type - must be one of: "docx" for Word, "xlsx" for Excel, "slides" for reveal.js presentation'),
        path: z.string().describe('Full file path where to save the document'),
        title: z.string().optional().describe('Document title (used for DOCX title or presentation title)'),
        content: z.any().describe('Document content - structure depends on type. For docx: array of {type, text, level?, rows?, items?}. For xlsx: {sheets: [{name, data: 2D array}]}. For slides: {slides: [{title?, content, notes?, background?, transition?}]}'),
      },
      async (args) => {
        try {
          const { type, path: docPath, title, content } = args;
          console.log('[Claude Service] Creating document:', type, docPath);

          let resultPath: string;

          switch (type) {
            case 'docx':
              resultPath = await documentService.createDocx({
                path: docPath,
                title: title,
                content: content as any,
              });
              break;
            case 'xlsx':
              resultPath = await documentService.createXlsx({
                path: docPath,
                sheets: content?.sheets || [{ name: 'Sheet1', data: content?.data || [[]] }],
              });
              break;
            case 'slides':
              resultPath = await documentService.createPresentation({
                path: docPath,
                title: title || 'Presentation',
                theme: content?.theme,
                slides: content?.slides || [],
              });
              break;
            default:
              return {
                content: [{ type: 'text', text: `Unsupported document type: ${type}` }],
                isError: true,
              };
          }

          return {
            content: [{
              type: 'text',
              text: `Created ${type.toUpperCase()} document at: ${resultPath}`,
            }],
          };
        } catch (error) {
          console.error('[Claude Service] DocumentCreate error:', error);
          return {
            content: [{
              type: 'text',
              text: `Failed to create document: ${error instanceof Error ? error.message : String(error)}`,
            }],
            isError: true,
          };
        }
      }
    );

    // DocumentRead tool - read document content
    const documentReadTool = tool(
      'DocumentRead',
      'Read the content of a document (Word or Excel). Returns the text content or spreadsheet data.',
      {
        path: z.string().describe('Full file path of the document to read'),
      },
      async (args) => {
        try {
          const { path: docPath } = args;
          console.log('[Claude Service] Reading document:', docPath);

          const docType = documentService.getDocumentType(docPath);

          switch (docType) {
            case 'xlsx': {
              const data = await documentService.readXlsx(docPath);
              let summary = '';
              for (const sheet of data.sheets) {
                summary += `\n## Sheet: ${sheet.name}\n`;
                if (sheet.data.length > 0) {
                  const maxRows = Math.min(sheet.data.length, 50);
                  for (let i = 0; i < maxRows; i++) {
                    const row = sheet.data[i];
                    if (row && row.length > 0) {
                      summary += row.map(cell => cell?.value ?? '').join('\t') + '\n';
                    }
                  }
                  if (sheet.data.length > maxRows) {
                    summary += `\n... and ${sheet.data.length - maxRows} more rows`;
                  }
                }
              }
              return {
                content: [{
                  type: 'text',
                  text: `Spreadsheet content from ${docPath}:${summary}`,
                }],
              };
            }
            case 'docx': {
              const rendered = await documentService.renderDocx(docPath);
              const textContent = rendered.html
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<[^>]+>/g, '\n')
                .replace(/\n\s*\n/g, '\n\n')
                .trim()
                .slice(0, 10000);
              return {
                content: [{
                  type: 'text',
                  text: `Word document content from ${docPath}:\n\n${textContent}${textContent.length >= 10000 ? '\n...(truncated)' : ''}`,
                }],
              };
            }
            default:
              return {
                content: [{
                  type: 'text',
                  text: `Cannot read document type: ${docType}. Supported types: docx, xlsx`,
                }],
                isError: true,
              };
          }
        } catch (error) {
          console.error('[Claude Service] DocumentRead error:', error);
          return {
            content: [{
              type: 'text',
              text: `Failed to read document: ${error instanceof Error ? error.message : String(error)}`,
            }],
            isError: true,
          };
        }
      }
    );

    // DocumentEdit tool - edit Excel cells
    const documentEditTool = tool(
      'DocumentEdit',
      'Edit cells in an Excel spreadsheet. Can update values or formulas in specific cells.',
      {
        path: z.string().describe('Full file path of the Excel file to edit'),
        updates: z.array(z.object({
          sheet: z.string().or(z.number()).describe('Sheet name or index (0-based)'),
          cell: z.string().describe('Cell reference (e.g., "A1", "B2", "C10")'),
          value: z.string().or(z.number()).or(z.boolean()).or(z.null()).optional().describe('New cell value'),
          formula: z.string().optional().describe('Excel formula (without leading =)'),
        })).describe('Array of cell updates'),
      },
      async (args) => {
        try {
          const { path: docPath, updates } = args;
          console.log('[Claude Service] Editing document:', docPath, updates.length, 'updates');

          await documentService.updateXlsxCells(docPath, updates as any);

          return {
            content: [{
              type: 'text',
              text: `Updated ${updates.length} cell(s) in ${docPath}`,
            }],
          };
        } catch (error) {
          console.error('[Claude Service] DocumentEdit error:', error);
          return {
            content: [{
              type: 'text',
              text: `Failed to edit document: ${error instanceof Error ? error.message : String(error)}`,
            }],
            isError: true,
          };
        }
      }
    );

    // DocumentPreview tool - preview document in browser panel
    const documentPreviewTool = tool(
      'DocumentPreview',
      'Preview a document (Word, Excel, or presentation) in the browser panel. Converts the document to HTML and displays it.',
      {
        path: z.string().describe('Full file path of the document to preview'),
      },
      async (args) => {
        try {
          const { path: docPath } = args;
          console.log('[Claude Service] Previewing document:', docPath);

          const content = await documentService.renderDocument(docPath);
          const previewPath = await documentService.saveForPreview(content, docPath);
          const fileUrl = `file://${previewPath}`;
          await browserService.navigate(sessionId, fileUrl);

          return {
            content: [{
              type: 'text',
              text: `Previewing ${docPath} in browser panel`,
            }],
          };
        } catch (error) {
          console.error('[Claude Service] DocumentPreview error:', error);
          return {
            content: [{
              type: 'text',
              text: `Failed to preview document: ${error instanceof Error ? error.message : String(error)}`,
            }],
            isError: true,
          };
        }
      }
    );

    const mcpServer = createSdkMcpServer({
      name: 'claudette-browser',
      version: '2.0.0', // Upgraded to Stagehand-powered automation
      tools: [
        // Core browser tools
        browserSnapshotTool,
        browserNavigateTool,
        // AI-powered Stagehand tools (PRIMARY - prefer these!)
        browserActTool,
        browserObserveTool,
        browserAgentTool,
        browserExtractDataTool,
        // Fallback selector-based tools
        browserClickTool,
        browserTypeTool,
        browserExtractTool,
        // Page info tools
        browserGetInfoTool,
        browserGetDOMTool,
        // Utility tools
        updateSessionNameTool,
        // Document tools
        documentCreateTool,
        documentReadTool,
        documentEditTool,
        documentPreviewTool,
      ],
    });

    this.browserMcpServers.set(sessionId, mcpServer);
    return mcpServer;
  }

  setApiKey(apiKey: string): void {
    this.store.set('anthropicApiKey', apiKey);
  }

  getGoogleApiKey(): string | undefined {
    return this.store.get('googleApiKey') as string | undefined;
  }

  setGoogleApiKey(apiKey: string): void {
    this.store.set('googleApiKey', apiKey);
  }

  // Handle question responses from the renderer
  handleQuestionResponse(response: QuestionResponse): void {
    const pending = this.pendingQuestions.get(response.requestId);
    if (pending) {
      pending.resolve(response.answers);
      this.pendingQuestions.delete(response.requestId);
    }
  }

  // Handle permission responses from the renderer
  handlePermissionResponse(response: { requestId: string; approved: boolean; modifiedInput?: Record<string, unknown>; alwaysApprove?: boolean }): void {
    console.log('[Claude Service] handlePermissionResponse called:', response.requestId, 'approved:', response.approved, 'alwaysApprove:', response.alwaysApprove);
    const pending = this.pendingPermissions.get(response.requestId);
    if (pending) {
      console.log('[Claude Service] Found pending permission, resolving...');

      // If "always approve" was selected, save the permission pattern
      if (response.approved && response.alwaysApprove && pending.toolName === 'Bash') {
        this.savePermissionPattern(pending.sessionId, pending.toolName, pending.input);
      }

      pending.resolve({ approved: response.approved, modifiedInput: response.modifiedInput });
      this.pendingPermissions.delete(response.requestId);
    } else {
      console.warn('[Claude Service] No pending permission found for requestId:', response.requestId);
    }
  }

  // Save a permission pattern to the project's .claude/settings.local.json
  private async savePermissionPattern(sessionId: string, toolName: string, input: Record<string, unknown>): Promise<void> {
    try {
      // Get the session to find the worktree path
      const session = this.sessionStore.get(`sessions.${sessionId}`) as Session | undefined;
      if (!session) {
        console.warn('[Claude Service] Could not find session for permission pattern save:', sessionId);
        return;
      }

      const projectPath = session.worktreePath || session.repoPath;
      if (!projectPath) {
        console.warn('[Claude Service] No project path found for session:', sessionId);
        return;
      }

      // Extract the command pattern for Bash tool
      const command = input.command as string;
      if (!command) {
        console.warn('[Claude Service] No command found in Bash input');
        return;
      }

      // Extract wildcard pattern: "gh pr list main" -> "gh pr *"
      const parts = command.trim().split(/\s+/);
      let pattern: string;
      if (parts.length <= 2) {
        pattern = parts[0] + ' *';
      } else {
        pattern = parts.slice(0, 2).join(' ') + ' *';
      }

      // Read existing settings.local.json or create new one
      const settingsPath = path.join(projectPath, '.claude', 'settings.local.json');
      const claudeDir = path.dirname(settingsPath);

      // Ensure .claude directory exists
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }

      let settings: { allowedTools?: string[] } = {};
      if (fs.existsSync(settingsPath)) {
        const content = fs.readFileSync(settingsPath, 'utf-8');
        settings = JSON.parse(content);
      }

      // Initialize allowedTools array if not present
      if (!settings.allowedTools) {
        settings.allowedTools = [];
      }

      // Add the pattern if not already present (format: "Bash(pattern)")
      const permissionEntry = `Bash(${pattern})`;
      if (!settings.allowedTools.includes(permissionEntry)) {
        settings.allowedTools.push(permissionEntry);
        console.log('[Claude Service] Adding permission pattern:', permissionEntry);

        // Write back to settings.local.json
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        console.log('[Claude Service] Saved permission to:', settingsPath);
      } else {
        console.log('[Claude Service] Permission pattern already exists:', permissionEntry);
      }
    } catch (error) {
      console.error('[Claude Service] Failed to save permission pattern:', error);
    }
  }

  // Ask user for permission via the renderer
  private async askUserPermission(
    sessionId: string,
    toolName: string,
    input: Record<string, unknown>
  ): Promise<{ approved: boolean; modifiedInput?: Record<string, unknown> }> {
    const requestId = `permission-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return new Promise((resolve, reject) => {
      // Store the promise resolve/reject functions
      this.pendingPermissions.set(requestId, { resolve, reject, sessionId, toolName, input });

      // Send permission request to renderer
      if (this.mainWindow) {
        const request = {
          sessionId,
          requestId,
          toolName,
          toolInput: input,  // Use toolInput to match PermissionRequest type
        };
        console.log('[Claude Service] Sending permission request to renderer:', toolName, 'input:', JSON.stringify(input));
        this.mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_PERMISSION_REQUEST, request);
      } else {
        reject(new Error('Main window not available'));
      }

      // Set a timeout in case the user never responds
      setTimeout(() => {
        if (this.pendingPermissions.has(requestId)) {
          this.pendingPermissions.delete(requestId);
          reject(new Error('Permission response timeout'));
        }
      }, 5 * 60 * 1000); // 5 minute timeout
    });
  }

  // Handle plan approval responses from the renderer
  handlePlanApprovalResponse(response: PlanApprovalResponse): void {
    const pending = this.pendingPlanApprovals.get(response.requestId);
    if (pending) {
      pending.resolve(response.approved);
      this.pendingPlanApprovals.delete(response.requestId);
    }
  }

  // Ask user to approve a plan via the renderer
  private async askPlanApproval(
    sessionId: string,
    planContent: string,
    planFilePath?: string,
    allowedPrompts?: Array<{ tool: string; prompt: string }>
  ): Promise<boolean> {
    const requestId = `plan-approval-${Date.now()}-${Math.random()}`;

    return new Promise((resolve, reject) => {
      // Store the promise resolve/reject functions
      this.pendingPlanApprovals.set(requestId, { resolve, reject });

      // Send plan approval request to renderer
      if (this.mainWindow) {
        const request: PlanApprovalRequest = {
          sessionId,
          requestId,
          planContent,
          planFilePath,
          allowedPrompts,
        };
        this.mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_PLAN_APPROVAL_REQUEST, request);
      } else {
        reject(new Error('Main window not available'));
      }

      // Set a timeout in case the user never responds (10 minute timeout for plans)
      setTimeout(() => {
        if (this.pendingPlanApprovals.has(requestId)) {
          this.pendingPlanApprovals.delete(requestId);
          reject(new Error('Plan approval response timeout'));
        }
      }, 10 * 60 * 1000); // 10 minute timeout
    });
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

      // Store the initial permission mode for this session (can be updated mid-stream via GREP IT!)
      this.sessionPermissionModes.set(sessionId, sdkPermissionMode);

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
          // Use selected model or default to Claude Opus 4.5
          model: model || 'claude-opus-4-5-20251101',
          ...(maxThinkingTokens ? { maxThinkingTokens } : {}),
          // Use Claude Code's system prompt preset with Grep Build agent context
          systemPrompt: {
            type: 'preset',
            preset: 'claude_code',
            append: `
## Grep Build Agent

You are the Grep Build agent, an AI development assistant running inside the Grep desktop application. You have access to a browser preview panel via MCP tools (claudette-browser) that allows you to test changes you make to web applications in real-time.

### Browser Testing Capabilities

When you make changes to frontend code or start development servers, you can:
- Navigate to localhost URLs to test the application
- Take screenshots to verify UI changes
- Inspect the DOM and check element states
- Monitor network requests and console output

### Proactive Testing

At the start of each session, ask the user: "Would you like me to help test your changes in the browser as we work?"

If the user agrees:
- After making UI changes, navigate to the appropriate URL and take a screenshot to verify the changes
- When starting dev servers, wait for them to be ready then navigate to test the application
- Report any visual issues, console errors, or unexpected behavior you observe
- Be proactive about suggesting which URLs to test based on the files being modified

You are intelligent enough to determine what URLs to test based on the project structure, development server configuration, and the specific files being modified.
`,
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
          canUseTool: async (toolName: string, input: Record<string, unknown>, _options: any) => {
            console.log(`[Claude Service] canUseTool called for: ${toolName}, mode: ${sdkPermissionMode}`);

            // Handle AskUserQuestion tool
            if (toolName === 'AskUserQuestion' && input.questions) {
              try {
                const answers = await this.askUserQuestion(sessionId, input.questions as any);
                return {
                  behavior: 'allow' as const,
                  updatedInput: {
                    ...input,
                    answers,
                  },
                };
              } catch (error) {
                console.error('[Claude Service] Error asking user question:', error);
                return {
                  behavior: 'deny' as const,
                  message: error instanceof Error ? error.message : 'Failed to get user response',
                };
              }
            }

            // Handle ExitPlanMode - require user approval before proceeding
            if (toolName === 'ExitPlanMode') {
              try {
                console.log('[Claude Service] ExitPlanMode called, requesting user approval');

                // Find the plan file that was written most recently
                const plansDir = path.join(os.homedir(), '.claude', 'plans');
                let planContent = '';
                let planFilePath = '';

                if (fs.existsSync(plansDir)) {
                  const planFiles = fs.readdirSync(plansDir)
                    .filter(f => f.endsWith('.md'))
                    .map(f => ({
                      name: f,
                      path: path.join(plansDir, f),
                      mtime: fs.statSync(path.join(plansDir, f)).mtime.getTime(),
                    }))
                    .sort((a, b) => b.mtime - a.mtime);

                  if (planFiles.length > 0) {
                    planFilePath = planFiles[0].path;
                    planContent = fs.readFileSync(planFilePath, 'utf-8');
                  }
                }

                // If no plan file found, use a placeholder message
                if (!planContent) {
                  planContent = 'Plan content not found. The assistant wants to proceed with the implementation.';
                }

                // Get allowedPrompts from input if present
                const allowedPrompts = input.allowedPrompts as Array<{ tool: string; prompt: string }> | undefined;

                // Ask user for approval
                const approved = await this.askPlanApproval(sessionId, planContent, planFilePath, allowedPrompts);

                if (approved) {
                  console.log('[Claude Service] Plan approved by user');
                  return { behavior: 'allow' as const, updatedInput: input };
                } else {
                  console.log('[Claude Service] Plan rejected by user');
                  return {
                    behavior: 'deny' as const,
                    message: 'Plan was not approved by the user. Please revise the plan based on user feedback.',
                  };
                }
              } catch (error) {
                console.error('[Claude Service] Error requesting plan approval:', error);
                return {
                  behavior: 'deny' as const,
                  message: error instanceof Error ? error.message : 'Failed to get plan approval',
                };
              }
            }

            // Check the CURRENT permission mode (may have changed via GREP IT! button)
            const currentPermissionMode = this.getSessionPermissionMode(sessionId) || sdkPermissionMode;
            console.log(`[Claude Service] Permission check - initial mode: ${sdkPermissionMode}, current mode: ${currentPermissionMode}`);

            // In plan mode, deny write operations
            if (currentPermissionMode === 'plan') {
              const writeTools = ['Write', 'Edit', 'Bash', 'NotebookEdit', 'TodoWrite'];
              if (writeTools.includes(toolName)) {
                console.log(`[Claude Service] Plan mode - denying write tool: ${toolName}`);
                return {
                  behavior: 'deny' as const,
                  message: 'In plan mode, write operations are not permitted. Please exit plan mode to make changes.',
                };
              }
            }

            // In 'bypassPermissions' mode, allow everything without asking
            if (currentPermissionMode === 'bypassPermissions') {
              console.log(`[Claude Service] Bypass permissions mode - auto-allowing: ${toolName}`);
              return { behavior: 'allow' as const, updatedInput: input };
            }

            // In 'default' mode, ask user for permission on tools that modify filesystem
            // In 'acceptEdits' mode, only ask for Bash commands (edits are auto-approved)
            if (currentPermissionMode === 'default') {
              // Default mode: ask for permission on all modifying tools
              const modifyingTools = ['Write', 'Edit', 'Bash', 'NotebookEdit', 'MultiEdit'];
              if (modifyingTools.includes(toolName)) {
                try {
                  console.log(`[Claude Service] Asking user permission for: ${toolName}`);
                  const response = await this.askUserPermission(sessionId, toolName, input);
                  if (response.approved) {
                    return {
                      behavior: 'allow' as const,
                      updatedInput: response.modifiedInput || input,
                    };
                  } else {
                    return {
                      behavior: 'deny' as const,
                      message: 'User denied permission for this tool',
                    };
                  }
                } catch (error) {
                  console.error('[Claude Service] Error getting permission:', error);
                  return {
                    behavior: 'deny' as const,
                    message: error instanceof Error ? error.message : 'Failed to get permission response',
                  };
                }
              }
            } else if (currentPermissionMode === 'acceptEdits') {
              // Accept edits mode: only ask for Bash commands
              if (toolName === 'Bash') {
                try {
                  console.log(`[Claude Service] Asking user permission for Bash command`);
                  const response = await this.askUserPermission(sessionId, toolName, input);
                  if (response.approved) {
                    return {
                      behavior: 'allow' as const,
                      updatedInput: response.modifiedInput || input,
                    };
                  } else {
                    return {
                      behavior: 'deny' as const,
                      message: 'User denied permission for this command',
                    };
                  }
                } catch (error) {
                  console.error('[Claude Service] Error getting permission:', error);
                  return {
                    behavior: 'deny' as const,
                    message: error instanceof Error ? error.message : 'Failed to get permission response',
                  };
                }
              }
            }

            // For other tools or bypassPermissions mode, allow them
            // Must include updatedInput when allowing - SDK requires it
            return { behavior: 'allow' as const, updatedInput: input };
          },
        },
      });

      // Store the Query object so we can inject messages via streamInput
      this.activeQueryObjects.set(sessionId, messages);

      let fullContent = '';
      const toolCalls: ToolCall[] = [];
      const contentBlocks: ContentBlock[] = []; // Track content blocks in order

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

          // Add or extend text block in contentBlocks
          const lastBlock = contentBlocks[contentBlocks.length - 1];
          if (lastBlock && lastBlock.type === 'text') {
            lastBlock.text = (lastBlock.text || '') + content;
          } else {
            contentBlocks.push({ type: 'text', text: content });
          }

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
            // System messages can have different subtypes
            const systemMsg = msg as SDKMessage & {
              subtype?: string;
              session_id?: string;
              tools?: string[];
              model?: string;
              status?: 'compacting' | null;
              compact_metadata?: {
                trigger: 'manual' | 'auto';
                pre_tokens: number;
              };
            };

            // Handle compaction status changes (subtype: 'status')
            if (systemMsg.subtype === 'status') {
              const isCompacting = systemMsg.status === 'compacting';
              console.log('[Claude SDK] Compaction status:', isCompacting ? 'COMPACTING' : 'idle');

              // Determine if Smart Compact is needed
              // Smart Compact: if using Opus or other models without extended context, we note it
              const currentModel = model || 'claude-opus-4-5-20251101';
              const isOpus = currentModel.includes('opus');
              const needsSmartCompact = isOpus && isCompacting;

              const compactionStatus: CompactionStatus = {
                sessionId,
                isCompacting,
                ...(needsSmartCompact && {
                  smartCompact: {
                    enabled: true,
                    originalModel: currentModel,
                    compactingModel: 'claude-sonnet-4-5-20250929',
                    reason: 'Opus does not support extended context - using Sonnet for compaction',
                  },
                }),
              };

              // Emit to renderer via IPC
              if (this.mainWindow) {
                this.mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_COMPACTION_STATUS, compactionStatus);
              }

              yield {
                type: 'compaction_status',
                compactionStatus,
              };
              break;
            }

            // Handle compaction complete (subtype: 'compact_boundary')
            if (systemMsg.subtype === 'compact_boundary' && systemMsg.compact_metadata) {
              console.log('[Claude SDK] Compaction complete:', systemMsg.compact_metadata);

              const compactionComplete: CompactionComplete = {
                sessionId,
                preTokens: systemMsg.compact_metadata.pre_tokens,
                smartCompact: {
                  modelSwitched: (model || '').includes('opus'),
                  restoredModel: model || 'claude-opus-4-5-20251101',
                },
              };

              // Emit to renderer via IPC
              if (this.mainWindow) {
                this.mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_COMPACTION_COMPLETE, compactionComplete);
              }

              yield {
                type: 'compaction_complete',
                compactionComplete,
              };
              break;
            }

            // Default system message handling (tool/model info)
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
                    // Add tool_use content block to track order
                    contentBlocks.push({ type: 'tool_use', toolCallId: toolCall.id });
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
                    // Add tool_use content block to track order
                    contentBlocks.push({ type: 'tool_use', toolCallId: toolCall.id });
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
                // Add tool_use content block to track order
                contentBlocks.push({ type: 'tool_use', toolCallId: toolCall.id });
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

                    // Check if this is a Write tool call to a plan file
                    if (toolCall.name === 'Write') {
                      const filePath = toolCall.input?.file_path as string;
                      const plansDir = path.join(os.homedir(), '.claude', 'plans');
                      if (filePath && filePath.startsWith(plansDir) && filePath.endsWith('.md')) {
                        // Read the plan file and emit plan_content event
                        try {
                          const planContent = fs.readFileSync(filePath, 'utf-8');
                          console.log(`[Claude Service] Plan file written: ${filePath}`);

                          // Emit to renderer via IPC
                          if (this.mainWindow) {
                            this.mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_PLAN_CONTENT, {
                              sessionId,
                              planContent,
                              planFilePath: filePath,
                            });
                          }

                          yield { type: 'plan_content', sessionId, planContent, planFilePath: filePath };
                        } catch (err) {
                          console.error(`[Claude Service] Failed to read plan file: ${err}`);
                        }
                      }
                    }
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

            // Check for thinking blocks corruption error
            if (resultMsg.is_error && resultMsg.result?.includes('thinking or redacted_thinking blocks')) {
              console.error('[Claude SDK] Thinking blocks corrupted in transcript for:', sessionId);
              const sdkSessionId = this.sessionStore.get(`sessions.${sessionId}.sdkSessionId`) as string | undefined;

              // Attempt to repair the transcript
              const repaired = await this.repairCorruptedTranscript(sessionId, sdkSessionId);

              if (repaired) {
                yield {
                  type: 'error',
                  error: '⚠️ Thinking blocks were corrupted in the session transcript. The transcript has been repaired by removing the corrupted entries. Please try sending your message again.'
                };
              } else {
                // If repair failed, clear SDK session ID to start fresh
                this.sessionStore.delete(`sessions.${sessionId}.sdkSessionId`);
                yield {
                  type: 'error',
                  error: '⚠️ Thinking blocks were corrupted in the session transcript. Could not repair automatically - starting a fresh session. Please try sending your message again.'
                };
              }
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

      // Post-process content blocks to merge adjacent text blocks only
      // We keep text and tool_use blocks in their natural order, just combining
      // consecutive text blocks that might have been split during streaming
      const mergedBlocks: ContentBlock[] = [];
      for (let i = 0; i < contentBlocks.length; i++) {
        const block = contentBlocks[i];
        const lastMerged = mergedBlocks[mergedBlocks.length - 1];

        if (block.type === 'text') {
          const text = block.text || '';

          // Only merge with immediately preceding text block (not across tools)
          if (lastMerged?.type === 'text') {
            lastMerged.text = (lastMerged.text || '') + text;
          } else {
            mergedBlocks.push({ ...block });
          }
        } else {
          // tool_use block - add as-is
          mergedBlocks.push({ ...block });
        }
      }

      // Create final message with contentBlocks for interleaved rendering
      const message: ChatMessage = {
        id: Date.now().toString(),
        role: 'assistant',
        content: fullContent,
        contentBlocks: mergedBlocks.length > 0 ? mergedBlocks : undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        timestamp: new Date(),
      };

      yield { type: 'message_complete', message };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Check if this is the thinking blocks corruption error
      if (errorMessage.includes('thinking or redacted_thinking blocks') ||
          errorMessage.includes('cannot be modified')) {
        console.error('[Claude SDK] Thinking blocks corrupted (caught in exception):', sessionId);
        const sdkSessionId = this.sessionStore.get(`sessions.${sessionId}.sdkSessionId`) as string | undefined;

        // Attempt to repair the transcript
        const repaired = await this.repairCorruptedTranscript(sessionId, sdkSessionId);

        if (repaired) {
          yield {
            type: 'error',
            error: '⚠️ Session had corrupted thinking data. The transcript has been repaired - please try your message again.'
          };
        } else {
          // If repair failed, clear SDK session ID to start fresh
          this.sessionStore.delete(`sessions.${sessionId}.sdkSessionId`);
          this.sessionStore.delete(`sdkSessionMappings.${sessionId}`);
          yield {
            type: 'error',
            error: '⚠️ Session had corrupted thinking data. Starting fresh session - please try your message again.'
          };
        }
      } else {
        yield { type: 'error', error: errorMessage };
      }
    } finally {
      this.activeQueries.delete(sessionId);
      this.activeQueryObjects.delete(sessionId);
    }
  }

  cancelQuery(sessionId: string): void {
    const controller = this.activeQueries.get(sessionId);
    if (controller) {
      controller.abort();
      this.activeQueries.delete(sessionId);
      this.activeQueryObjects.delete(sessionId);
    }
  }

  /**
   * Inject a message into an active query using streamInput.
   * This allows sending follow-up messages without waiting for the current response to complete.
   * The message will be processed after the next tool call completes.
   */
  async injectMessage(sessionId: string, message: string, attachments?: Attachment[]): Promise<boolean> {
    const queryObj = this.activeQueryObjects.get(sessionId);
    if (!queryObj) {
      console.log('[Claude Service] injectMessage: No active query for session', sessionId);
      return false;
    }

    console.log('[Claude Service] injectMessage: Injecting message into active query for session', sessionId);

    try {
      // Create an async generator that yields a single user message
      async function* createMessageStream(): AsyncIterable<SDKUserMessage> {
        // Build content with any image attachments
        const imageAttachments = attachments?.filter(a => a.type === 'image') || [];
        const hasImages = imageAttachments.length > 0;

        if (hasImages) {
          const content: Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }> = [
            { type: 'text', text: message }
          ];

          for (const attachment of imageAttachments) {
            const ext = attachment.name.split('.').pop()?.toLowerCase();
            const mediaType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
              : ext === 'gif' ? 'image/gif'
              : ext === 'webp' ? 'image/webp'
              : 'image/png';

            content.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: attachment.content,
              },
            });
          }

          yield {
            type: 'user',
            message: {
              role: 'user',
              content: content as any,
            },
            parent_tool_use_id: null,
            session_id: '',
          } as SDKUserMessage;
        } else {
          yield {
            type: 'user',
            message: {
              role: 'user',
              content: message,
            },
            parent_tool_use_id: null,
            session_id: '',
          } as SDKUserMessage;
        }
      }

      await queryObj.streamInput(createMessageStream());
      console.log('[Claude Service] injectMessage: Message injected successfully');
      return true;
    } catch (error) {
      console.error('[Claude Service] injectMessage: Failed to inject message:', error);
      return false;
    }
  }

  /**
   * Check if there's an active query for the given session
   */
  hasActiveQuery(sessionId: string): boolean {
    return this.activeQueryObjects.has(sessionId);
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
   * Repair a corrupted transcript by removing the last assistant message entries
   * that contain corrupted thinking blocks.
   *
   * The error "thinking or redacted_thinking blocks in the latest assistant message
   * cannot be modified" means the last assistant turn's thinking was corrupted.
   * We repair this by removing those entries from the transcript.
   */
  private async repairCorruptedTranscript(sessionId: string, sdkSessionId?: string): Promise<boolean> {
    try {
      // Resolve the SDK session ID
      const resolvedSdkSessionId = sdkSessionId
        || this.sessionStore.get(`sdkSessionMappings.${sessionId}`) as string | undefined
        || this.sessionStore.get(`sessions.${sessionId}.sdkSessionId`) as string | undefined;

      if (!resolvedSdkSessionId) {
        console.log('[Claude] No SDK session ID found, cannot repair transcript');
        return false;
      }

      // Find the transcript file
      const claudeDir = path.join(os.homedir(), '.claude', 'projects');
      const transcriptFilename = `${resolvedSdkSessionId}.jsonl`;

      if (!fs.existsSync(claudeDir)) {
        console.log('[Claude] Claude projects directory not found:', claudeDir);
        return false;
      }

      // Search for the transcript file
      let transcriptPath: string | null = null;
      const projectDirs = fs.readdirSync(claudeDir);
      for (const projectDir of projectDirs) {
        const candidatePath = path.join(claudeDir, projectDir, transcriptFilename);
        if (fs.existsSync(candidatePath)) {
          transcriptPath = candidatePath;
          break;
        }
      }

      if (!transcriptPath) {
        console.log('[Claude] Transcript file not found:', transcriptFilename);
        return false;
      }

      console.log('[Claude] Repairing transcript:', transcriptPath);

      // Read the transcript file
      const content = fs.readFileSync(transcriptPath, 'utf-8');
      const lines = content.trim().split('\n');

      if (lines.length === 0) {
        console.log('[Claude] Transcript is empty, nothing to repair');
        return false;
      }

      // Parse lines to find the last assistant message and remove it
      // We need to find entries that are part of the corrupted assistant turn
      const entries: Array<{ line: string; parsed: Record<string, unknown> }> = [];
      for (const line of lines) {
        if (line.trim()) {
          try {
            const parsed = JSON.parse(line);
            entries.push({ line, parsed });
          } catch {
            // Skip unparseable lines
          }
        }
      }

      // Find the last assistant turn start and remove everything from there
      // Look for message types that indicate an assistant response
      let lastAssistantTurnStart = -1;
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i].parsed;
        // SDK transcript entries have various types
        // Look for 'assistant' type or message with role 'assistant'
        if (entry.type === 'assistant' ||
            (entry.message && (entry.message as Record<string, unknown>).role === 'assistant')) {
          lastAssistantTurnStart = i;
          break;
        }
      }

      if (lastAssistantTurnStart === -1) {
        console.log('[Claude] Could not find last assistant turn to remove');
        return false;
      }

      // Create backup before modifying
      const backupPath = transcriptPath + '.backup.' + Date.now();
      fs.copyFileSync(transcriptPath, backupPath);
      console.log('[Claude] Created transcript backup:', backupPath);

      // Remove entries from the last assistant turn onwards
      const repairedEntries = entries.slice(0, lastAssistantTurnStart);
      const repairedContent = repairedEntries.map(e => e.line).join('\n') + '\n';

      // Write repaired transcript
      fs.writeFileSync(transcriptPath, repairedContent);
      console.log('[Claude] Transcript repaired - removed', entries.length - lastAssistantTurnStart, 'entries');
      console.log('[Claude] Original entries:', entries.length, '-> Repaired entries:', repairedEntries.length);

      return true;
    } catch (error) {
      console.error('[Claude] Error repairing transcript:', error);
      return false;
    }
  }

  /**
   * Get messages from SDK transcript files for a session
   */
  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    // Check if this is a teleported session (imported from claude.ai)
    // Teleported sessions don't have local transcripts - the SDK will resume from the remote session
    const session = this.sessionStore.get(`sessions.${sessionId}`) as Session | undefined;
    if (session?.isTeleported) {
      console.log('[Claude] Teleported session - no local transcript, will resume from remote:', sessionId);
      return [];
    }

    // Get the stored SDK session ID for this session
    // Try new location first, then fall back to old location for backwards compatibility
    const sdkSessionId = this.sessionStore.get(`sdkSessionMappings.${sessionId}`) as string | undefined
      || this.sessionStore.get(`sessions.${sessionId}.sdkSessionId`) as string | undefined
      || sessionId; // If no mapping, use sessionId itself as the transcript filename

    // Look for transcript files in ~/.claude/projects/ - search all project directories
    const claudeDir = path.join(os.homedir(), '.claude', 'projects');
    const transcriptFilename = `${sdkSessionId}.jsonl`;

    try {
      // Search all project directories for the transcript file
      if (!fs.existsSync(claudeDir)) {
        console.log('Claude projects directory not found:', claudeDir);
        return [];
      }

      const projectDirs = fs.readdirSync(claudeDir);
      for (const projectDir of projectDirs) {
        const transcriptPath = path.join(claudeDir, projectDir, transcriptFilename);
        if (fs.existsSync(transcriptPath)) {
          console.log('[Claude] Loading transcript:', transcriptFilename, 'from', projectDir);
          return this.parseTranscriptsFromDir(path.join(claudeDir, projectDir), sdkSessionId);
        }
      }

      console.log('[Claude] Transcript not found:', transcriptFilename);
      return [];
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

      // Map to track messages by their Claude message ID for merging partial messages
      const messageMap = new Map<string, ChatMessage>();

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          const result = this.parseTranscriptEntry(entry);
          if (!result) continue;

          const { msg, messageId } = result;

          // Check if we already have a message with this Claude message ID
          const existing = messageMap.get(messageId);
          if (existing) {
            // Merge content: only add if the new content is different and non-empty
            if (msg.content && msg.content !== existing.content) {
              // If existing has no content, use new content; otherwise don't duplicate
              if (!existing.content) {
                existing.content = msg.content;
              }
              // Don't concatenate - SDK sends the same message multiple times
              // as it streams, we want the final/fullest version
              else if (msg.content.length > existing.content.length) {
                existing.content = msg.content;
              }
            }
            // Merge tool calls
            if (msg.toolCalls && msg.toolCalls.length > 0) {
              if (!existing.toolCalls) {
                existing.toolCalls = msg.toolCalls;
              } else {
                // Add any new tool calls (by id)
                const existingIds = new Set(existing.toolCalls.map(tc => tc.id));
                for (const tc of msg.toolCalls) {
                  if (!existingIds.has(tc.id)) {
                    existing.toolCalls.push(tc);
                  }
                }
              }
            }
          } else {
            // New message
            messageMap.set(messageId, msg);
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
   * Returns the message ID for deduplication (may differ from the ChatMessage.id)
   */
  private parseTranscriptEntry(entry: Record<string, unknown>): { msg: ChatMessage; messageId: string } | null {
    // SDK transcript format varies - handle different message types
    const type = entry.type as string;

    // Extract the actual Claude message ID for deduplication
    // SDK writes multiple JSONL lines per message (thinking, text, tool_use blocks)
    // entry.uuid is unique per line, but entry.message.id is the actual message ID
    const message = entry.message as Record<string, unknown> | undefined;
    const claudeMessageId = (message?.id as string) || (entry.uuid as string) || (entry.id as string);

    if (type === 'user' || type === 'human') {
      const content = this.extractContent(entry);
      if (!content) return null;
      return {
        msg: {
          id: (entry.uuid as string) || `user-${Date.now()}-${Math.random()}`,
          role: 'user',
          content,
          timestamp: entry.timestamp ? new Date(entry.timestamp as string) : new Date(),
        },
        messageId: claudeMessageId,
      };
    }

    if (type === 'assistant') {
      const content = this.extractContent(entry);
      const toolCalls = this.extractToolCalls(entry);
      return {
        msg: {
          id: (entry.uuid as string) || `assistant-${Date.now()}-${Math.random()}`,
          role: 'assistant',
          content: content || '',
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          timestamp: entry.timestamp ? new Date(entry.timestamp as string) : new Date(),
        },
        messageId: claudeMessageId,
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
