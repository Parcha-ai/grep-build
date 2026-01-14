# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claudette (branded as "Grep") is an Electron desktop application providing an AI-powered development environment with Claude integration. Features include multi-session support, terminal emulation, browser preview with DOM inspection, Monaco code editor, and git integration.

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

## Development Workflow

**CRITICAL: Always test in dev before building!**

When making changes to the application:
1. Run `npm run start` to launch the dev version
2. Verify the changes work correctly in the dev build
3. Get explicit user confirmation that everything is working
4. Only build the production app when the user explicitly requests it with `/build`

Never build a production version (`npm run make`) without:
- First testing in dev mode
- Confirming with the user that dev version works
- Receiving explicit instruction to build (e.g., `/build` command)

## Slash Commands

### /build
Build the production application. This command:
1. Kills any running dev/electron processes
2. Runs `npm run make` to create the distributable
3. Opens the built application from `out/Grep Build-darwin-arm64/Grep Build.app`

Usage: User says `/build` when ready to create a production build after dev testing is complete.

## Architecture

### Process Architecture

Claudette follows Electron's multi-process architecture:

- **Main Process** (`src/main/`): Node.js process handling system operations
  - `index.ts`: Application entry, window management, IPC registration
  - `preload.ts`: Secure bridge between main and renderer via contextBridge
  - `services/`: Business logic services
  - `ipc/`: IPC handlers organized by domain

- **Renderer Process** (`src/renderer/`): React application
  - `App.tsx`: Root component with auth state routing
  - `stores/`: Zustand state management
  - `components/`: React components organized by feature

- **Shared** (`src/shared/`): Types and constants used by both processes
  - `types/index.ts`: Core TypeScript interfaces
  - `constants/channels.ts`: IPC channel name constants

### Key Services (Main Process)

| Service | Purpose |
|---------|---------|
| `claude.service.ts` | Claude Agent SDK integration, streaming, tool execution |
| `browser.service.ts` | Webview management, DOM inspection, network monitoring |
| `session.service.ts` | Session lifecycle, Claude Code transcript discovery |
| `terminal.service.ts` | PTY terminal emulation via node-pty |
| `git.service.ts` | Git operations via simple-git |
| `audio.service.ts` | Text-to-speech (ElevenLabs), transcription (OpenAI) |
| `realtime.service.ts` | OpenAI Realtime API for voice input |

### IPC Communication Pattern

All renderer-to-main communication uses typed IPC channels defined in `src/shared/constants/channels.ts`. The preload script exposes a typed `electronAPI` object.

```typescript
// Main process handler (src/main/ipc/*.ts)
ipcMain.handle(IPC_CHANNELS.SESSION_CREATE, async (_event, config) => { ... });

// Renderer invocation (via preload-exposed API)
const session = await window.electronAPI.sessions.create(config);
```

### State Management (Renderer)

Zustand stores in `src/renderer/stores/`:
- `session.store.ts`: Sessions, messages, streaming state, model selection, message queue
- `ui.store.ts`: Panel visibility, inspector state, selected elements
- `auth.store.ts`: Authentication state
- `audio.store.ts`: Audio/voice settings

### Claude Integration

`ClaudeService` uses `@anthropic-ai/claude-agent-sdk` for:
- Streaming responses via async generators
- Tool execution with permission modes (acceptEdits, bypassPermissions, plan, etc.)
- Extended thinking (off, thinking, ultrathink modes)
- Multi-model support (Opus 4.5, Sonnet 4.5, Sonnet 4, Haiku 3.5)
- MCP server integration for custom browser tools

### Browser Preview

`BrowserPreview` component provides:
- Electron webview with navigation controls
- DOM element inspector with selector generation
- Screenshot capture of selected elements
- Network request monitoring
- Console log capture

### Data Persistence

Uses `electron-store`:
- `claudette-settings`: App settings, API keys, active session ID
- `claudette-sessions`: Session data keyed by session ID

Session transcripts are discovered from Claude Code's `.claude/` directories.

## File Conventions

- IPC handlers: `src/main/ipc/{domain}.ipc.ts`
- Services: `src/main/services/{name}.service.ts`
- React components: `src/renderer/components/{feature}/{ComponentName}.tsx`
- Stores: `src/renderer/stores/{name}.store.ts`

## Native Dependencies

- **node-pty**: Terminal emulation (requires `sandbox: false` in webPreferences)
- Webpack externals configured in `webpack.main.config.ts` for native module handling

## Environment

- API key stored via electron-store at `anthropicApiKey`
- Custom protocol `claudette://` registered for OAuth callbacks
- Monaco editor assets served via custom `monaco-asset://` protocol
