import { IpcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import { ClaudeService } from '../services/claude.service';
import { getMainWindow } from '../index';
import type { QuestionResponse, Attachment } from '../../shared/types';

const claudeService = new ClaudeService();

// Batching helper to reduce IPC overhead
class ChunkBatcher {
  private textBuffer = '';
  private thinkingBuffer = '';
  private textTimer: NodeJS.Timeout | null = null;
  private thinkingTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_DELAY = 100; // 10 updates/sec - much smoother for markdown parsing

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
  // Set the main window reference for the Claude service
  const mainWindow = getMainWindow();
  if (mainWindow) {
    claudeService.setMainWindow(mainWindow);
  }

  // Handler to get available models
  ipcMain.handle(IPC_CHANNELS.CLAUDE_GET_MODELS, async () => {
    return claudeService.getAvailableModels();
  });

  ipcMain.handle(
    IPC_CHANNELS.CLAUDE_SEND_MESSAGE,
    async (_, sessionId: string, message: string, attachments?: Attachment[], permissionMode?: string, thinkingMode?: string, model?: string) => {
      const mainWindow = getMainWindow();
      if (!mainWindow) return;

      console.log('[Claude IPC] sendMessage received with attachments:', attachments?.length || 0, 'model:', model);
      if (attachments) {
        attachments.forEach((a, i) => {
          console.log(`[Claude IPC] Attachment ${i}: type=${a?.type}, name=${a?.name}, content length=${a?.content?.length || 0}`);
        });
      }

      // Create batcher for this session
      const batcher = new ChunkBatcher(
        sessionId,
        (content) => mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_STREAM_CHUNK, { sessionId, content }),
        (content) => mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_THINKING_CHUNK, { sessionId, content })
      );

      try {
        // Stream the response
        for await (const event of claudeService.streamMessage(sessionId, message, attachments, permissionMode, thinkingMode, model)) {
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

            case 'permission_request':
              mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_PERMISSION_REQUEST, {
                ...event,
                sessionId,
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

  // Handle permission responses from user
  ipcMain.handle(IPC_CHANNELS.CLAUDE_PERMISSION_RESPONSE, async (_, response: { requestId: string; approved: boolean; modifiedInput?: Record<string, unknown> }) => {
    console.log('[Claude IPC] Permission response received:', response.requestId, 'approved:', response.approved);
    claudeService.handlePermissionResponse(response);
  });

  // Handle question responses from user
  ipcMain.handle(IPC_CHANNELS.CLAUDE_QUESTION_RESPONSE, async (_, response: QuestionResponse) => {
    console.log('[Claude IPC] Question response:', response);
    claudeService.handleQuestionResponse(response);
  });
}

// Export the claude service instance so it can be updated with mainWindow reference
export { claudeService };
