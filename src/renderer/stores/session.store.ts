import { create } from 'zustand';
import type { Session, ChatMessage, ToolCall, PermissionRequest, PermissionResponse, QuestionRequest, QuestionResponse, SetupProgressEvent, CompactionStatus, CompactionComplete, PlanApprovalRequest, PlanApprovalResponse } from '../../shared/types';

// Check if running in Electron environment
const hasElectronAPI = typeof window !== 'undefined' && !!window.electronAPI;

interface SystemInfo {
  tools: string[];
  model: string;
}

// Permission modes from Claude Agent SDK
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk';

// Thinking modes: off (0), thinking (10k tokens), ultrathink (100k tokens)
export type ThinkingMode = 'off' | 'thinking' | 'ultrathink';

// Background task for backgrounded Bash commands
export interface BackgroundTask {
  id: string;              // Tool call ID
  sessionId: string;       // Parent session
  command: string;         // The bash command
  outputFile?: string;     // Path from SDK result
  output: string;          // Accumulated output
  status: 'running' | 'completed' | 'error';
  startedAt: Date;
  completedAt?: Date;
}

// Chronological event for rendering in order
export interface StreamEvent {
  id: string;
  type: 'thinking' | 'tool' | 'text';
  timestamp: number;
  content?: string;
  toolCall?: ToolCall;
}

// Model info type
export interface ModelInfo {
  id: string;
  name: string;
  description: string;
}

interface SessionState {
  sessions: Session[];
  activeSessionId: string | null;
  isLoadingSessions: boolean;
  messages: Record<string, ChatMessage[]>;
  isStreaming: Record<string, boolean>;
  streamEvents: Record<string, StreamEvent[]>; // Chronological events
  currentStreamContent: Record<string, string>;
  currentThinkingContent: Record<string, string>;
  currentToolCalls: Record<string, ToolCall[]>;
  currentSystemInfo: Record<string, SystemInfo | null>;
  permissionMode: Record<string, PermissionMode>;
  thinkingMode: Record<string, ThinkingMode>;
  selectedModel: Record<string, string>;
  availableModels: ModelInfo[];
  pendingPermission: Record<string, PermissionRequest | null>;
  pendingQuestion: Record<string, QuestionRequest | null>;
  pendingPlanApproval: Record<string, PlanApprovalRequest | null>;
  setupProgress: Record<string, SetupProgressEvent | null>;
  compactionStatus: Record<string, CompactionStatus | null>;
  messageQueue: Record<string, Array<{
    id: string;
    message: string;
    attachments?: unknown[];
    timestamp: number;
  }>>;
  backgroundTasks: Record<string, BackgroundTask[]>;

  setActiveSession: (sessionId: string | null) => void;
  addSession: (session: Session) => void;
  loadSessions: () => Promise<void>;
  createSession: (config: {
    name: string;
    repoUrl: string;
    branch: string;
    setupScript?: string;
  }) => Promise<Session>;
  startSession: (sessionId: string) => Promise<void>;
  stopSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  updateSession: (sessionId: string, updates: Partial<Session>) => Promise<void>;
  refreshSessionBranch: (sessionId: string) => Promise<string | null>;
  subscribeToSessionChanges: () => () => void;

  // Chat
  addMessage: (sessionId: string, message: ChatMessage) => void;
  updateStreamContent: (sessionId: string, content: string) => void;
  updateThinkingContent: (sessionId: string, content: string) => void;
  addToolCall: (sessionId: string, toolCall: ToolCall) => void;
  updateToolCall: (sessionId: string, toolCallId: string, updates: Partial<ToolCall>) => void;
  setStreaming: (sessionId: string, isStreaming: boolean) => void;
  setSystemInfo: (sessionId: string, systemInfo: SystemInfo | null) => void;
  setPermissionMode: (sessionId: string, mode: PermissionMode) => void;
  cyclePermissionMode: (sessionId: string) => void;
  setThinkingMode: (sessionId: string, mode: ThinkingMode) => void;
  cycleThinkingMode: (sessionId: string) => void;
  setSelectedModel: (sessionId: string, model: string) => void;
  loadAvailableModels: () => Promise<void>;
  sendMessage: (sessionId: string, message: string, attachments?: unknown[]) => Promise<void>;
  loadMessages: (sessionId: string) => Promise<void>;
  subscribeToClaude: () => () => void;
  // Permission handling
  setPendingPermission: (sessionId: string, request: PermissionRequest | null) => void;
  approvePermission: (sessionId: string, modifiedInput?: Record<string, unknown>, alwaysApprove?: boolean) => Promise<void>;
  denyPermission: (sessionId: string) => Promise<void>;
  // Question handling
  setPendingQuestion: (sessionId: string, request: QuestionRequest | null) => void;
  answerQuestion: (sessionId: string, answers: Record<string, string>) => Promise<void>;
  // Plan approval handling
  setPendingPlanApproval: (sessionId: string, request: PlanApprovalRequest | null) => void;
  approvePlan: (sessionId: string) => Promise<void>;
  rejectPlan: (sessionId: string) => Promise<void>;
  // Queue management
  removeFromQueue: (sessionId: string, messageId: string) => void;
  editQueuedMessage: (sessionId: string, messageId: string, newMessage: string) => void;
  moveToFront: (sessionId: string, messageId: string) => void;
  clearQueue: (sessionId: string) => void;
  interruptAndSend: (sessionId: string, message: string, attachments?: unknown[]) => Promise<void>;
  cancelStream: (sessionId: string) => void;
  // Setup progress
  setSetupProgress: (sessionId: string, progress: SetupProgressEvent | null) => void;
  subscribeToSetupProgress: () => () => void;
  // Background tasks
  addBackgroundTask: (sessionId: string, task: BackgroundTask) => void;
  updateBackgroundTask: (sessionId: string, taskId: string, updates: Partial<BackgroundTask>) => void;
  removeBackgroundTask: (sessionId: string, taskId: string) => void;
  subscribeToBackgroundTasks: () => () => void;
  // Compaction status (Smart Compact feature)
  setCompactionStatus: (sessionId: string, status: CompactionStatus | null) => void;
  subscribeToCompaction: () => () => void;
  // Auto-resume for Grep It mode
  saveAutoResumeState: (sessionId: string) => Promise<void>;
  clearAutoResumeState: () => Promise<void>;
  checkAndAutoResume: () => Promise<void>;
  setupAutoResumeOnClose: () => () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  isLoadingSessions: true, // Start as loading
  messages: {},
  isStreaming: {},
  streamEvents: {}, // Chronological event stream
  currentStreamContent: {},
  currentThinkingContent: {},
  currentToolCalls: {},
  currentSystemInfo: {},
  permissionMode: {},
  thinkingMode: {},
  selectedModel: {},
  availableModels: [],
  pendingPermission: {},
  pendingQuestion: {},
  pendingPlanApproval: {},
  setupProgress: {},
  compactionStatus: {},
  messageQueue: {},
  backgroundTasks: {},

