// IPC Channel Names

export const IPC_CHANNELS = {
  // Auth channels
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_GET_USER: 'auth:get-user',
  AUTH_GET_REPOS: 'auth:get-repos',
  AUTH_STATUS: 'auth:status',

  // Session channels
  SESSION_CREATE: 'session:create',
  SESSION_START: 'session:start',
  SESSION_STOP: 'session:stop',
  SESSION_DELETE: 'session:delete',
  SESSION_LIST: 'session:list',
  SESSION_GET: 'session:get',
  SESSION_UPDATE: 'session:update',
  SESSION_STATUS_CHANGED: 'session:status-changed',

  // Docker channels
  DOCKER_STATUS: 'docker:status',
  DOCKER_CONTAINER_STATS: 'docker:container-stats',
  DOCKER_CONTAINER_LOGS: 'docker:container-logs',

  // Terminal channels
  TERMINAL_CREATE: 'terminal:create',
  TERMINAL_INPUT: 'terminal:input',
  TERMINAL_OUTPUT: 'terminal:output',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_CLOSE: 'terminal:close',

  // Git channels
  GIT_STATUS: 'git:status',
  GIT_LOG: 'git:log',
  GIT_BRANCHES: 'git:branches',
  GIT_CHECKOUT: 'git:checkout',
  GIT_DIFF: 'git:diff',
  GIT_COMMIT: 'git:commit',
  GIT_PUSH: 'git:push',
  GIT_PULL: 'git:pull',
  GIT_CLONE: 'git:clone',

  // Claude channels
  CLAUDE_SEND_MESSAGE: 'claude:send-message',
  CLAUDE_GET_MESSAGES: 'claude:get-messages',
  CLAUDE_STREAM_CHUNK: 'claude:stream-chunk',
  CLAUDE_THINKING_CHUNK: 'claude:thinking-chunk',
  CLAUDE_STREAM_END: 'claude:stream-end',
  CLAUDE_STREAM_ERROR: 'claude:stream-error',
  CLAUDE_TOOL_CALL: 'claude:tool-call',
  CLAUDE_TOOL_RESULT: 'claude:tool-result',
  CLAUDE_SYSTEM_INFO: 'claude:system-info',
  CLAUDE_CANCEL: 'claude:cancel',
  CLAUDE_PERMISSION_REQUEST: 'claude:permission-request',
  CLAUDE_PERMISSION_RESPONSE: 'claude:permission-response',
  CLAUDE_QUESTION_REQUEST: 'claude:question-request',
  CLAUDE_QUESTION_RESPONSE: 'claude:question-response',

  // Browser preview channels
  BROWSER_NAVIGATE: 'browser:navigate',
  BROWSER_NAVIGATE_TO: 'browser:navigate-to',
  BROWSER_ELEMENT_SELECTED: 'browser:element-selected',
  BROWSER_INJECT_INSPECTOR: 'browser:inject-inspector',
  BROWSER_CAPTURE_SNAPSHOT: 'browser:capture-snapshot',
  BROWSER_GET_SNAPSHOT: 'browser:get-snapshot',
  BROWSER_CLEAR_STORAGE: 'browser:clear-storage',

  // Settings channels
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_RESET: 'settings:reset',
  SETTINGS_GET_API_KEY: 'settings:get-api-key',
  SETTINGS_SET_API_KEY: 'settings:set-api-key',

  // App channels
  APP_GET_VERSION: 'app:get-version',
  APP_OPEN_EXTERNAL: 'app:open-external',
  APP_GET_PATH: 'app:get-path',
  APP_SHOW_DIALOG: 'app:show-dialog',

  // Dev mode channels
  DEV_OPEN_LOCAL_REPO: 'dev:open-local-repo',
  DEV_CREATE_SESSION: 'dev:create-session',

  // File system channels
  FS_LIST_FILES: 'fs:list-files',
  FS_READ_FILE: 'fs:read-file',
  FS_WRITE_FILE: 'fs:write-file',
  FS_SEARCH_FILES: 'fs:search-files',
  FS_SEARCH_SYMBOLS: 'fs:search-symbols',

  // Audio channels
  AUDIO_TRANSCRIBE: 'audio:transcribe',
  AUDIO_TTS_STREAM: 'audio:tts-stream',
  AUDIO_TTS_CANCEL: 'audio:tts-cancel',
  AUDIO_TTS_CHUNK: 'audio:tts-chunk',
  AUDIO_TTS_COMPLETE: 'audio:tts-complete',
  AUDIO_TTS_ERROR: 'audio:tts-error',
  AUDIO_GET_VOICES: 'audio:get-voices',
  AUDIO_SETTINGS_GET: 'audio:settings-get',
  AUDIO_SETTINGS_SET: 'audio:settings-set',
  AUDIO_GET_ELEVENLABS_KEY: 'audio:get-elevenlabs-key',
  AUDIO_SET_ELEVENLABS_KEY: 'audio:set-elevenlabs-key',
  AUDIO_GET_OPENAI_KEY: 'audio:get-openai-key',
  AUDIO_SET_OPENAI_KEY: 'audio:set-openai-key',

  // Realtime transcription channels
  REALTIME_CONNECT: 'realtime:connect',
  REALTIME_DISCONNECT: 'realtime:disconnect',
  REALTIME_SEND_AUDIO: 'realtime:send-audio',
  REALTIME_COMMIT_AUDIO: 'realtime:commit-audio',
  REALTIME_CLEAR_AUDIO: 'realtime:clear-audio',
  REALTIME_TRANSCRIPTION_DELTA: 'realtime:transcription-delta',
  REALTIME_TRANSCRIPTION_COMPLETED: 'realtime:transcription-completed',
  REALTIME_SPEECH_STARTED: 'realtime:speech-started',
  REALTIME_SPEECH_STOPPED: 'realtime:speech-stopped',
  REALTIME_ERROR: 'realtime:error',
  REALTIME_CONNECTED: 'realtime:connected',
  REALTIME_DISCONNECTED: 'realtime:disconnected',

  // Extension channels (commands, skills, agents)
  EXTENSION_SCAN_COMMANDS: 'extension:scan-commands',
  EXTENSION_SCAN_SKILLS: 'extension:scan-skills',
  EXTENSION_SCAN_AGENTS: 'extension:scan-agents',
  EXTENSION_GET_COMMAND: 'extension:get-command',
} as const;

export type IPCChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
