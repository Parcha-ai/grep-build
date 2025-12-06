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
  CLAUDE_STREAM_END: 'claude:stream-end',
  CLAUDE_STREAM_ERROR: 'claude:stream-error',
  CLAUDE_TOOL_CALL: 'claude:tool-call',
  CLAUDE_TOOL_RESULT: 'claude:tool-result',
  CLAUDE_CANCEL: 'claude:cancel',

  // Browser preview channels
  BROWSER_NAVIGATE: 'browser:navigate',
  BROWSER_ELEMENT_SELECTED: 'browser:element-selected',
  BROWSER_INJECT_INSPECTOR: 'browser:inject-inspector',

  // Settings channels
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_RESET: 'settings:reset',

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
  FS_SEARCH_FILES: 'fs:search-files',
} as const;

export type IPCChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
