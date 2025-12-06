import { IpcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import { ClaudeService } from '../services/claude.service';
import { getMainWindow } from '../index';

const claudeService = new ClaudeService();

export function registerClaudeHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(
    IPC_CHANNELS.CLAUDE_SEND_MESSAGE,
    async (_, sessionId: string, message: string, attachments?: unknown[]) => {
      const mainWindow = getMainWindow();
      if (!mainWindow) return;

      try {
        // Stream the response
        for await (const event of claudeService.streamMessage(sessionId, message, attachments)) {
          switch (event.type) {
            case 'text_delta':
              mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_STREAM_CHUNK, {
                sessionId,
                content: event.content,
              });
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
                result: event.result,
              });
              break;

            case 'message_complete':
              mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_STREAM_END, {
                sessionId,
                message: event.message,
              });
              break;

            case 'error':
              mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_STREAM_ERROR, {
                sessionId,
                error: event.error,
              });
              break;
          }
        }
      } catch (error) {
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
