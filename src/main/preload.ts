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
  DOMElementContext,
  TranscriptionResult,
  TTSRequest,
  AudioSettings
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
    sendMessage: (sessionId: string, message: string, attachments?: unknown[], permissionMode?: string, thinkingMode?: string, model?: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_SEND_MESSAGE, sessionId, message, attachments, permissionMode, thinkingMode, model),
    getMessages: (sessionId: string): Promise<ChatMessage[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_GET_MESSAGES, sessionId),
    getModels: (): Promise<Array<{ id: string; name: string; description: string }>> =>
      ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_GET_MODELS),
    cancel: (sessionId: string): void =>
      ipcRenderer.send(IPC_CHANNELS.CLAUDE_CANCEL, sessionId),
    onStreamChunk: (callback: (chunk: { sessionId: string; content: string }) => void) => {
      const handler = (_: IpcRendererEvent, chunk: { sessionId: string; content: string }) => callback(chunk);
      ipcRenderer.on(IPC_CHANNELS.CLAUDE_STREAM_CHUNK, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.CLAUDE_STREAM_CHUNK, handler);
    },
    onThinkingChunk: (callback: (chunk: { sessionId: string; content: string }) => void) => {
      const handler = (_: IpcRendererEvent, chunk: { sessionId: string; content: string }) => callback(chunk);
      ipcRenderer.on(IPC_CHANNELS.CLAUDE_THINKING_CHUNK, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.CLAUDE_THINKING_CHUNK, handler);
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
    onSystemInfo: (callback: (data: { sessionId: string; systemInfo: { tools: string[]; model: string } }) => void) => {
      const handler = (_: IpcRendererEvent, data: { sessionId: string; systemInfo: { tools: string[]; model: string } }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.CLAUDE_SYSTEM_INFO, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.CLAUDE_SYSTEM_INFO, handler);
    },
    // Permission request listener
    onPermissionRequest: (callback: (request: any) => void) => {
      const handler = (_: IpcRendererEvent, request: any) => callback(request);
      ipcRenderer.on(IPC_CHANNELS.CLAUDE_PERMISSION_REQUEST, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.CLAUDE_PERMISSION_REQUEST, handler);
    },
    // Send permission response
    respondToPermission: (response: { requestId: string; approved: boolean; modifiedInput?: Record<string, unknown> }): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_PERMISSION_RESPONSE, response),
    // Question request listener
    onQuestionRequest: (callback: (request: any) => void) => {
      const handler = (_: IpcRendererEvent, request: any) => callback(request);
      ipcRenderer.on(IPC_CHANNELS.CLAUDE_QUESTION_REQUEST, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.CLAUDE_QUESTION_REQUEST, handler);
    },
    // Send question response
    respondToQuestion: (response: { requestId: string; answers: Record<string, string> }): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_QUESTION_RESPONSE, response),
    // Compaction status listener (Smart Compact feature)
    onCompactionStatus: (callback: (status: { sessionId: string; isCompacting: boolean; smartCompact?: { enabled: boolean; originalModel: string; compactingModel: string; reason: string }; preTokens?: number; trigger?: string }) => void) => {
      const handler = (_: IpcRendererEvent, status: any) => callback(status);
      ipcRenderer.on(IPC_CHANNELS.CLAUDE_COMPACTION_STATUS, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.CLAUDE_COMPACTION_STATUS, handler);
    },
    // Compaction complete listener
    onCompactionComplete: (callback: (complete: { sessionId: string; preTokens: number; postTokens?: number; smartCompact?: { modelSwitched: boolean; restoredModel: string } }) => void) => {
      const handler = (_: IpcRendererEvent, complete: any) => callback(complete);
      ipcRenderer.on(IPC_CHANNELS.CLAUDE_COMPACTION_COMPLETE, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.CLAUDE_COMPACTION_COMPLETE, handler);
    },
    // Plan content listener (when plan file is written)
    onPlanContent: (callback: (data: { sessionId: string; planContent: string; planFilePath: string }) => void) => {
      const handler = (_: IpcRendererEvent, data: { sessionId: string; planContent: string; planFilePath: string }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.CLAUDE_PLAN_CONTENT, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.CLAUDE_PLAN_CONTENT, handler);
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
    captureSnapshot: (sessionId: string, url: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CAPTURE_SNAPSHOT, sessionId, url),
    navigateTo: (sessionId: string, url: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_NAVIGATE_TO, sessionId, url),
    getSnapshot: (sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_SNAPSHOT, sessionId),
    onCaptureRequest: (callback: (data: { sessionId: string; requestId?: string }) => void) => {
      const handler = (_: IpcRendererEvent, data: { sessionId: string; requestId?: string }) => callback(data);
      ipcRenderer.on('browser:capture-snapshot', handler);
      return () => ipcRenderer.removeListener('browser:capture-snapshot', handler);
    },
    onNavigate: (callback: (data: { sessionId: string; url: string }) => void) => {
      const handler = (_: IpcRendererEvent, data: { sessionId: string; url: string }) => callback(data);
      ipcRenderer.on('browser:navigate', handler);
      return () => {
        ipcRenderer.removeListener('browser:navigate', handler);
      };
    },
    onAction: (callback: (data: { sessionId: string; requestId: string; action: string; params: Record<string, unknown> }) => void) => {
      const handler = (_: IpcRendererEvent, data: { sessionId: string; requestId: string; action: string; params: Record<string, unknown> }) => callback(data);
      ipcRenderer.on('browser:action', handler);
      return () => ipcRenderer.removeListener('browser:action', handler);
    },
    sendSnapshotData: (snapshot: any) => {
      ipcRenderer.send('browser:snapshot-captured', snapshot);
    },
    sendActionResult: (result: { requestId: string; success: boolean; data?: any; error?: string }) => {
      ipcRenderer.send('browser:action-result', result);
    },
    clearStorage: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CLEAR_STORAGE),
    registerWebview: (sessionId: string, webContentsId: number) => {
      ipcRenderer.send('browser:register-webview', { sessionId, webContentsId });
    },
    unregisterWebview: (sessionId: string) => {
      ipcRenderer.send('browser:unregister-webview', { sessionId });
    },
    onAutomationEvent: (callback: (data: { sessionId: string; type: string; action: string; data?: Record<string, unknown> }) => void) => {
      const handler = (_: IpcRendererEvent, data: { sessionId: string; type: string; action: string; data?: Record<string, unknown> }) => callback(data);
      ipcRenderer.on('browser:automation-event', handler);
      return () => ipcRenderer.removeListener('browser:automation-event', handler);
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
    getApiKey: (): Promise<string> =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_API_KEY),
    setApiKey: (key: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET_API_KEY, key),
  },

  // App
  app: {
    getVersion: (): Promise<string> =>
      ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),
    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.APP_OPEN_EXTERNAL, url),
    openPath: (filePath: string): Promise<string> =>
      ipcRenderer.invoke(IPC_CHANNELS.APP_OPEN_PATH, filePath),
    getPath: (name: string): Promise<string> =>
      ipcRenderer.invoke(IPC_CHANNELS.APP_GET_PATH, name),
    showDialog: (options: unknown): Promise<unknown> =>
      ipcRenderer.invoke(IPC_CHANNELS.APP_SHOW_DIALOG, options),
    onCmdRPressed: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on(IPC_CHANNELS.APP_CMD_R_PRESSED, handler);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.APP_CMD_R_PRESSED, handler);
      };
    },
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
      isGit?: boolean;
    }> => ipcRenderer.invoke(IPC_CHANNELS.DEV_OPEN_LOCAL_REPO),
    initGit: (repoPath: string): Promise<{
      success: boolean;
      branch?: string;
      error?: string;
    }> => ipcRenderer.invoke('dev:init-git', repoPath),
    checkGitRepo: (repoPath: string): Promise<{
      isGit: boolean;
      branch?: string;
      error?: string;
    }> => ipcRenderer.invoke(IPC_CHANNELS.DEV_CHECK_GIT_REPO, repoPath),
    getBranches: (repoPath: string): Promise<{
      success: boolean;
      branches: Array<{ name: string; current: boolean }>;
      currentBranch?: string;
      error?: string;
    }> => ipcRenderer.invoke(IPC_CHANNELS.DEV_GET_BRANCHES, repoPath),
    createSession: (data: {
      name: string;
      repoPath: string;
      branch: string;
      createWorktree?: boolean;
    }): Promise<Session> => ipcRenderer.invoke(IPC_CHANNELS.DEV_CREATE_SESSION, data),
    createTeleportSession: (data: {
      sessionId: string;
      name: string;
    }): Promise<Session> => ipcRenderer.invoke(IPC_CHANNELS.DEV_CREATE_TELEPORT_SESSION, data),
    getActiveSession: (): Promise<string | null> =>
      ipcRenderer.invoke('dev:get-active-session'),
    setActiveSession: (sessionId: string | null): Promise<void> =>
      ipcRenderer.invoke('dev:set-active-session', sessionId),
    getDevMode: (): Promise<boolean> =>
      ipcRenderer.invoke('dev:get-dev-mode'),
    setDevMode: (enabled: boolean): Promise<void> =>
      ipcRenderer.invoke('dev:set-dev-mode', enabled),
    checkWorktreeSetup: (repoPath: string): Promise<{
      success: boolean;
      hasScript: boolean;
      hasInstructions: boolean;
      scriptPath?: string;
      instructionsPath?: string;
      error?: string;
    }> => ipcRenderer.invoke(IPC_CHANNELS.DEV_CHECK_WORKTREE_SETUP, repoPath),
    saveWorktreeScript: (data: { repoPath: string; sourcePath: string }): Promise<{
      success: boolean;
      path?: string;
      error?: string;
    }> => ipcRenderer.invoke(IPC_CHANNELS.DEV_SAVE_WORKTREE_SCRIPT, data),
    saveWorktreeInstructions: (data: { repoPath: string; instructions: string }): Promise<{
      success: boolean;
      path?: string;
      error?: string;
    }> => ipcRenderer.invoke(IPC_CHANNELS.DEV_SAVE_WORKTREE_INSTRUCTIONS, data),
    executeWorktreeSetup: (data: { repoPath: string; worktreePath: string }): Promise<{
      success: boolean;
      type?: 'script' | 'instructions' | 'none';
      output?: string;
      error?: string;
      instructions?: string;
      message?: string;
    }> => ipcRenderer.invoke(IPC_CHANNELS.DEV_EXECUTE_WORKTREE_SETUP, data),
    getRegisteredWebviews: (): Promise<{ success: boolean; webviews: Array<[string, number]> }> =>
      ipcRenderer.invoke('dev:get-registered-webviews'),
    onSetupProgress: (callback: (data: { sessionId: string; status: 'running' | 'completed' | 'error'; message?: string; output?: string; error?: string }) => void) => {
      const handler = (_: IpcRendererEvent, data: { sessionId: string; status: 'running' | 'completed' | 'error'; message?: string; output?: string; error?: string }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.DEV_SETUP_PROGRESS, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.DEV_SETUP_PROGRESS, handler);
    },
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
    writeFile: (filePath: string, content: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.FS_WRITE_FILE, filePath, content),
    searchFiles: (sessionId: string, searchTerm: string): Promise<Array<{
      file: { name: string; path: string; relativePath: string };
      matches: string[];
    }>> => ipcRenderer.invoke(IPC_CHANNELS.FS_SEARCH_FILES, sessionId, searchTerm),
    searchSymbols: (sessionId: string, query: string): Promise<Array<{
      name: string;
      kind: string;
      path: string;
      relativePath: string;
      lineNumber: number;
      detail: string;
    }>> => ipcRenderer.invoke(IPC_CHANNELS.FS_SEARCH_SYMBOLS, sessionId, query),
  },

  // Audio
  audio: {
    transcribe: (audioData: ArrayBuffer, language?: string): Promise<{ success: boolean; result?: TranscriptionResult; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO_TRANSCRIBE, audioData, language),
    streamTTS: (request: TTSRequest): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO_TTS_STREAM, request),
    cancelTTS: (messageId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO_TTS_CANCEL, messageId),
    getVoices: (): Promise<{ success: boolean; voices?: Array<{ voice_id: string; name: string }>; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO_GET_VOICES),
    getSettings: (): Promise<AudioSettings> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO_SETTINGS_GET),
    setSettings: (settings: Partial<AudioSettings>): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO_SETTINGS_SET, settings),
    onTTSChunk: (callback: (data: { messageId: string; chunk: number[] }) => void) => {
      const handler = (_: IpcRendererEvent, data: { messageId: string; chunk: number[] }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.AUDIO_TTS_CHUNK, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AUDIO_TTS_CHUNK, handler);
    },
    onTTSComplete: (callback: (data: { messageId: string }) => void) => {
      const handler = (_: IpcRendererEvent, data: { messageId: string }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.AUDIO_TTS_COMPLETE, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AUDIO_TTS_COMPLETE, handler);
    },
    onTTSError: (callback: (data: { messageId: string; error: string }) => void) => {
      const handler = (_: IpcRendererEvent, data: { messageId: string; error: string }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.AUDIO_TTS_ERROR, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AUDIO_TTS_ERROR, handler);
    },
    // API Key management
    getElevenLabsKey: (): Promise<string> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO_GET_ELEVENLABS_KEY),
    setElevenLabsKey: (key: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO_SET_ELEVENLABS_KEY, key),
    getOpenAiKey: (): Promise<string> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO_GET_OPENAI_KEY),
    setOpenAiKey: (key: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO_SET_OPENAI_KEY, key),
  },

  // Realtime API for streaming transcription
  realtime: {
    connect: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.REALTIME_CONNECT),
    disconnect: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.REALTIME_DISCONNECT),
    sendAudio: (audioData: number[]): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.REALTIME_SEND_AUDIO, audioData),
    commitAudio: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.REALTIME_COMMIT_AUDIO),
    clearAudio: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.REALTIME_CLEAR_AUDIO),
    onConnected: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on(IPC_CHANNELS.REALTIME_CONNECTED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.REALTIME_CONNECTED, handler);
    },
    onDisconnected: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on(IPC_CHANNELS.REALTIME_DISCONNECTED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.REALTIME_DISCONNECTED, handler);
    },
    onTranscriptionDelta: (callback: (delta: string) => void) => {
      const handler = (_: IpcRendererEvent, delta: string) => callback(delta);
      ipcRenderer.on(IPC_CHANNELS.REALTIME_TRANSCRIPTION_DELTA, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.REALTIME_TRANSCRIPTION_DELTA, handler);
    },
    onTranscriptionCompleted: (callback: (transcript: string) => void) => {
      const handler = (_: IpcRendererEvent, transcript: string) => callback(transcript);
      ipcRenderer.on(IPC_CHANNELS.REALTIME_TRANSCRIPTION_COMPLETED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.REALTIME_TRANSCRIPTION_COMPLETED, handler);
    },
    onSpeechStarted: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on(IPC_CHANNELS.REALTIME_SPEECH_STARTED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.REALTIME_SPEECH_STARTED, handler);
    },
    onSpeechStopped: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on(IPC_CHANNELS.REALTIME_SPEECH_STOPPED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.REALTIME_SPEECH_STOPPED, handler);
    },
    onError: (callback: (error: string) => void) => {
      const handler = (_: IpcRendererEvent, error: string) => callback(error);
      ipcRenderer.on(IPC_CHANNELS.REALTIME_ERROR, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.REALTIME_ERROR, handler);
    },
  },

  // Extensions (commands, skills, agents)
  extensions: {
    scanCommands: (projectPath?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXTENSION_SCAN_COMMANDS, projectPath),
    scanSkills: (projectPath?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXTENSION_SCAN_SKILLS, projectPath),
    scanAgents: (projectPath?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXTENSION_SCAN_AGENTS, projectPath),
    getCommand: (commandName: string, projectPath?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXTENSION_GET_COMMAND, commandName, projectPath),
  },
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type declaration for the renderer
export type ElectronAPI = typeof electronAPI;
