import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import Store from 'electron-store';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
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

  /**
   * Get project slug from path - matches SDK's convention
   */
  private getProjectSlug(projectPath: string): string {
    // SDK uses a slug based on the absolute path
    // Format: sanitized path with special chars replaced
    return projectPath
      .replace(/^\//, '')
      .replace(/\//g, '-')
      .replace(/[^a-zA-Z0-9-_]/g, '_')
      .toLowerCase();
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
        return this.parseTranscriptsFromDir(path.join(claudeDir, matchingDir));
      }

      return this.parseTranscriptsFromDir(projectDir);
    } catch (error) {
      console.error('Error reading transcripts:', error);
      return [];
    }
  }

  /**
   * Parse all JSONL transcript files from a directory into ChatMessages
   */
  private parseTranscriptsFromDir(dir: string): ChatMessage[] {
    const messages: ChatMessage[] = [];
    const seenIds = new Set<string>();

    try {
      const files = fs.readdirSync(dir)
        .filter(f => f.endsWith('.jsonl'))
        .sort(); // Sort to get chronological order

      for (const file of files) {
        const filePath = path.join(dir, file);
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
        id: (entry.id as string) || `user-${Date.now()}-${Math.random()}`,
        role: 'user',
        content,
        timestamp: entry.timestamp ? new Date(entry.timestamp as string) : new Date(),
      };
    }

    if (type === 'assistant') {
      const content = this.extractContent(entry);
      const toolCalls = this.extractToolCalls(entry);
      return {
        id: (entry.id as string) || `assistant-${Date.now()}-${Math.random()}`,
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
