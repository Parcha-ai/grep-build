import { create } from 'zustand';
import type { Session, ChatMessage, ToolCall } from '../../shared/types';

// Check if running in Electron environment
const hasElectronAPI = typeof window !== 'undefined' && !!window.electronAPI;

interface SystemInfo {
  tools: string[];
  model: string;
}

// Permission modes from Claude Agent SDK
export type PermissionMode = 'default' | 'acceptEdits' | 'plan';

// Thinking modes: off (0), thinking (10k tokens), ultrathink (100k tokens)
export type ThinkingMode = 'off' | 'thinking' | 'ultrathink';

interface SessionState {
  sessions: Session[];
  activeSessionId: string | null;
  messages: Record<string, ChatMessage[]>;
  isStreaming: Record<string, boolean>;
  currentStreamContent: Record<string, string>;
  currentThinkingContent: Record<string, string>;
  currentToolCalls: Record<string, ToolCall[]>;
  currentSystemInfo: Record<string, SystemInfo | null>;
  permissionMode: Record<string, PermissionMode>;
  thinkingMode: Record<string, ThinkingMode>;

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
  sendMessage: (sessionId: string, message: string, attachments?: unknown[]) => Promise<void>;
  loadMessages: (sessionId: string) => Promise<void>;
  subscribeToClaude: () => () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: {},
  isStreaming: {},
  currentStreamContent: {},
  currentThinkingContent: {},
  currentToolCalls: {},
  currentSystemInfo: {},
  permissionMode: {},
  thinkingMode: {},

  setActiveSession: (sessionId) => {
    const { loadMessages } = get();

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
    if (hasElectronAPI) {
      window.electronAPI.dev.setActiveSession(sessionId);
      if (sessionId) {
        window.electronAPI.sessions.update(sessionId, { updatedAt: new Date() });
      }
    }
    // Load messages for this session from SDK transcripts
    if (sessionId) {
      loadMessages(sessionId);
    }
  },

  addSession: (session) => {
    set((state) => ({ sessions: [...state.sessions, session] }));
  },

  loadSessions: async () => {
    if (!hasElectronAPI) return;
    try {
      const sessions = await window.electronAPI.sessions.list();
      const activeSessionId = await window.electronAPI.dev.getActiveSession();

      // Verify the active session still exists
      const sessionExists = sessions.some((s) => s.id === activeSessionId);
      const validActiveSessionId = sessionExists ? activeSessionId : null;

      set({
        sessions,
        activeSessionId: validActiveSessionId,
      });

      // Load messages for the active session
      if (validActiveSessionId) {
        const { loadMessages } = get();
        loadMessages(validActiveSessionId);
      }
    } catch (error) {
      console.error('Failed to load sessions:', error);
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
    set((state) => ({
      currentStreamContent: {
        ...state.currentStreamContent,
        [sessionId]: (state.currentStreamContent[sessionId] || '') + content,
      },
    }));
  },

  updateThinkingContent: (sessionId, content) => {
    set((state) => ({
      currentThinkingContent: {
        ...state.currentThinkingContent,
        [sessionId]: (state.currentThinkingContent[sessionId] || '') + content,
      },
    }));
  },

  addToolCall: (sessionId, toolCall) => {
    set((state) => ({
      currentToolCalls: {
        ...state.currentToolCalls,
        [sessionId]: [...(state.currentToolCalls[sessionId] || []), toolCall],
      },
    }));
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
    set((state) => ({
      isStreaming: { ...state.isStreaming, [sessionId]: isStreaming },
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
    const modes: PermissionMode[] = ['acceptEdits', 'default', 'plan'];
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

  sendMessage: async (sessionId, message, attachments) => {
    if (!hasElectronAPI) return;
    const { addMessage, setStreaming, permissionMode, thinkingMode } = get();
    const mode = permissionMode[sessionId] || 'acceptEdits';
    const thinking = thinkingMode[sessionId] || 'thinking';

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
      await window.electronAPI.claude.sendMessage(sessionId, message, attachments, mode, thinking);
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
      addToolCall(sessionId, toolCall as ToolCall);
    });

    const unsubToolResult = window.electronAPI.claude.onToolResult(({ sessionId, toolCall }) => {
      if (!toolCall) return;
      const tc = toolCall as ToolCall;
      updateToolCall(sessionId, tc.id, {
        status: tc.status,
        result: tc.result,
        completedAt: tc.completedAt,
      });
    });

    const unsubSystemInfo = window.electronAPI.claude.onSystemInfo(({ sessionId, systemInfo }) => {
      setSystemInfo(sessionId, systemInfo);
    });

    const unsubEnd = window.electronAPI.claude.onStreamEnd(({ sessionId, message }) => {
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

    return () => {
      unsubChunk();
      unsubThinking();
      unsubToolCall();
      unsubToolResult();
      unsubSystemInfo();
      unsubEnd();
      unsubError();
    };
  },
}));
