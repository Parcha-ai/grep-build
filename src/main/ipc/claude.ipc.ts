import { IpcMain } from 'electron';
import Store from 'electron-store';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import { ClaudeService } from '../services/claude.service';
import { getMainWindow } from '../index';
import type { QuestionResponse, Attachment, PlanApprovalResponse } from '../../shared/types';
import { DEFAULT_AUDIO_SETTINGS } from '../../shared/types/audio';

// Settings store for Ralph Loop check
const settingsStore = new Store({ name: 'claudette-settings' });

// Ralph Loop completion marker
const RALPH_LOOP_COMPLETION_MARKER = '<promise>COMPLETE</promise>';

const claudeService = new ClaudeService();

/**
 * Check if Ralph Loop should continue based on settings and completion state
 */
function shouldRalphLoopContinue(permissionMode: string | undefined, messageContent: string): boolean {
  // Only applies in Grep It mode (bypassPermissions)
  if (permissionMode !== 'bypassPermissions') {
    return false;
  }

  // Check if Ralph Loop is enabled in settings
  const audioSettings = settingsStore.get('audioSettings') as typeof DEFAULT_AUDIO_SETTINGS | undefined;
  const ralphLoopEnabled = audioSettings?.ralphLoopEnabled ?? DEFAULT_AUDIO_SETTINGS.ralphLoopEnabled;

  if (!ralphLoopEnabled) {
    return false;
  }

  // Check if the completion marker is present
  const hasCompletionMarker = messageContent.includes(RALPH_LOOP_COMPLETION_MARKER);

  // Continue if no completion marker found
  return !hasCompletionMarker;
}

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
  // NOTE: mainWindow reference is set directly in index.ts after window creation
  // Don't try to set it here as the window doesn't exist yet during IPC registration

  // Handler to get available models
  ipcMain.handle(IPC_CHANNELS.CLAUDE_GET_MODELS, async () => {
    return claudeService.getAvailableModels();
  });

  ipcMain.handle(
    IPC_CHANNELS.CLAUDE_SEND_MESSAGE,
    async (_, sessionId: string, message: string, attachments?: Attachment[], permissionMode?: string, thinkingMode?: string, model?: string) => {
      const mainWindow = getMainWindow();
      if (!mainWindow) return;

      // Ensure claudeService has the mainWindow reference for browser updates
      claudeService.setMainWindow(mainWindow);

      console.log('[Claude IPC] sendMessage received with attachments:', attachments?.length || 0, 'model:', model);
      if (attachments) {
        attachments.forEach((a, i) => {
          console.log(`[Claude IPC] Attachment ${i}: type=${a?.type}, name=${a?.name}, content length=${a?.content?.length || 0}`);
        });
      }

      // Ralph Loop state
      const originalMessage = message;
      let currentMessage = message;
      let currentAttachments = attachments;
      let loopIteration = 0;
      const MAX_RALPH_LOOP_ITERATIONS = 50; // Safety limit to prevent infinite loops

      // Ralph Loop - keep processing until task is complete
      // eslint-disable-next-line no-constant-condition
      while (true) {
        loopIteration++;

        // Safety check for infinite loops
        if (loopIteration > MAX_RALPH_LOOP_ITERATIONS) {
          console.warn('[Claude IPC] Ralph Loop hit max iterations, stopping');
          mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_STREAM_ERROR, {
            sessionId,
            error: 'Ralph Loop reached maximum iterations (50). Add <promise>COMPLETE</promise> to signal task completion.',
          });
          break;
        }

        if (loopIteration > 1) {
          console.log(`[Claude IPC] Ralph Loop iteration ${loopIteration} - continuing work...`);
        }

        // Create batcher for this session
        const batcher = new ChunkBatcher(
          sessionId,
          (content) => mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_STREAM_CHUNK, { sessionId, content }),
          (content) => mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_THINKING_CHUNK, { sessionId, content })
        );

        let fullMessageContent = '';
        let shouldContinue = false;
        let hadError = false;

        try {
          // Stream the response
          for await (const event of claudeService.streamMessage(sessionId, currentMessage, currentAttachments, permissionMode, thinkingMode, model)) {
            switch (event.type) {
              case 'text_delta':
                batcher.addText(event.content || '');
                fullMessageContent += event.content || '';
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
                // Flush any remaining batched content
                batcher.flush();

                // Check if Ralph Loop should continue
                shouldContinue = shouldRalphLoopContinue(permissionMode, fullMessageContent);

                if (shouldContinue) {
                  // Don't send STREAM_END yet - we're continuing
                  // Send a special event to indicate we're looping
                  mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_STREAM_CHUNK, {
                    sessionId,
                    content: '\n\n---\n*[Ralph Loop: Task not complete, continuing...]*\n\n',
                  });
                } else {
                  // Task is complete or Ralph Loop is disabled
                  mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_STREAM_END, {
                    sessionId,
                    message: event.message,
                  });
                }
                break;

              case 'error':
                // Flush any remaining batched content before error
                batcher.flush();
                mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_STREAM_ERROR, {
                  sessionId,
                  error: event.error,
                });
                hadError = true;
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
          hadError = true;
        }

        // Exit the loop if there was an error or if we shouldn't continue
        if (hadError || !shouldContinue) {
          break;
        }

        // Prepare for next iteration
        // Use a continuation prompt that references the original task
        currentMessage = `Continue working on the original task. The original request was:\n\n"${originalMessage}"\n\nYou have not yet output <promise>COMPLETE</promise> to indicate the task is finished. Please continue until the task is objectively complete, then output <promise>COMPLETE</promise>.`;
        currentAttachments = undefined; // Don't re-send attachments on continuation
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

  // Auto-resume handlers for Grep It mode
  // Save streaming state before app closes (called by renderer)
  ipcMain.handle(IPC_CHANNELS.AUTO_RESUME_SAVE_STATE, async (_, state: {
    sessionId: string;
    wasStreaming: boolean;
    permissionMode: string;
    lastMessage?: string;
  }) => {
    console.log('[Claude IPC] Saving auto-resume state:', state.sessionId, 'wasStreaming:', state.wasStreaming);
    settingsStore.set('autoResumeState', {
      ...state,
      timestamp: Date.now(),
    });
    return { success: true };
  });

  // Get saved auto-resume state (called by renderer on startup)
  ipcMain.handle(IPC_CHANNELS.AUTO_RESUME_GET_STATE, async () => {
    const state = settingsStore.get('autoResumeState') as {
      sessionId: string;
      wasStreaming: boolean;
      permissionMode: string;
      lastMessage?: string;
      timestamp: number;
    } | undefined;

    if (!state) {
      return null;
    }

    // Only return state if it's recent (within last 5 minutes)
    // Older states are likely stale
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    if (state.timestamp < fiveMinutesAgo) {
      console.log('[Claude IPC] Auto-resume state is stale, ignoring');
      settingsStore.delete('autoResumeState');
      return null;
    }

    console.log('[Claude IPC] Retrieved auto-resume state:', state.sessionId);
    return state;
  });

  // Clear auto-resume state (called when session completes normally)
  ipcMain.handle(IPC_CHANNELS.AUTO_RESUME_CLEAR_STATE, async () => {
    console.log('[Claude IPC] Clearing auto-resume state');
    settingsStore.delete('autoResumeState');
    return { success: true };
  });

  // Handle plan approval responses from user
  ipcMain.handle(IPC_CHANNELS.CLAUDE_PLAN_APPROVAL_RESPONSE, async (_, response: PlanApprovalResponse) => {
    console.log('[Claude IPC] Plan approval response:', response);
    claudeService.handlePlanApprovalResponse(response);
  });
}

// Export the claude service instance so it can be updated with mainWindow reference
export { claudeService };
