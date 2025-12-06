import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { IPC_CHANNELS } from '../shared/constants/channels';
import type {
  Session,
  GitHubRepo,
  GitHubUser,
  Commit,
  Branch,
  ChatMessage,
  AppSettings,
  DOMElementContext
} from '../shared/types';

// Type-safe API for renderer process
const electronAPI = {
  // Auth
  auth: {
    login: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGIN),
    logout: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGOUT),
    getUser: (): Promise<GitHubUser | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_GET_USER),
    getRepos: (): Promise<GitHubRepo[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_GET_REPOS),
    onOAuthCallback: (callback: (data: { code: string }) => void) => {
      const handler = (_: IpcRendererEvent, data: { code: string }) => callback(data);
      ipcRenderer.on('auth:oauth-callback', handler);
      return () => ipcRenderer.removeListener('auth:oauth-callback', handler);
    },
  },

  // Sessions
  sessions: {
    create: (config: {
      name: string;
      repoUrl: string;
      branch: string;
      setupScript?: string;
    }): Promise<Session> =>
      ipcRenderer.invoke(IPC_CHANNELS.SESSION_CREATE, config),
    start: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.SESSION_START, sessionId),
    stop: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.SESSION_STOP, sessionId),
    delete: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.SESSION_DELETE, sessionId),
    list: (): Promise<Session[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.SESSION_LIST),
    get: (sessionId: string): Promise<Session | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.SESSION_GET, sessionId),
    update: (sessionId: string, updates: Partial<Session>): Promise<Session> =>
      ipcRenderer.invoke(IPC_CHANNELS.SESSION_UPDATE, sessionId, updates),
    onStatusChanged: (callback: (session: Session) => void) => {
      const handler = (_: IpcRendererEvent, session: Session) => callback(session);
      ipcRenderer.on(IPC_CHANNELS.SESSION_STATUS_CHANGED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.SESSION_STATUS_CHANGED, handler);
    },
  },

  // Terminal
  terminal: {
    create: (sessionId: string): Promise<string> =>
      ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_CREATE, sessionId),
    sendInput: (terminalId: string, data: string): void =>
      ipcRenderer.send(IPC_CHANNELS.TERMINAL_INPUT, terminalId, data),
    resize: (terminalId: string, cols: number, rows: number): void =>
      ipcRenderer.send(IPC_CHANNELS.TERMINAL_RESIZE, terminalId, cols, rows),
    close: (terminalId: string): void =>
      ipcRenderer.send(IPC_CHANNELS.TERMINAL_CLOSE, terminalId),
    onOutput: (terminalId: string, callback: (data: string) => void) => {
      const channel = `${IPC_CHANNELS.TERMINAL_OUTPUT}:${terminalId}`;
      const handler = (_: IpcRendererEvent, data: string) => callback(data);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
  },

  // Git
  git: {
    getStatus: (sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_STATUS, sessionId),
    getLog: (sessionId: string, limit?: number): Promise<Commit[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_LOG, sessionId, limit),
    getBranches: (sessionId: string): Promise<Branch[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_BRANCHES, sessionId),
    checkout: (sessionId: string, branch: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_CHECKOUT, sessionId, branch),
    getDiff: (sessionId: string, commitHash?: string): Promise<string> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_DIFF, sessionId, commitHash),
    commit: (sessionId: string, message: string): Promise<string> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_COMMIT, sessionId, message),
    push: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_PUSH, sessionId),
    pull: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_PULL, sessionId),
    clone: (url: string, path: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_CLONE, url, path),
  },

  // Claude
  claude: {
    sendMessage: (sessionId: string, message: string, attachments?: unknown[]): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_SEND_MESSAGE, sessionId, message, attachments),
    getMessages: (sessionId: string): Promise<ChatMessage[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_GET_MESSAGES, sessionId),
    cancel: (sessionId: string): void =>
      ipcRenderer.send(IPC_CHANNELS.CLAUDE_CANCEL, sessionId),
    onStreamChunk: (callback: (chunk: { sessionId: string; content: string }) => void) => {
      const handler = (_: IpcRendererEvent, chunk: { sessionId: string; content: string }) => callback(chunk);
      ipcRenderer.on(IPC_CHANNELS.CLAUDE_STREAM_CHUNK, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.CLAUDE_STREAM_CHUNK, handler);
    },
    onStreamEnd: (callback: (data: { sessionId: string; message: ChatMessage }) => void) => {
      const handler = (_: IpcRendererEvent, data: { sessionId: string; message: ChatMessage }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.CLAUDE_STREAM_END, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.CLAUDE_STREAM_END, handler);
    },
    onStreamError: (callback: (data: { sessionId: string; error: string }) => void) => {
      const handler = (_: IpcRendererEvent, data: { sessionId: string; error: string }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.CLAUDE_STREAM_ERROR, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.CLAUDE_STREAM_ERROR, handler);
    },
    onToolCall: (callback: (data: { sessionId: string; toolCall: unknown }) => void) => {
      const handler = (_: IpcRendererEvent, data: { sessionId: string; toolCall: unknown }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.CLAUDE_TOOL_CALL, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.CLAUDE_TOOL_CALL, handler);
    },
    onToolResult: (callback: (data: { sessionId: string; toolCall: unknown }) => void) => {
      const handler = (_: IpcRendererEvent, data: { sessionId: string; toolCall: unknown }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.CLAUDE_TOOL_RESULT, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.CLAUDE_TOOL_RESULT, handler);
    },
  },

  // Browser Preview
  browser: {
    injectInspector: (webviewId: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_INJECT_INSPECTOR, webviewId),
    onElementSelected: (callback: (element: DOMElementContext) => void) => {
      const handler = (_: IpcRendererEvent, element: DOMElementContext) => callback(element);
      ipcRenderer.on(IPC_CHANNELS.BROWSER_ELEMENT_SELECTED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.BROWSER_ELEMENT_SELECTED, handler);
    },
  },

  // Settings
  settings: {
    get: (): Promise<AppSettings> =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
    set: (settings: Partial<AppSettings>): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, settings),
    reset: (): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_RESET),
  },

  // App
  app: {
    getVersion: (): Promise<string> =>
      ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),
    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.APP_OPEN_EXTERNAL, url),
    getPath: (name: string): Promise<string> =>
      ipcRenderer.invoke(IPC_CHANNELS.APP_GET_PATH, name),
    showDialog: (options: unknown): Promise<unknown> =>
      ipcRenderer.invoke(IPC_CHANNELS.APP_SHOW_DIALOG, options),
  },

  // Docker
  docker: {
    getStatus: (): Promise<{ available: boolean; version?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.DOCKER_STATUS),
    getContainerStats: (containerId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.DOCKER_CONTAINER_STATS, containerId),
  },

  // Dev Mode
  dev: {
    openLocalRepo: (): Promise<{
      success: boolean;
      canceled?: boolean;
      error?: string;
      repoPath?: string;
      branch?: string;
      name?: string;
      needsGitInit?: boolean;
    }> => ipcRenderer.invoke(IPC_CHANNELS.DEV_OPEN_LOCAL_REPO),
    initGit: (repoPath: string): Promise<{
      success: boolean;
      branch?: string;
      error?: string;
    }> => ipcRenderer.invoke('dev:init-git', repoPath),
    createSession: (data: {
      name: string;
      repoPath: string;
      branch: string;
    }): Promise<Session> => ipcRenderer.invoke(IPC_CHANNELS.DEV_CREATE_SESSION, data),
    getActiveSession: (): Promise<string | null> =>
      ipcRenderer.invoke('dev:get-active-session'),
    setActiveSession: (sessionId: string | null): Promise<void> =>
      ipcRenderer.invoke('dev:set-active-session', sessionId),
    getDevMode: (): Promise<boolean> =>
      ipcRenderer.invoke('dev:get-dev-mode'),
    setDevMode: (enabled: boolean): Promise<void> =>
      ipcRenderer.invoke('dev:set-dev-mode', enabled),
  },

  // File System
  fs: {
    listFiles: (sessionId: string, query?: string): Promise<Array<{
      name: string;
      path: string;
      relativePath: string;
      type: 'file' | 'folder';
      extension?: string;
    }>> => ipcRenderer.invoke(IPC_CHANNELS.FS_LIST_FILES, sessionId, query),
    readFile: (filePath: string): Promise<{ success: boolean; content?: string; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.FS_READ_FILE, filePath),
    searchFiles: (sessionId: string, searchTerm: string): Promise<Array<{
      file: { name: string; path: string; relativePath: string };
      matches: string[];
    }>> => ipcRenderer.invoke(IPC_CHANNELS.FS_SEARCH_FILES, sessionId, searchTerm),
  },
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type declaration for the renderer
export type ElectronAPI = typeof electronAPI;
