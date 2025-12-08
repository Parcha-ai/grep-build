import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import Store from 'electron-store';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ChatMessage, ToolCall, Session } from '../../shared/types';

interface StreamEvent {
  type: 'text_delta' | 'thinking_delta' | 'tool_use' | 'tool_result' | 'message_complete' | 'error' | 'system';
  content?: string;
  toolCall?: ToolCall;
  result?: unknown;
  message?: ChatMessage;
  error?: string;
  systemInfo?: {
    tools: string[];
    model: string;
  };
}

export class ClaudeService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private store: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sessionStore: any;
  private activeQueries: Map<string, AbortController> = new Map();

  constructor() {
    this.store = new Store({ name: 'grep-settings' });
    this.sessionStore = new Store({ name: 'grep-sessions' });
  }

  getApiKey(): string | undefined {
    return this.store.get('anthropicApiKey') as string | undefined;
  }

  setApiKey(apiKey: string): void {
    this.store.set('anthropicApiKey', apiKey);
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
        },
      });

      let fullContent = '';
      const toolCalls: ToolCall[] = [];

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
                  fullContent += event.delta.text;
                  yield { type: 'text_delta', content: event.delta.text };
                } else if (event.delta.type === 'thinking_delta' && event.delta.thinking) {
                  // Emit thinking updates as separate event type
                  yield { type: 'thinking_delta', content: event.delta.thinking };
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
                  // Find and update the corresponding tool call
                  const toolCall = toolCalls.find(tc => tc.id === block.tool_use_id);
                  if (toolCall) {
                    toolCall.status = 'completed';
                    toolCall.result = block.content;
                    toolCall.completedAt = new Date();
                    yield { type: 'tool_result', toolCall, result: block.content };
                  }
                }
              }
            }
            break;
          }

          case 'result':
            // Final result message with cost info - no action needed
            break;

          default:
            // Silently ignore unhandled message types
            break;
        }
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
