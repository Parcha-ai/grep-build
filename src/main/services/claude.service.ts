import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import Store from 'electron-store';
import type { ChatMessage, ToolCall, Session } from '../../shared/types';

interface StreamEvent {
  type: 'text_delta' | 'tool_use' | 'tool_result' | 'message_complete' | 'error' | 'system';
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
    this.store = new Store({ name: 'claudette-settings' });
    this.sessionStore = new Store({ name: 'claudette-sessions' });
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
    _attachments?: unknown[]
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
      // Use the Claude Agent SDK query function with Claude Code's system prompt
      const messages = query({
        prompt: userMessage,
        options: {
          cwd: session.worktreePath || session.repoPath || process.cwd(),
          abortController,
          permissionMode: 'acceptEdits', // Accept file edits, prompt for bash
          includePartialMessages: true,
          model: 'claude-sonnet-4-20250514',
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
        },
      });

      let fullContent = '';
      const toolCalls: ToolCall[] = [];

      for await (const msg of messages) {
        if (abortController.signal.aborted) {
          yield { type: 'error', error: 'Query cancelled' };
          return;
        }

        // Handle different message types from the SDK
        switch (msg.type) {
          case 'system':
            // System message with tool/model info
            yield {
              type: 'system',
              systemInfo: {
                tools: (msg as SDKMessage & { tools?: string[] }).tools || [],
                model: (msg as SDKMessage & { model?: string }).model || '',
              },
            };
            break;

          case 'assistant': {
            // Full assistant message
            const assistantMsg = msg as SDKMessage & { message?: { content?: Array<{ type: string; text?: string; name?: string; id?: string; input?: Record<string, unknown> }> } };
            if (assistantMsg.message?.content) {
              for (const block of assistantMsg.message.content) {
                if (block.type === 'text' && block.text) {
                  const newContent = block.text.slice(fullContent.length);
                  if (newContent) {
                    fullContent = block.text;
                    yield { type: 'text_delta', content: newContent };
                  }
                } else if (block.type === 'tool_use') {
                  const toolCall: ToolCall = {
                    id: block.id || '',
                    name: block.name || '',
                    input: block.input || {},
                    status: 'running',
                    startedAt: new Date(),
                  };
                  toolCalls.push(toolCall);
                  yield { type: 'tool_use', toolCall };
                }
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
}
