import { create } from 'zustand';
import type { Session, ChatMessage, ToolCall } from '../../shared/types';

interface SessionState {
  sessions: Session[];
  activeSessionId: string | null;
  messages: Record<string, ChatMessage[]>;
  isStreaming: Record<string, boolean>;
  currentStreamContent: Record<string, string>;
  currentToolCalls: Record<string, ToolCall[]>;

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
  addToolCall: (sessionId: string, toolCall: ToolCall) => void;
  updateToolCall: (sessionId: string, toolCallId: string, updates: Partial<ToolCall>) => void;
  setStreaming: (sessionId: string, isStreaming: boolean) => void;
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
  currentToolCalls: {},

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

    // Persist active session and update timestamp in backend
    window.electronAPI.dev.setActiveSession(sessionId);
    if (sessionId) {
      window.electronAPI.sessions.update(sessionId, { updatedAt: new Date() });
      // Load messages for this session from SDK transcripts
      loadMessages(sessionId);
    }
  },

  addSession: (session) => {
    set((state) => ({ sessions: [...state.sessions, session] }));
  },

  loadSessions: async () => {
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
    const session = await window.electronAPI.sessions.create(config);
    set((state) => ({ sessions: [...state.sessions, session] }));
    return session;
  },

  startSession: async (sessionId) => {
    await window.electronAPI.sessions.start(sessionId);
  },

  stopSession: async (sessionId) => {
    await window.electronAPI.sessions.stop(sessionId);
  },

  deleteSession: async (sessionId) => {
    await window.electronAPI.sessions.delete(sessionId);
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== sessionId),
      activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
    }));
  },

  updateSession: async (sessionId, updates) => {
    const session = await window.electronAPI.sessions.update(sessionId, updates);
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === sessionId ? session : s)),
    }));
  },

  subscribeToSessionChanges: () => {
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
      currentToolCalls: isStreaming
        ? { ...state.currentToolCalls, [sessionId]: [] }
        : state.currentToolCalls,
    }));
  },

  sendMessage: async (sessionId, message, attachments) => {
    const { addMessage, setStreaming } = get();

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
      await window.electronAPI.claude.sendMessage(sessionId, message, attachments);
      // Update timestamp in backend as well
      window.electronAPI.sessions.update(sessionId, { updatedAt: new Date() });
    } catch (error) {
      setStreaming(sessionId, false);
      console.error('Failed to send message:', error);
    }
  },

  loadMessages: async (sessionId) => {
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
    const { addMessage, updateStreamContent, addToolCall, updateToolCall, setStreaming } = get();

    const unsubChunk = window.electronAPI.claude.onStreamChunk(({ sessionId, content }) => {
      updateStreamContent(sessionId, content);
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

    const unsubEnd = window.electronAPI.claude.onStreamEnd(({ sessionId, message }) => {
      setStreaming(sessionId, false);
      addMessage(sessionId, message);
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
      unsubToolCall();
      unsubToolResult();
      unsubEnd();
      unsubError();
    };
  },
}));
