# Grep Build

An AI-powered development environment built on Electron with Claude integration.

## Download

Download the latest release from the [GitHub Releases](https://github.com/Parcha-ai/grep-build/releases) page.

## Features

### AI Chat Interface
- **Multi-model support**: Switch between Claude Opus 4.5, Sonnet 4.5, Sonnet 4, and Haiku 3.5
- **Extended thinking**: Three modes - off, thinking (10k tokens), ultrathink (100k tokens)
- **Permission modes**: Control how Claude executes tools (accept edits, require approval, bypass all, plan only)
- **Message queueing**: Type messages while Claude is responding - they'll be sent automatically
- **File mentions**: Use `@` to mention files, folders, or symbols from your codebase
- **Command palette**: Slash commands (`/commit`, `/agent`, `/skill`) for quick actions

### Browser Preview
- Live browser preview with navigation controls
- **DOM Inspector**: Click elements to capture their selector, HTML, and screenshot
- Network request monitoring
- Console log capture
- Screenshot capture for sending to Claude

### Integrated Terminal
- Full PTY terminal emulation via xterm.js
- Search functionality
- Web link detection

### Code Editor
- Monaco Editor with syntax highlighting
- Quick file search (`Cmd/Ctrl+P`)
- Multi-file support with tabs

### Git Integration
- Branch management
- Commit history visualization
- Diff viewing
- Push/pull operations

### Audio Features
- Voice input via OpenAI Realtime API
- Text-to-speech responses via ElevenLabs
- Configurable voice trigger word

### Session Management
- Automatic discovery of Claude Code sessions
- Per-session conversation history
- Session-specific settings (model, thinking mode, permissions)

## Getting Started

```bash
# Clone the repository
git clone https://github.com/Parcha-ai/grep-build.git
cd grep-build

# Install dependencies
npm install

# Start the development server
./scripts/dev.sh
```

## Configuration

### API Keys

On first launch, you'll need to configure:

1. **Anthropic API Key** (required): For Claude integration
2. **ElevenLabs API Key** (optional): For text-to-speech
3. **OpenAI API Key** (optional): For voice transcription

Access settings via the gear icon in the sidebar.

## Development

```bash
# Start with hot reload
./scripts/dev.sh

# Run linting
npm run lint

# Package for distribution
npm run package

# Build distributable
npm run make
```

## Architecture

Grep Build follows Electron's multi-process architecture:

```
src/
├── main/              # Main process (Node.js)
│   ├── index.ts       # App entry, window management
│   ├── preload.ts     # Secure IPC bridge
│   ├── services/      # Business logic
│   └── ipc/           # IPC handlers
├── renderer/          # Renderer process (React)
│   ├── App.tsx        # Root component
│   ├── stores/        # Zustand state management
│   └── components/    # UI components
└── shared/            # Shared types and constants
    ├── types/
    └── constants/
```

## Tech Stack

- **Framework**: Electron 39
- **Frontend**: React 18, TypeScript
- **State**: Zustand
- **Styling**: Tailwind CSS
- **Editor**: Monaco Editor
- **Terminal**: xterm.js + node-pty
- **AI**: Claude Agent SDK, Anthropic SDK
- **Build**: Electron Forge, Webpack

## License

MIT - see [LICENSE](LICENSE) for details.
