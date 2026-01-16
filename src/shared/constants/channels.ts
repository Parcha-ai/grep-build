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
  CLAUDE_GET_MODELS: 'claude:get-models',
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
  CLAUDE_COMPACTION_STATUS: 'claude:compaction-status',
  CLAUDE_COMPACTION_COMPLETE: 'claude:compaction-complete',
  CLAUDE_PLAN_CONTENT: 'claude:plan-content',

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
  APP_OPEN_PATH: 'app:open-path',
  APP_GET_PATH: 'app:get-path',
  APP_SHOW_DIALOG: 'app:show-dialog',
  APP_CMD_R_PRESSED: 'app:cmd-r-pressed',

  // Dev mode channels
  DEV_OPEN_LOCAL_REPO: 'dev:open-local-repo',
  DEV_CREATE_SESSION: 'dev:create-session',
  DEV_CREATE_TELEPORT_SESSION: 'dev:create-teleport-session',
  DEV_CHECK_GIT_REPO: 'dev:check-git-repo',
  DEV_GET_BRANCHES: 'dev:get-branches',
  DEV_CHECK_WORKTREE_SETUP: 'dev:check-worktree-setup',
  DEV_SAVE_WORKTREE_SCRIPT: 'dev:save-worktree-script',
  DEV_SAVE_WORKTREE_INSTRUCTIONS: 'dev:save-worktree-instructions',
  DEV_EXECUTE_WORKTREE_SETUP: 'dev:execute-worktree-setup',
  DEV_SETUP_PROGRESS: 'dev:setup-progress',

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

  // Voice mode channels (ElevenLabs Conversational AI)
  VOICE_CONNECT: 'voice:connect',
  VOICE_DISCONNECT: 'voice:disconnect',
  VOICE_SEND_AUDIO: 'voice:send-audio',
  VOICE_SEND_TEXT: 'voice:send-text',
  VOICE_END_INPUT: 'voice:end-input',
  VOICE_CONTEXT_UPDATE: 'voice:context-update',
  VOICE_CONNECTED: 'voice:connected',
  VOICE_DISCONNECTED: 'voice:disconnected',
  VOICE_RECONNECTING: 'voice:reconnecting',
  VOICE_USER_TRANSCRIPT: 'voice:user-transcript',
  VOICE_AGENT_RESPONSE: 'voice:agent-response',
  VOICE_AUDIO_CHUNK: 'voice:audio-chunk',
  VOICE_INTERRUPTION: 'voice:interruption',
  VOICE_ERROR: 'voice:error',
  VOICE_TOOL_CALL: 'voice:tool-call',
  VOICE_TOOL_RESULT: 'voice:tool-result',
  VOICE_UPDATE_AGENT_PROMPT: 'voice:update-agent-prompt',
  VOICE_USER_ACTIVITY: 'voice:user-activity',
} as const;

export type IPCChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
