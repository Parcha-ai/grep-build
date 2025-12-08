import { IpcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import { ClaudeService } from '../services/claude.service';
import { getMainWindow } from '../index';

const claudeService = new ClaudeService();

// Batching helper to reduce IPC overhead
class ChunkBatcher {
  private textBuffer = '';
  private thinkingBuffer = '';
  private textTimer: NodeJS.Timeout | null = null;
  private thinkingTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_DELAY = 16; // ~60fps, balances responsiveness with efficiency

  constructor(
    private sessionId: string,
    private sendText: (content: string) => void,
    private sendThinking: (content: string) => void
  ) {}

  addText(content: string) {
    this.textBuffer += content;
    if (!this.textTimer) {
      this.textTimer = setTimeout(() => this.flushText(), this.BATCH_DELAY);
    }
  }

  addThinking(content: string) {
    this.thinkingBuffer += content;
    if (!this.thinkingTimer) {
      this.thinkingTimer = setTimeout(() => this.flushThinking(), this.BATCH_DELAY);
    }
  }

  flushText() {
    if (this.textBuffer) {
      this.sendText(this.textBuffer);
      this.textBuffer = '';
    }
    if (this.textTimer) {
      clearTimeout(this.textTimer);
      this.textTimer = null;
    }
  }

  flushThinking() {
    if (this.thinkingBuffer) {
      this.sendThinking(this.thinkingBuffer);
      this.thinkingBuffer = '';
    }
    if (this.thinkingTimer) {
      clearTimeout(this.thinkingTimer);
      this.thinkingTimer = null;
    }
  }

  flush() {
    this.flushText();
    this.flushThinking();
  }
}

export function registerClaudeHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(
    IPC_CHANNELS.CLAUDE_SEND_MESSAGE,
    async (_, sessionId: string, message: string, attachments?: unknown[], permissionMode?: string, thinkingMode?: string) => {
      const mainWindow = getMainWindow();
      if (!mainWindow) return;

      // Create batcher for this session
      const batcher = new ChunkBatcher(
        sessionId,
        (content) => mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_STREAM_CHUNK, { sessionId, content }),
        (content) => mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_THINKING_CHUNK, { sessionId, content })
      );

      try {
        // Stream the response
        for await (const event of claudeService.streamMessage(sessionId, message, attachments, permissionMode, thinkingMode)) {
          switch (event.type) {
            case 'text_delta':
              batcher.addText(event.content || '');
              break;

            case 'thinking_delta':
              batcher.addThinking(event.content || '');
              break;

            case 'tool_use':
              mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_TOOL_CALL, {
                sessionId,
                toolCall: event.toolCall,
              });
              break;

            case 'tool_result':
              mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_TOOL_RESULT, {
                sessionId,
                toolCall: event.toolCall,
              });
              break;

            case 'system':
              mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_SYSTEM_INFO, {
                sessionId,
                systemInfo: event.systemInfo,
              });
              break;

            case 'message_complete':
              // Flush any remaining batched content before completing
              batcher.flush();
              mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_STREAM_END, {
                sessionId,
                message: event.message,
              });
              break;

            case 'error':
              // Flush any remaining batched content before error
              batcher.flush();
              mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_STREAM_ERROR, {
                sessionId,
                error: event.error,
              });
              break;
          }
        }
      } catch (error) {
        // Flush any remaining batched content before error
        batcher.flush();
        mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_STREAM_ERROR, {
          sessionId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  ipcMain.on(IPC_CHANNELS.CLAUDE_CANCEL, (_, sessionId: string) => {
    claudeService.cancelQuery(sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.CLAUDE_GET_MESSAGES, async (_, sessionId: string) => {
    return claudeService.getMessages(sessionId);
  });
}
