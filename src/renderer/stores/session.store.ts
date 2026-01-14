import { create } from 'zustand';
import type { Session, ChatMessage, ToolCall, PermissionRequest, PermissionResponse, QuestionRequest, QuestionResponse, SetupProgressEvent, CompactionStatus, CompactionComplete } from '../../shared/types';

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
  setupProgress: Record<string, SetupProgressEvent | null>;
  compactionStatus: Record<string, CompactionStatus | null>;
  messageQueue: Record<string, Array<{
    id: string;
    message: string;
    attachments?: unknown[];
    timestamp: number;
  }>>;

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
  approvePermission: (sessionId: string, modifiedInput?: Record<string, unknown>) => Promise<void>;
  denyPermission: (sessionId: string) => Promise<void>;
  // Question handling
  setPendingQuestion: (sessionId: string, request: QuestionRequest | null) => void;
  answerQuestion: (sessionId: string, answers: Record<string, string>) => Promise<void>;
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
  // Compaction status (Smart Compact feature)
  setCompactionStatus: (sessionId: string, status: CompactionStatus | null) => void;
  subscribeToCompaction: () => () => void;
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
  setupProgress: {},
  compactionStatus: {},
  messageQueue: {},

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

      return {
        activeSessionId: sessionId,
        sessions: updatedSessions
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
      loadMessages(sessionId);
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
      const sessions = await window.electronAPI.sessions.list();
      const activeSessionId = await window.electronAPI.dev.getActiveSession();

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

      set({
        sessions,
        activeSessionId: validActiveSessionId,
        isLoadingSessions: false,
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

  subscribeToSessionChanges: () => {
    if (!hasElectronAPI) return () => {};
    const unsubscribe = window.electronAPI.sessions.onStatusChanged((session) => {
      if (!session?.id) return;
      set((state) => ({
        sessions: state.sessions.map((s) => (s.id === session.id ? session : s)),
      }));
    });
    return unsubscribe;
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
    set((state) => ({
      permissionMode: {
        ...state.permissionMode,
        [sessionId]: mode,
      },
    }));
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

    const unsubToolResult = window.electronAPI.claude.onToolResult(({ sessionId, toolCall }) => {
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
    });

    const unsubSystemInfo = window.electronAPI.claude.onSystemInfo(({ sessionId, systemInfo }) => {
      setSystemInfo(sessionId, systemInfo);
    });

    const unsubEnd = window.electronAPI.claude.onStreamEnd(({ sessionId, message }) => {
      console.log(`[SessionStore] onStreamEnd received for ${sessionId}. Message length: ${message.content?.length || 0}`);
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
      console.log('[Session Store] Permission request received:', request.toolName);
      const { setPendingPermission } = get();
      setPendingPermission(request.sessionId, request);
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

  approvePermission: async (sessionId, modifiedInput) => {
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
    };

    console.log('[Session Store] Approving permission:', request.requestId);
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
      console.log(`Saved interrupted message with ${partialContent.length} chars of content`);
    }

    // Clear current streaming state
    set((state) => ({
      isStreaming: { ...state.isStreaming, [sessionId]: false },
      streamEvents: { ...state.streamEvents, [sessionId]: [] },
      currentStreamContent: { ...state.currentStreamContent, [sessionId]: '' },
      currentThinkingContent: { ...state.currentThinkingContent, [sessionId]: '' },
      currentToolCalls: { ...state.currentToolCalls, [sessionId]: [] },
    }));

    console.log(`Interrupted current message, sending priority message`);

    // Send new message immediately (will bypass queue since isStreaming is now false)
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

    const unsubscribe = window.electronAPI.dev.onSetupProgress((progress) => {
      const { setSetupProgress } = get();
      console.log('[SessionStore] Setup progress received:', progress);
      setSetupProgress(progress.sessionId, progress);

      // If setup completed or errored, clear the progress after a delay
      if (progress.status === 'completed' || progress.status === 'error') {
        setTimeout(() => {
          setSetupProgress(progress.sessionId, null);
        }, 3000);
      }
    });

    return unsubscribe;
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
}));
