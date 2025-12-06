# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claudette is an Electron desktop application that provides an AI-powered development environment with Claude integration. It features multi-session support, terminal emulation, browser preview with DOM inspection, and git integration.

## Build & Development Commands

```bash
# Start development server with hot reload
npm run start

# Run linting
npm run lint

# Package application
npm run package

# Build distributable
npm run make
```

## Architecture

### Process Architecture

Claudette follows Electron's multi-process architecture:

- **Main Process** (`src/main/`): Node.js process handling system operations
  - `index.ts`: Application entry, window management, IPC registration
  - `preload.ts`: Secure bridge between main and renderer via contextBridge
  - `services/`: Business logic (claude.service.ts, docker.service.ts, etc.)
  - `ipc/`: IPC handlers organized by domain (auth, session, git, terminal, claude, fs, dev)

- **Renderer Process** (`src/renderer/`): React application
  - `App.tsx`: Root component with auth state routing
  - `stores/`: Zustand state management (session.store.ts, auth.store.ts, ui.store.ts)
  - `components/`: React components organized by feature (chat, terminal, preview, git, layout)

- **Shared** (`src/shared/`): Types and constants used by both processes
  - `types/index.ts`: Core TypeScript interfaces (Session, ChatMessage, ToolCall, etc.)
  - `constants/channels.ts`: IPC channel name constants

### IPC Communication Pattern

All renderer-to-main communication uses typed IPC channels defined in `src/shared/constants/channels.ts`. The preload script (`src/main/preload.ts`) exposes a typed `electronAPI` object to the renderer.

```typescript
// Main process handler registration (in src/main/ipc/*.ts)
ipcMain.handle(IPC_CHANNELS.SESSION_CREATE, async (_event, config) => { ... });

// Renderer invocation (via preload-exposed API)
const session = await window.electronAPI.sessions.create(config);
```

### Data Persistence

Uses `electron-store` with two stores:
- `claudette-settings`: App settings, API keys, active session ID
- `claudette-sessions`: Session data keyed by session ID

### Session Types

Two session modes:
- **Dev Mode** (`isDevMode: true`): Direct local folder access without Docker
- **Container Mode**: Docker-isolated sessions (planned but not fully implemented)

## Key Technical Details

### Native Dependencies

- **node-pty**: Terminal emulation (requires `sandbox: false` in webPreferences)
- Webpack externals configured in `webpack.main.config.ts` for native module handling

### Claude Integration

`ClaudeService` (`src/main/services/claude.service.ts`):
- Uses `@anthropic-ai/sdk` for API communication
- Maintains conversation history per session
- System prompt includes session context (working directory, branch)
- Streaming responses via async generators

### State Management

- **Zustand stores** in `src/renderer/stores/`:
  - `session.store.ts`: Sessions, messages, streaming state
  - `ui.store.ts`: Panel visibility, inspector state
  - `auth.store.ts`: Authentication state

### Git Integration

Uses `simple-git` for git operations. Handles edge cases:
- Non-git folders: Prompts for git init
- Empty repos (no commits): Offers to create initial commit

## File Conventions

- IPC handlers: `src/main/ipc/{domain}.ipc.ts`
- Services: `src/main/services/{name}.service.ts`
- React components: `src/renderer/components/{feature}/{ComponentName}.tsx`
- Stores: `src/renderer/stores/{name}.store.ts`

## Environment

- API key stored via electron-store at `anthropicApiKey`
- Custom protocol `claudette://` registered for OAuth callbacks
- CSP configured in main process for security
