import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import Store from 'electron-store';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ChatMessage, ToolCall, Session, QuestionRequest, QuestionResponse } from '../../shared/types';
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
                text: `Captured snapshot of ${url} but screenshot failed to capture. HTML is available:\n\n${snapshot.html.slice(0, 2000)}${snapshot.html.length > 2000 ? '...(truncated)' : ''}`,
              }],
            };
          }

          // Return snapshot info with image
          return {
            content: [
              {
                type: 'text',
                text: `Captured snapshot of ${url}\n\nHTML Preview:\n${snapshot.html.slice(0, 2000)}${snapshot.html.length > 2000 ? '...(truncated)' : ''}`,
              },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: screenshotData,
                },
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

    const mcpServer = createSdkMcpServer({
      name: 'claudette-browser',
      version: '1.0.0',
      tools: [browserSnapshotTool],
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _attachments?: unknown[],
    permissionMode?: string,
    thinkingMode?: string
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
      const sdkSessionId = this.sessionStore.get(`sessions.${sessionId}.sdkSessionId`) as string | undefined;

      // Validate and cast permission mode to SDK type
      const validModes = ['default', 'acceptEdits', 'plan'] as const;
      type SDKPermissionMode = typeof validModes[number];
      const sdkPermissionMode: SDKPermissionMode = validModes.includes(permissionMode as SDKPermissionMode)
        ? (permissionMode as SDKPermissionMode)
        : 'acceptEdits';

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

      // Use the Claude Agent SDK query function with Claude Code's system prompt
      const messages = query({
        prompt: userMessage,
        options: {
          cwd: session.worktreePath || session.repoPath || process.cwd(),
          abortController,
          permissionMode: sdkPermissionMode,
          includePartialMessages: true,
          // Use Claude Sonnet 4.5 (latest) with extended thinking enabled
          model: 'claude-sonnet-4-5-20250929',
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
          // Add custom browser snapshot tool via MCP server
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

            // Store the SDK session ID for future resume calls
            if (systemMsg.session_id) {
              this.sessionStore.set(`sessions.${sessionId}.sdkSessionId`, systemMsg.session_id);
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

          case 'result':
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
    const sdkSessionId = this.sessionStore.get(`sessions.${sessionId}.sdkSessionId`) as string | undefined;

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