  setActiveSession: async (sessionId) => {
    const { loadMessages, startSession } = get();

    set((state) => {
      // Update the session's updatedAt timestamp when it becomes active
      const updatedSessions = sessionId
        ? state.sessions.map(session =>
            session.id === sessionId
              ? { ...session, updatedAt: new Date() }
              : session
          )
        : state.sessions;

      // Restore the session's model selection from persisted session data
      const session = sessionId ? state.sessions.find(s => s.id === sessionId) : null;
      const restoredModel = (session?.model && sessionId) ? { [sessionId]: session.model } : {};

      return {
        activeSessionId: sessionId,
        sessions: updatedSessions,
        selectedModel: {
          ...state.selectedModel,
          ...restoredModel,
        },
      };
    });

    // Persist active session and update timestamp in backend (only in Electron)
    if (hasElectronAPI && sessionId) {
      window.electronAPI.dev.setActiveSession(sessionId);
      window.electronAPI.sessions.update(sessionId, { updatedAt: new Date() });

      // Auto-start the session if it's stopped
      const session = get().sessions.find(s => s.id === sessionId);
      if (session && session.status === 'stopped') {
        await startSession(sessionId);
      }

      // Load messages for this session from SDK transcripts
      await loadMessages(sessionId);

      // Check if this session has worktree instructions that haven't been sent yet
      const currentSession = get().sessions.find(s => s.id === sessionId);
      if (currentSession?.worktreeInstructions && !currentSession.worktreeInstructionsSent) {
        console.log('[SessionStore] Session has worktree instructions, sending as first message');

        // Mark instructions as sent FIRST to prevent double-sending
        await window.electronAPI.sessions.update(sessionId, { worktreeInstructionsSent: true });
        set((state) => ({
          sessions: state.sessions.map(s =>
            s.id === sessionId ? { ...s, worktreeInstructionsSent: true } : s
          ),
        }));

        // Send instructions as the first message to Claude
        const { sendMessage } = get();
        const instructionsMessage = `## Worktree Setup Instructions\n\nThis is a new worktree session. Please follow these setup instructions:\n\n${currentSession.worktreeInstructions}`;
        sendMessage(sessionId, instructionsMessage);
      }
    }
  },

  addSession: (session) => {
    set((state) => ({ sessions: [...state.sessions, session] }));
  },

  loadSessions: async () => {
    if (!hasElectronAPI) {
      set({ isLoadingSessions: false });
      return;
    }
    try {
      const allSessions = await window.electronAPI.sessions.list();
      const activeSessionId = await window.electronAPI.dev.getActiveSession();

      // Load ALL sessions - filtering for display happens in SessionList component
      const sessions = allSessions
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      // Verify the active session still exists
      const sessionExists = sessions.some((s) => s.id === activeSessionId);
      let validActiveSessionId = sessionExists ? activeSessionId : null;
      let autoSelected = false;

      // Auto-select most recent session if no active session
      if (!validActiveSessionId && sessions.length > 0) {
        // Prefer running sessions, then most recent by updatedAt
        const runningSession = sessions
          .filter(s => s.status === 'running')
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];

        const mostRecentSession = sessions
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];

        validActiveSessionId = runningSession?.id || mostRecentSession?.id || null;
        autoSelected = true;
        console.log('[SessionStore] Auto-selected session:', validActiveSessionId);
      }

      // Restore the model for the active session
      const activeSession = validActiveSessionId
        ? sessions.find(s => s.id === validActiveSessionId)
        : null;
      const restoredModel = activeSession?.model
        ? { [validActiveSessionId!]: activeSession.model }
        : {};

      set({
        sessions,
        activeSessionId: validActiveSessionId,
        isLoadingSessions: false,
        selectedModel: restoredModel,
      });

      // Persist auto-selected session
      if (autoSelected && validActiveSessionId) {
        window.electronAPI.dev.setActiveSession(validActiveSessionId);
      }

      // Load messages for the active session
      if (validActiveSessionId) {
        const { loadMessages } = get();
        loadMessages(validActiveSessionId);
      }
    } catch (error) {
      console.error('Failed to load sessions:', error);
      set({ isLoadingSessions: false });
    }
  },

  createSession: async (config) => {
    if (!hasElectronAPI) throw new Error('Not running in Electron');
    const session = await window.electronAPI.sessions.create(config);
    set((state) => ({ sessions: [...state.sessions, session] }));
    return session;
  },

  startSession: async (sessionId) => {
    if (!hasElectronAPI) return;
    await window.electronAPI.sessions.start(sessionId);
  },

  stopSession: async (sessionId) => {
    if (!hasElectronAPI) return;
    await window.electronAPI.sessions.stop(sessionId);
  },

  deleteSession: async (sessionId) => {
    if (!hasElectronAPI) return;
    await window.electronAPI.sessions.delete(sessionId);
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== sessionId),
      activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
    }));
  },

  updateSession: async (sessionId, updates) => {
    if (!hasElectronAPI) return;
    const session = await window.electronAPI.sessions.update(sessionId, updates);
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === sessionId ? session : s)),
    }));
  },

  refreshSessionBranch: async (sessionId) => {
    if (!hasElectronAPI) return null;
    try {
      const status = await window.electronAPI.git.getStatus(sessionId);
      const currentBranch = status?.current;
      if (!currentBranch) return null;

      // Check if branch changed
      const session = get().sessions.find(s => s.id === sessionId);
      if (session && session.branch !== currentBranch) {
        // Update the session with the new branch
        const updatedSession = await window.electronAPI.sessions.update(sessionId, { branch: currentBranch });
        set((state) => ({
          sessions: state.sessions.map((s) => (s.id === sessionId ? updatedSession : s)),
        }));
        console.log(`[SessionStore] Branch updated: ${session.branch} → ${currentBranch}`);
      }
      return currentBranch;
    } catch (error) {
      console.error('[SessionStore] Failed to refresh branch:', error);
      return null;
    }
  },

  subscribeToSessionChanges: () => {
    if (!hasElectronAPI) return () => {};

    // Subscribe to individual session status changes
    const unsubscribeStatus = window.electronAPI.sessions.onStatusChanged((session) => {
      if (!session?.id) return;
      set((state) => ({
        sessions: state.sessions.map((s) => (s.id === session.id ? session : s)),
      }));
    });

    // Subscribe to full session list updates (from background discovery)
    const unsubscribeList = window.electronAPI.sessions.onListUpdated((sessions) => {
      console.log('[SessionStore] Received sessions update from background discovery:', sessions.length);
      set({ sessions, isLoadingSessions: false });
    });

    return () => {
      unsubscribeStatus();
      unsubscribeList();
    };
  },

  // Chat methods
  addMessage: (sessionId, message) => {
    set((state) => ({
      messages: {
        ...state.messages,
        [sessionId]: [...(state.messages[sessionId] || []), message],
      },
    }));
  },

  updateStreamContent: (sessionId, content) => {
    set((state) => {
      const existingEvents = state.streamEvents[sessionId] || [];
      const lastEvent = existingEvents[existingEvents.length - 1];

      // If the last event is already a text event, update it instead of creating a new one
      if (lastEvent && lastEvent.type === 'text') {
        const updatedEvents = [...existingEvents];
        updatedEvents[updatedEvents.length - 1] = {
          ...lastEvent,
          content: (lastEvent.content || '') + content,
        };

        return {
          currentStreamContent: {
            ...state.currentStreamContent,
            [sessionId]: (state.currentStreamContent[sessionId] || '') + content,
          },
          streamEvents: {
            ...state.streamEvents,
            [sessionId]: updatedEvents,
          },
        };
      }

      // Otherwise, create a new text event
      return {
        currentStreamContent: {
          ...state.currentStreamContent,
          [sessionId]: (state.currentStreamContent[sessionId] || '') + content,
        },
        streamEvents: {
          ...state.streamEvents,
          [sessionId]: [
            ...existingEvents,
            { id: `text-${Date.now()}`, type: 'text', timestamp: Date.now(), content },
          ],
        },
      };
    });
  },

  updateThinkingContent: (sessionId, content) => {
    // Thinking is now displayed separately, not in the chronological stream
    set((state) => ({
      currentThinkingContent: {
        ...state.currentThinkingContent,
        [sessionId]: (state.currentThinkingContent[sessionId] || '') + content,
      },
    }));
  },

  addToolCall: (sessionId, toolCall) => {
    set((state) => {
      const existingToolCalls = state.currentToolCalls[sessionId] || [];
      const existingIndex = existingToolCalls.findIndex(tc => tc.id === toolCall.id);

      // If tool call already exists, update it instead of adding duplicate
      if (existingIndex !== -1) {
        const updatedToolCalls = [...existingToolCalls];
        updatedToolCalls[existingIndex] = { ...existingToolCalls[existingIndex], ...toolCall };
        return {
          currentToolCalls: {
            ...state.currentToolCalls,
            [sessionId]: updatedToolCalls,
          },
          // Don't add duplicate to streamEvents, just keep existing
          streamEvents: state.streamEvents,
        };
      }

      // New tool call - add to both arrays
      return {
        currentToolCalls: {
          ...state.currentToolCalls,
          [sessionId]: [...existingToolCalls, toolCall],
        },
        streamEvents: {
          ...state.streamEvents,
          [sessionId]: [
            ...(state.streamEvents[sessionId] || []),
            { id: toolCall.id, type: 'tool', timestamp: Date.now(), toolCall },
          ],
        },
      };
    });
  },

  updateToolCall: (sessionId, toolCallId, updates) => {
    set((state) => ({
      currentToolCalls: {
        ...state.currentToolCalls,
        [sessionId]: (state.currentToolCalls[sessionId] || []).map((tc) =>
          tc.id === toolCallId ? { ...tc, ...updates } : tc
        ),
      },
    }));
  },

  setStreaming: (sessionId, isStreaming) => {
    console.log(`[SessionStore] setStreaming called for ${sessionId}: ${isStreaming}`);

    set((state) => ({
      isStreaming: { ...state.isStreaming, [sessionId]: isStreaming },
      streamEvents: isStreaming
        ? { ...state.streamEvents, [sessionId]: [] }
        : state.streamEvents,
      currentStreamContent: isStreaming
        ? { ...state.currentStreamContent, [sessionId]: '' }
        : state.currentStreamContent,
      currentThinkingContent: isStreaming
        ? { ...state.currentThinkingContent, [sessionId]: '' }
        : state.currentThinkingContent,
      currentToolCalls: isStreaming
        ? { ...state.currentToolCalls, [sessionId]: [] }
        : state.currentToolCalls,
      currentSystemInfo: isStreaming
        ? { ...state.currentSystemInfo, [sessionId]: null }
        : state.currentSystemInfo,
    }));

    // Process queued messages when streaming ends
    if (!isStreaming) {
      // Use a microtask to ensure state has propagated
      Promise.resolve().then(() => {
        const state = get();
        const queue = state.messageQueue[sessionId] || [];
        console.log(`[SessionStore] Stream ended. Checking queue for ${sessionId}. Queue length: ${queue.length}`);

        if (queue.length > 0) {
          const nextMessage = queue[0];
          console.log(`[SessionStore] Processing next queued message: "${nextMessage.message.slice(0, 50)}..."`);

          // Atomically remove message from queue and verify we're not streaming
          set((state) => {
            // Double-check we're still not streaming before removing from queue
            if (state.isStreaming[sessionId]) {
              console.warn(`[SessionStore] Streaming started again before queue could be processed. Aborting.`);
              return state; // Don't modify state
            }

            const currentQueue = state.messageQueue[sessionId] || [];
            if (currentQueue.length === 0) {
              console.warn(`[SessionStore] Queue became empty before processing. Race condition avoided.`);
              return state;
            }

            const [, ...remainingQueue] = currentQueue;
            console.log(`[SessionStore] Removed message from queue. Remaining: ${remainingQueue.length}`);

            return {
              messageQueue: {
                ...state.messageQueue,
                [sessionId]: remainingQueue,
              },
            };
          });

          // Send the message after a small delay to ensure state updates have propagated
          setTimeout(() => {
            const currentState = get();
            const stillStreaming = currentState.isStreaming[sessionId];
            console.log(`[SessionStore] About to send queued message. Currently streaming: ${stillStreaming}`);

            if (!stillStreaming) {
              console.log(`[SessionStore] Sending queued message now`);
              currentState.sendMessage(sessionId, nextMessage.message, nextMessage.attachments);
            } else {
              console.warn(`[SessionStore] Cannot send queued message - streaming started again. Re-queueing.`);
              // Re-add to front of queue
              set((s) => ({
                messageQueue: {
                  ...s.messageQueue,
                  [sessionId]: [nextMessage, ...(s.messageQueue[sessionId] || [])],
                },
              }));
            }
          }, 150); // Slightly longer delay for reliability
        } else {
          console.log(`[SessionStore] No messages in queue for ${sessionId}`);
        }
      });
    }
  },

  setSystemInfo: (sessionId, systemInfo) => {
    set((state) => ({
      currentSystemInfo: {
        ...state.currentSystemInfo,
        [sessionId]: systemInfo,
      },
    }));
  },

  setPermissionMode: (sessionId, mode) => {
    // Update local state
    set((state) => ({
      permissionMode: {
        ...state.permissionMode,
        [sessionId]: mode,
      },
    }));
    // Also notify backend for active queries (GREP IT! button mid-stream)
    if (hasElectronAPI) {
      window.electronAPI.claude.setPermissionMode(sessionId, mode).catch((err) => {
        console.error('[SessionStore] Failed to set permission mode on backend:', err);
      });
    }
  },

  cyclePermissionMode: (sessionId) => {
    const modes: PermissionMode[] = ['acceptEdits', 'default', 'bypassPermissions', 'plan', 'dontAsk'];
    set((state) => {
      const currentMode = state.permissionMode[sessionId] || 'acceptEdits';
      const currentIndex = modes.indexOf(currentMode);
      const nextIndex = (currentIndex + 1) % modes.length;
      return {
        permissionMode: {
          ...state.permissionMode,
          [sessionId]: modes[nextIndex],
        },
      };
    });
  },

  setThinkingMode: (sessionId, mode) => {
    set((state) => ({
      thinkingMode: {
        ...state.thinkingMode,
        [sessionId]: mode,
      },
    }));
  },

  cycleThinkingMode: (sessionId) => {
    const modes: ThinkingMode[] = ['off', 'thinking', 'ultrathink'];
    set((state) => {
      const currentMode = state.thinkingMode[sessionId] || 'thinking';
      const currentIndex = modes.indexOf(currentMode);
      const nextIndex = (currentIndex + 1) % modes.length;
      return {
        thinkingMode: {
          ...state.thinkingMode,
          [sessionId]: modes[nextIndex],
        },
      };
    });
  },

  setSelectedModel: (sessionId, model) => {
    set((state) => ({
      selectedModel: {
        ...state.selectedModel,
        [sessionId]: model,
      },
    }));
    // Persist the model selection to the session
    if (hasElectronAPI) {
      window.electronAPI.sessions.update(sessionId, { model });
    }
  },

  loadAvailableModels: async () => {
    if (!hasElectronAPI) return;
    try {
      const models = await window.electronAPI.claude.getModels();
      set({ availableModels: models });
    } catch (error) {
      console.error('[SessionStore] Failed to load available models:', error);
    }
  },

  sendMessage: async (sessionId, message, attachments) => {
    if (!hasElectronAPI) return;
    const state = get();
    const currentIsStreaming = state.isStreaming[sessionId];
    const currentQueueLength = (state.messageQueue[sessionId] || []).length;

    console.log(`[SessionStore] sendMessage called for session ${sessionId}`);
    console.log(`[SessionStore] Current isStreaming: ${currentIsStreaming}, Queue length: ${currentQueueLength}`);
    console.log(`[SessionStore] Message preview: "${message.slice(0, 80)}..."`);
    console.log('[SessionStore] sendMessage called with attachments:', attachments?.length || 0);
    if (attachments) {
      attachments.forEach((a: any, i: number) => {
        console.log(`[SessionStore] Attachment ${i}: type=${a?.type}, name=${a?.name}, content length=${a?.content?.length || 0}`);
      });
    }

    // If already streaming, queue the message
    if (state.isStreaming[sessionId]) {
      const queuedMsg = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        message,
        attachments,
        timestamp: Date.now(),
      };
      set((state) => ({
        messageQueue: {
          ...state.messageQueue,
          [sessionId]: [
            ...(state.messageQueue[sessionId] || []),
            queuedMsg,
          ],
        },
      }));
      console.log('[SessionStore] Message queued - will send after current response. Queue length:', (state.messageQueue[sessionId] || []).length + 1);
      console.log('[SessionStore] Queued message preview:', message.slice(0, 50));
      return;
    }

    const { addMessage, setStreaming, permissionMode, thinkingMode, selectedModel } = state;
    const mode = permissionMode[sessionId] || 'acceptEdits';
    const thinking = thinkingMode[sessionId] || 'thinking';
    const model = selectedModel[sessionId]; // undefined = use default
    console.log('[SessionStore] sendMessage - sessionId:', sessionId, 'permissionMode:', mode, 'raw:', permissionMode[sessionId]);

    // Update session's updatedAt timestamp for recent activity
    set((state) => ({
      sessions: state.sessions.map(session =>
        session.id === sessionId
          ? { ...session, updatedAt: new Date() }
          : session
      ),
    }));

    // Add user message
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: message,
      timestamp: new Date(),
    };
    addMessage(sessionId, userMessage);

    // Start streaming
    setStreaming(sessionId, true);

    try {
      console.log('[SessionStore] Calling electronAPI.claude.sendMessage with', attachments?.length || 0, 'attachments, model:', model);
      await window.electronAPI.claude.sendMessage(sessionId, message, attachments, mode, thinking, model);
      // Update timestamp in backend as well
      window.electronAPI.sessions.update(sessionId, { updatedAt: new Date() });
    } catch (error) {
      setStreaming(sessionId, false);
      console.error('Failed to send message:', error);
    }
  },

  loadMessages: async (sessionId) => {
    if (!hasElectronAPI) return;
    try {
      const messages = await window.electronAPI.claude.getMessages(sessionId);
      if (messages && messages.length > 0) {
        set((state) => ({
          messages: {
            ...state.messages,
            [sessionId]: messages,
          },
        }));
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  },

  subscribeToClaude: () => {
    if (!hasElectronAPI) return () => {};
    const { addMessage, updateStreamContent, updateThinkingContent, addToolCall, updateToolCall, setStreaming, setSystemInfo } = get();

    const unsubChunk = window.electronAPI.claude.onStreamChunk(({ sessionId, content }) => {
      updateStreamContent(sessionId, content);
    });

    const unsubThinking = window.electronAPI.claude.onThinkingChunk(({ sessionId, content }) => {
      updateThinkingContent(sessionId, content);
    });

    const unsubToolCall = window.electronAPI.claude.onToolCall(({ sessionId, toolCall }) => {
      const tc = toolCall as ToolCall;
      console.log('[SessionStore] onToolCall received:', tc?.name, 'input:', JSON.stringify(tc?.input || {}));
      addToolCall(sessionId, tc);
    });

    const unsubToolResult = window.electronAPI.claude.onToolResult(async ({ sessionId, toolCall }) => {
      if (!toolCall) return;
      const tc = toolCall as ToolCall;
      console.log('[SessionStore] onToolResult received:', tc.name, 'input:', JSON.stringify(tc.input || {}));
      // Update all fields that might have changed, including input which may have been streamed
      updateToolCall(sessionId, tc.id, {
        input: tc.input,
        status: tc.status,
        result: tc.result,
        completedAt: tc.completedAt,
      });

      // Check if there are queued messages to inject after this tool completes
      const currentState = get();
      const queue = currentState.messageQueue[sessionId] || [];
      if (queue.length > 0) {
        const nextMessage = queue[0];
        console.log(`[SessionStore] Tool completed, injecting queued message: "${nextMessage.message.slice(0, 50)}..."`);

        // First, add the user message to the chat so it's visible immediately
        const userMessage: ChatMessage = {
          id: nextMessage.id,
          role: 'user',
          content: nextMessage.message,
          timestamp: new Date(nextMessage.timestamp),
        };

        // Add message and remove from queue in a single state update for consistency
        set((state) => ({
          messages: {
            ...state.messages,
            [sessionId]: [...(state.messages[sessionId] || []), userMessage],
          },
          messageQueue: {
            ...state.messageQueue,
            [sessionId]: (state.messageQueue[sessionId] || []).slice(1),
          },
        }));

        console.log(`[SessionStore] User message added to chat: "${nextMessage.message.slice(0, 50)}..."`);

        // Inject into the active query via streamInput
        try {
          const success = await window.electronAPI.claude.injectMessage(
            sessionId,
            nextMessage.message,
            nextMessage.attachments as any[]
          );
          console.log(`[SessionStore] Message injection result:`, success);
          if (!success) {
            console.warn('[SessionStore] Message injection returned false - query may have ended');
          }
        } catch (error) {
          console.error('[SessionStore] Failed to inject message:', error);
        }
      }
    });

    const unsubSystemInfo = window.electronAPI.claude.onSystemInfo(({ sessionId, systemInfo }) => {
      setSystemInfo(sessionId, systemInfo);
    });

    const unsubEnd = window.electronAPI.claude.onStreamEnd(({ sessionId, message }) => {
      const currentState = get();
      const queueLength = (currentState.messageQueue[sessionId] || []).length;
      console.log(`[SessionStore] onStreamEnd received for ${sessionId}. Message length: ${message.content?.length || 0}`);
      console.log(`[SessionStore] onStreamEnd - Queue has ${queueLength} messages waiting`);
      setStreaming(sessionId, false);
      addMessage(sessionId, message);

      // Auto-play TTS if audio mode is active and message has content
      if (message.content && message.role === 'assistant') {
        // Import audio store and trigger auto-play
        import('./audio.store').then(({ useAudioStore }) => {
          useAudioStore.getState().triggerAutoPlayTTS(sessionId, message.id, message.content);
        });
      }
    });

    const unsubError = window.electronAPI.claude.onStreamError(({ sessionId, error }) => {
      setStreaming(sessionId, false);
      const errorMessage: ChatMessage = {
        id: Date.now().toString(),
        role: 'assistant',
        content: `Error: ${error}`,
        timestamp: new Date(),
      };
      addMessage(sessionId, errorMessage);
    });

    // Subscribe to permission requests
    const unsubPermission = window.electronAPI.claude.onPermissionRequest((request) => {
      console.log('[Session Store] Permission request received:', request.toolName, 'sessionId:', request.sessionId);
      console.log('[Session Store] Full permission request:', JSON.stringify(request, null, 2));
      const { setPendingPermission } = get();
      setPendingPermission(request.sessionId, request);
      // Verify it was set
      setTimeout(() => {
        const state = get();
        console.log('[Session Store] pendingPermission after set:', state.pendingPermission);
      }, 100);
    });

    // Subscribe to question requests
    const unsubQuestion = window.electronAPI.claude.onQuestionRequest((request) => {
      console.log('[Session Store] Question request received:', request.questions.length, 'question(s)');
      const { setPendingQuestion } = get();
      setPendingQuestion(request.sessionId, request);
    });

    // Subscribe to plan content (when a plan file is written)
    const unsubPlanContent = window.electronAPI.claude.onPlanContent((data) => {
      console.log('[Session Store] Plan content received for session:', data.sessionId);
      // Import ui.store dynamically to avoid circular dependency
      import('./ui.store').then(({ useUIStore }) => {
        useUIStore.getState().setPlanContent(data.sessionId, data.planContent);
      });
    });

    // Subscribe to plan approval requests (when ExitPlanMode is called)
    const unsubPlanApproval = window.electronAPI.claude.onPlanApprovalRequest((request) => {
      console.log('[Session Store] Plan approval request received for session:', request.sessionId);
      const { setPendingPlanApproval } = get();
      setPendingPlanApproval(request.sessionId, request);
      // Also update the plan content in UI store for display
      import('./ui.store').then(({ useUIStore }) => {
        useUIStore.getState().setPlanContent(request.sessionId, request.planContent);
        // Open the plan panel automatically when approval is requested
        useUIStore.getState().showPlanPanel();
      });
    });

    return () => {
      unsubChunk();
      unsubThinking();
      unsubToolCall();
      unsubToolResult();
      unsubSystemInfo();
      unsubEnd();
      unsubError();
      unsubPermission();
      unsubQuestion();
      unsubPlanContent();
      unsubPlanApproval();
    };
  },

  // Permission handling methods
  setPendingPermission: (sessionId, request) => {
    set((state) => ({
      pendingPermission: {
        ...state.pendingPermission,
        [sessionId]: request,
      },
    }));
  },

  approvePermission: async (sessionId, modifiedInput, alwaysApprove) => {
    if (!hasElectronAPI) return;
    const { pendingPermission, setPendingPermission } = get();
    const request = pendingPermission[sessionId];

    if (!request) {
      console.warn('[Session Store] No pending permission to approve');
      return;
    }

    const response: PermissionResponse = {
      requestId: request.requestId,
      approved: true,
      modifiedInput,
      alwaysApprove,
    };

    console.log('[Session Store] Approving permission:', request.requestId, alwaysApprove ? '(always approve)' : '');
    await window.electronAPI.claude.respondToPermission(response);
    setPendingPermission(sessionId, null);
  },

  denyPermission: async (sessionId) => {
    if (!hasElectronAPI) return;
    const { pendingPermission, setPendingPermission } = get();
    const request = pendingPermission[sessionId];

    if (!request) {
      console.warn('[Session Store] No pending permission to deny');
      return;
    }

    const response: PermissionResponse = {
      requestId: request.requestId,
      approved: false,
    };

    console.log('[Session Store] Denying permission:', request.requestId);
    await window.electronAPI.claude.respondToPermission(response);
    setPendingPermission(sessionId, null);
  },

  // Question handling methods
  setPendingQuestion: (sessionId, request) => {
    set((state) => ({
      pendingQuestion: {
        ...state.pendingQuestion,
        [sessionId]: request,
      },
    }));
  },

  answerQuestion: async (sessionId, answers) => {
    if (!hasElectronAPI) return;
    const { pendingQuestion, setPendingQuestion } = get();
    const request = pendingQuestion[sessionId];

    if (!request) {
      console.warn('[Session Store] No pending question to answer');
      return;
    }

    const response: QuestionResponse = {
      requestId: request.requestId,
      answers,
    };

    console.log('[Session Store] Answering question:', request.requestId, answers);
    await window.electronAPI.claude.respondToQuestion(response);
    setPendingQuestion(sessionId, null);
  },

  // Plan approval handling methods
  setPendingPlanApproval: (sessionId, request) => {
    set((state) => ({
      pendingPlanApproval: {
        ...state.pendingPlanApproval,
        [sessionId]: request,
      },
    }));
  },

  approvePlan: async (sessionId) => {
    if (!hasElectronAPI) return;
    const { pendingPlanApproval, setPendingPlanApproval } = get();
    const request = pendingPlanApproval[sessionId];

    if (!request) {
      console.warn('[Session Store] No pending plan approval to approve');
      return;
    }

    const response: PlanApprovalResponse = {
      requestId: request.requestId,
      approved: true,
    };

    console.log('[Session Store] Approving plan:', request.requestId);
    await window.electronAPI.claude.respondToPlanApproval(response);
    setPendingPlanApproval(sessionId, null);
  },

  rejectPlan: async (sessionId) => {
    if (!hasElectronAPI) return;
    const { pendingPlanApproval, setPendingPlanApproval } = get();
    const request = pendingPlanApproval[sessionId];

    if (!request) {
      console.warn('[Session Store] No pending plan approval to reject');
      return;
    }

    const response: PlanApprovalResponse = {
      requestId: request.requestId,
      approved: false,
    };

    console.log('[Session Store] Rejecting plan:', request.requestId);
    await window.electronAPI.claude.respondToPlanApproval(response);
    setPendingPlanApproval(sessionId, null);
  },

  // Queue management methods
  removeFromQueue: (sessionId, messageId) => {
    set((state) => ({
      messageQueue: {
        ...state.messageQueue,
        [sessionId]: (state.messageQueue[sessionId] || []).filter(m => m.id !== messageId),
      },
    }));
    console.log(`Message ${messageId} removed from queue`);
  },

  editQueuedMessage: (sessionId, messageId, newMessage) => {
    set((state) => ({
      messageQueue: {
        ...state.messageQueue,
        [sessionId]: (state.messageQueue[sessionId] || []).map(m =>
          m.id === messageId ? { ...m, message: newMessage } : m
        ),
      },
    }));
    console.log(`Message ${messageId} edited`);
  },

  moveToFront: (sessionId, messageId) => {
    set((state) => {
      const queue = state.messageQueue[sessionId] || [];
      const messageIndex = queue.findIndex(m => m.id === messageId);
      if (messageIndex === -1) return state;

      const message = queue[messageIndex];
      const newQueue = [message, ...queue.filter(m => m.id !== messageId)];

      return {
        messageQueue: {
          ...state.messageQueue,
          [sessionId]: newQueue,
        },
      };
    });
    console.log(`Message ${messageId} moved to front`);
  },

  clearQueue: (sessionId) => {
    set((state) => ({
      messageQueue: {
        ...state.messageQueue,
        [sessionId]: [],
      },
    }));
    console.log(`Queue cleared for session ${sessionId}`);
  },

  cancelStream: (sessionId) => {
    const state = get();

    // Cancel current streaming
    window.electronAPI.claude.cancel(sessionId);

    // Save partial content as an interrupted message before clearing
    const partialContent = state.currentStreamContent[sessionId] || '';
    const partialToolCalls = state.currentToolCalls[sessionId] || [];

    if (partialContent || partialToolCalls.length > 0) {
      // Create an interrupted message with whatever content we had
      const interruptedMessage: ChatMessage = {
        id: `interrupted-${Date.now()}`,
        role: 'assistant',
        content: partialContent || '(interrupted)',
        toolCalls: partialToolCalls.length > 0 ? partialToolCalls : undefined,
        timestamp: new Date(),
        interrupted: true,
      };
      state.addMessage(sessionId, interruptedMessage);
      console.log(`[cancelStream] Saved interrupted message with ${partialContent.length} chars of content`);
    }

    // Clear current streaming state
    set((state) => ({
      isStreaming: { ...state.isStreaming, [sessionId]: false },
      streamEvents: { ...state.streamEvents, [sessionId]: [] },
      currentStreamContent: { ...state.currentStreamContent, [sessionId]: '' },
      currentThinkingContent: { ...state.currentThinkingContent, [sessionId]: '' },
      currentToolCalls: { ...state.currentToolCalls, [sessionId]: [] },
    }));

    console.log(`Stream cancelled for session ${sessionId}`);
  },

  interruptAndSend: async (sessionId, message, attachments) => {
    const state = get();
    const isCurrentlyStreaming = state.isStreaming[sessionId] || false;

    // Only interrupt if actually streaming
    if (isCurrentlyStreaming) {
      console.log(`[interruptAndSend] Cancelling current stream for session ${sessionId}`);

      // Cancel current streaming and wait for confirmation
      await window.electronAPI.claude.cancel(sessionId);
      console.log(`[interruptAndSend] Cancel confirmed by backend`);

      // Save partial content as an interrupted message before clearing
      const partialContent = state.currentStreamContent[sessionId] || '';
      const partialToolCalls = state.currentToolCalls[sessionId] || [];

      if (partialContent || partialToolCalls.length > 0) {
        // Create an interrupted message with whatever content we had
        const interruptedMessage: ChatMessage = {
          id: `interrupted-${Date.now()}`,
          role: 'assistant',
          content: partialContent || '(interrupted)',
          toolCalls: partialToolCalls.length > 0 ? partialToolCalls : undefined,
          timestamp: new Date(),
          interrupted: true,
        };
        state.addMessage(sessionId, interruptedMessage);
        console.log(`[interruptAndSend] Saved interrupted message with ${partialContent.length} chars of content`);
      }

      // Clear current streaming state
      set((state) => ({
        isStreaming: { ...state.isStreaming, [sessionId]: false },
        streamEvents: { ...state.streamEvents, [sessionId]: [] },
        currentStreamContent: { ...state.currentStreamContent, [sessionId]: '' },
        currentThinkingContent: { ...state.currentThinkingContent, [sessionId]: '' },
        currentToolCalls: { ...state.currentToolCalls, [sessionId]: [] },
      }));

      console.log(`[interruptAndSend] Streaming state cleared, sending new message`);
    }

    // Send new message
    state.sendMessage(sessionId, message, attachments);
  },

  // Setup progress methods
  setSetupProgress: (sessionId, progress) => {
    set((state) => ({
      setupProgress: {
        ...state.setupProgress,
        [sessionId]: progress,
      },
    }));
  },

  subscribeToSetupProgress: () => {
    if (!hasElectronAPI) return () => {};

    const handleProgress = (progress: { sessionId: string; status: 'running' | 'completed' | 'error'; message?: string; output?: string; error?: string }) => {
      const { setupProgress, setSetupProgress, addMessage } = get();
      console.log('[SessionStore] Setup progress received:', progress);

      // Get existing progress for this session to accumulate output
      const existing = setupProgress[progress.sessionId];

      // Accumulate output if we have existing output and new output
      let accumulatedOutput = progress.output || '';
      if (existing?.output && progress.output) {
        accumulatedOutput = existing.output + progress.output;
      } else if (existing?.output && !progress.output) {
        accumulatedOutput = existing.output;
      }

      setSetupProgress(progress.sessionId, {
        ...progress,
        output: accumulatedOutput,
      });

      // If setup completed or errored, add output as a system message in chat and clear progress
      if (progress.status === 'completed' || progress.status === 'error') {
        // Add setup output as a system message at the top of chat
        if (accumulatedOutput) {
          const statusEmoji = progress.status === 'completed' ? '✓' : '✗';
          const statusText = progress.status === 'completed' ? 'Setup completed' : 'Setup failed';
          addMessage(progress.sessionId, {
            id: `setup-${Date.now()}`,
            role: 'system',
            content: `**${statusEmoji} ${statusText}**\n\n\`\`\`\n${accumulatedOutput.trim()}\n\`\`\`${progress.error ? `\n\n**Error:** ${progress.error}` : ''}`,
            timestamp: new Date(),
          });
        }

        setTimeout(() => {
          setSetupProgress(progress.sessionId, null);
        }, progress.status === 'error' ? 10000 : 1000); // Shorter delay since we now show in chat
      }
    };

    // Subscribe to both dev and SSH setup progress
    const unsubscribeDev = window.electronAPI.dev.onSetupProgress(handleProgress);
    const unsubscribeSSH = window.electronAPI.ssh.onSetupProgress(handleProgress);

    return () => {
      unsubscribeDev();
      unsubscribeSSH();
    };
  },

  // Background task methods
  addBackgroundTask: (sessionId, task) => {
    set((state) => ({
      backgroundTasks: {
        ...state.backgroundTasks,
        [sessionId]: [...(state.backgroundTasks[sessionId] || []), task],
      },
    }));
    console.log('[SessionStore] Added background task:', task.id, task.command.slice(0, 50));
  },

  updateBackgroundTask: (sessionId, taskId, updates) => {
    set((state) => ({
      backgroundTasks: {
        ...state.backgroundTasks,
        [sessionId]: (state.backgroundTasks[sessionId] || []).map((task) =>
          task.id === taskId ? { ...task, ...updates } : task
        ),
      },
    }));
  },

  removeBackgroundTask: (sessionId, taskId) => {
    set((state) => ({
      backgroundTasks: {
        ...state.backgroundTasks,
        [sessionId]: (state.backgroundTasks[sessionId] || []).filter((task) => task.id !== taskId),
      },
    }));
    console.log('[SessionStore] Removed background task:', taskId);
  },

  subscribeToBackgroundTasks: () => {
    if (!hasElectronAPI) return () => {};

    const { updateBackgroundTask } = get();

    // Subscribe to background task output updates
    const unsubscribeOutput = window.electronAPI.claude.onBackgroundTaskOutput?.((data) => {
      console.log('[SessionStore] Background task output received:', data.taskId);
      updateBackgroundTask(data.sessionId, data.taskId, {
        output: data.output,
        status: data.status,
        completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
      });
    });

    return () => {
      unsubscribeOutput?.();
    };
  },

  // Smart Compact / Compaction status methods
  setCompactionStatus: (sessionId, status) => {
    set((state) => ({
      compactionStatus: {
        ...state.compactionStatus,
        [sessionId]: status,
      },
    }));
  },

  subscribeToCompaction: () => {
    if (!hasElectronAPI) return () => {};

    const { setCompactionStatus } = get();

    // Subscribe to compaction status changes
    const unsubscribeStatus = window.electronAPI.claude.onCompactionStatus((status) => {
      console.log('[SessionStore] Compaction status received:', status);
      setCompactionStatus(status.sessionId, status as CompactionStatus);
    });

    // Subscribe to compaction complete events
    const unsubscribeComplete = window.electronAPI.claude.onCompactionComplete((complete) => {
      console.log('[SessionStore] Compaction complete received:', complete);
      // Clear compaction status after showing completion briefly
      setTimeout(() => {
        setCompactionStatus(complete.sessionId, null);
      }, 2000);
    });

    return () => {
      unsubscribeStatus();
      unsubscribeComplete();
    };
  },

  // Auto-resume methods for Grep It mode
  saveAutoResumeState: async (sessionId) => {
    if (!hasElectronAPI) return;

    const state = get();
    const isStreaming = state.isStreaming[sessionId];
    const permissionMode = state.permissionMode[sessionId] || 'default';

    // Only save state if we're in Grep It mode (bypassPermissions) and streaming
    if (permissionMode !== 'bypassPermissions' || !isStreaming) {
      return;
    }

    console.log('[SessionStore] Saving auto-resume state for Grep It session:', sessionId);
    await window.electronAPI.claude.saveAutoResumeState({
      sessionId,
      wasStreaming: true,
      permissionMode,
    });
  },

  clearAutoResumeState: async () => {
    if (!hasElectronAPI) return;
    await window.electronAPI.claude.clearAutoResumeState();
  },

  checkAndAutoResume: async () => {
    if (!hasElectronAPI) return;

    try {
      const resumeState = await window.electronAPI.claude.getAutoResumeState();

      if (!resumeState) {
        return;
      }

      console.log('[SessionStore] Found auto-resume state:', resumeState);

      // Clear the state first to prevent re-triggering
      await window.electronAPI.claude.clearAutoResumeState();

      const { sessionId, wasStreaming, permissionMode } = resumeState;

      // Only auto-resume for Grep It mode (bypassPermissions)
      if (permissionMode !== 'bypassPermissions' || !wasStreaming) {
        console.log('[SessionStore] Not auto-resuming - not Grep It mode or was not streaming');
        return;
      }

      // Check if the session still exists
      const state = get();
      const session = state.sessions.find(s => s.id === sessionId);
      if (!session) {
        console.log('[SessionStore] Session not found for auto-resume:', sessionId);
        return;
      }

      console.log('[SessionStore] Auto-resuming Grep It session:', sessionId);

      // Set the session as active
      state.setActiveSession(sessionId);

      // Restore permission mode
      set((s) => ({
        permissionMode: { ...s.permissionMode, [sessionId]: 'bypassPermissions' },
      }));

      // Wait a moment for UI to settle, then send continuation message
      setTimeout(() => {
        const currentState = get();
        // Make sure we're not already streaming
        if (!currentState.isStreaming[sessionId]) {
          console.log('[SessionStore] Sending auto-resume continuation message');
          currentState.sendMessage(sessionId, 'Continue where you left off. The app was restarted mid-task. Please resume your work.');
        }
      }, 2000);

    } catch (error) {
      console.error('[SessionStore] Auto-resume check failed:', error);
    }
  },

  setupAutoResumeOnClose: () => {
    if (!hasElectronAPI || typeof window === 'undefined') return () => {};

    const handleBeforeUnload = () => {
      const state = get();
      const activeSessionId = state.activeSessionId;

      if (activeSessionId) {
        // This is a sync-ish operation since we can't await in beforeunload
        // The save will happen in the background
        state.saveAutoResumeState(activeSessionId);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  },
}));
