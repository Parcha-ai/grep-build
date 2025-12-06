# Q's Strategic Mission Planning: OPERATION CLAUDETTE

**Classification:** TOP SECRET - QUARTERMASTER EYES ONLY
**Date:** 2025-12-05
**Mission Codename:** CLAUDETTE
**Prepared by:** Q Branch, Her Majesty's Secret Service

---

*"So you want to rebuild Claude Code from scratch, do you? In Electron? With Docker containers, git worktrees, OAuth, embedded browsers, AND DOM selection? Have you considered the forty-seven ways this could explode spectacularly?"*

---

## Executive Summary

This document outlines the comprehensive strategic plan for building "Claudette" - a full-featured Electron desktop application that recreates and enhances Claude Code functionality. The mission requires integrating multiple complex subsystems: AI agent orchestration, Docker container management, git worktree isolation, OAuth authentication, terminal emulation, and browser inspection capabilities.

**Risk Assessment:** HIGH COMPLEXITY
**Estimated Development Time:** 8-12 weeks for MVP
**Recommended Team Size:** 2-3 developers minimum

---

## Table of Contents

1. [Technology Stack Analysis](#1-technology-stack-analysis)
2. [Architecture Design](#2-architecture-design)
3. [File Structure](#3-file-structure)
4. [Core Dependencies](#4-core-dependencies)
5. [Feature Implementation Strategy](#5-feature-implementation-strategy)
6. [Risk Assessment & Mitigation](#6-risk-assessment--mitigation)
7. [Implementation Phases](#7-implementation-phases)
8. [Security Considerations](#8-security-considerations)
9. [Testing Strategy](#9-testing-strategy)
10. [Deployment & Distribution](#10-deployment--distribution)

---

## 1. Technology Stack Analysis

### 1.1 Framework Selection: Electron Forge

**Recommendation:** Use [Electron Forge](https://www.electronforge.io/guides/framework-integration/react-with-typescript) with the webpack-typescript template.

**Rationale:**
- Official Electron tooling with unified interface
- Better maintained than electron-react-boilerplate
- Native TypeScript support
- Simplified packaging and distribution
- Active community and documentation

**Initialization Command:**
```bash
npm init electron-app@latest claudette -- --template=webpack-typescript
```

### 1.2 UI Framework: React 18

**Recommendation:** React 18 with TypeScript

**Rationale:**
- Concurrent rendering for smooth UI during heavy operations
- Excellent ecosystem for complex UIs
- Strong typing with TypeScript
- Rich component libraries available
- Suspense for async data loading

### 1.3 State Management: Zustand + React Query

**Recommendation:** Zustand for global state, TanStack Query for server state

**Rationale:**
- Zustand: Lightweight, TypeScript-first, no boilerplate
- TanStack Query: Excellent for async state (Docker status, git operations)
- Avoids Redux complexity for this use case
- Easy DevTools integration

### 1.4 Styling: Tailwind CSS + Radix UI

**Recommendation:** Tailwind CSS for utility-first styling, Radix UI for accessible primitives

**Rationale:**
- Tailwind enables rapid dark-theme development
- Radix provides unstyled, accessible components
- Both are TypeScript-friendly
- Matches Claude Code's aesthetic easily

### 1.5 AI Integration: Claude Agent SDK

**Package:** `@anthropic-ai/claude-agent-sdk`

**Key Capabilities:**
- Full Claude Code tool suite (file ops, bash, web search)
- MCP (Model Context Protocol) integration
- Streaming responses
- Session management
- Built-in permission model

---

## 2. Architecture Design

### 2.1 High-Level Architecture

```
+------------------------------------------------------------------+
|                        CLAUDETTE APPLICATION                       |
+------------------------------------------------------------------+
|                                                                    |
|  +------------------+    +------------------+    +----------------+ |
|  |   MAIN PROCESS   |    | RENDERER PROCESS |    |    WEBVIEW     | |
|  +------------------+    +------------------+    +----------------+ |
|  |                  |    |                  |    |                | |
|  | - Window Mgmt    |<-->| - React UI       |    | - Browser      | |
|  | - IPC Handlers   |    | - Chat Interface |    |   Preview      | |
|  | - Docker API     |    | - Terminal View  |    | - DOM          | |
|  | - Git Operations |    | - File Explorer  |    |   Inspection   | |
|  | - OAuth Flow     |    | - Diff Viewer    |    |                | |
|  | - Session State  |    | - Git History    |    |                | |
|  |                  |    |                  |    |                | |
|  +--------+---------+    +--------+---------+    +-------+--------+ |
|           |                       |                      |          |
+-----------|-----------------------|----------------------|----------+
            |                       |                      |
            v                       v                      v
+------------------------------------------------------------------+
|                     EXTERNAL SERVICES LAYER                        |
+------------------------------------------------------------------+
|                                                                    |
|  +----------------+  +----------------+  +----------------------+   |
|  | Claude Agent   |  | Docker Engine  |  | GitHub OAuth API     |   |
|  | SDK            |  |                |  |                      |   |
|  | - Anthropic API|  | - Containers   |  | - PKCE Flow          |   |
|  | - MCP Servers  |  | - Volumes      |  | - Token Management   |   |
|  | - Tool Calls   |  | - Networks     |  | - Repo Access        |   |
|  +----------------+  +----------------+  +----------------------+   |
|                                                                    |
+------------------------------------------------------------------+
```

### 2.2 Process Communication Model

```
Main Process                    Renderer Process
+------------------+           +------------------+
|                  |   IPC     |                  |
|  DockerService   |<--------->|  useDocker()     |
|  GitService      |<--------->|  useGit()        |
|  AuthService     |<--------->|  useAuth()       |
|  SessionManager  |<--------->|  useSession()    |
|  ClaudeService   |<--------->|  useClaude()     |
|                  |           |                  |
+------------------+           +------------------+
```

### 2.3 Docker Session Architecture

Each Claude session operates in isolation:

```
Repository Root
|
+-- .git/                          # Main git directory
|
+-- worktrees/
    |
    +-- main/                      # Main branch worktree
    |   +-- [project files]
    |
    +-- feature-auth/              # Feature branch worktree
    |   +-- [project files]
    |   +-- .claudette/            # Session-specific config
    |       +-- setup.sh           # Editable bash setup script
    |       +-- mcp-config.json    # MCP server configuration
    |
    +-- bugfix-memory-leak/        # Another session
        +-- [project files]
        +-- .claudette/
            +-- setup.sh
```

**Docker Container per Session:**
```yaml
# Generated docker-compose.yml per session
version: '3.8'
services:
  claude-session-{uuid}:
    build:
      context: .
      dockerfile: ${REPO_DOCKERFILE:-Dockerfile.claudette}
    volumes:
      - ./worktrees/{branch}:/workspace:delegated
      - ~/.claudette/mcp:/mcp:ro
    environment:
      - CLAUDE_SESSION_ID={uuid}
      - WORKTREE_BRANCH={branch}
    ports:
      - "{dynamic_port}:3000"  # For preview
    networks:
      - claudette-network
```

### 2.4 Port Allocation Strategy

To avoid conflicts when running multiple sessions:

```typescript
// Port allocation formula
const BASE_PORT = 10000;
const PORTS_PER_SESSION = 10;

function allocatePorts(sessionIndex: number): PortAllocation {
  const basePort = BASE_PORT + (sessionIndex * PORTS_PER_SESSION);
  return {
    web: basePort,        // e.g., 10000, 10010, 10020
    api: basePort + 1,    // e.g., 10001, 10011, 10021
    debug: basePort + 2,  // e.g., 10002, 10012, 10022
    // ... reserved ports 3-9 for future use
  };
}
```

---

## 3. File Structure

```
claudette/
|
+-- .notes/                           # Planning and documentation
|   +-- q-planning-claudette-2025-12-05.md
|
+-- src/
|   |
|   +-- main/                         # Electron Main Process
|   |   +-- index.ts                  # Main entry point
|   |   +-- preload.ts                # Preload script
|   |   |
|   |   +-- services/                 # Main process services
|   |   |   +-- docker.service.ts     # Docker management
|   |   |   +-- git.service.ts        # Git operations
|   |   |   +-- auth.service.ts       # OAuth handling
|   |   |   +-- claude.service.ts     # Claude Agent SDK wrapper
|   |   |   +-- session.service.ts    # Session lifecycle
|   |   |   +-- mcp.service.ts        # MCP server management
|   |   |
|   |   +-- ipc/                      # IPC handlers
|   |   |   +-- docker.ipc.ts
|   |   |   +-- git.ipc.ts
|   |   |   +-- auth.ipc.ts
|   |   |   +-- claude.ipc.ts
|   |   |   +-- session.ipc.ts
|   |   |
|   |   +-- utils/                    # Main process utilities
|   |       +-- port-allocator.ts
|   |       +-- worktree-manager.ts
|   |       +-- docker-compose-generator.ts
|   |
|   +-- renderer/                     # React Application
|   |   +-- index.tsx                 # Renderer entry
|   |   +-- App.tsx                   # Root component
|   |   |
|   |   +-- components/               # React components
|   |   |   +-- layout/
|   |   |   |   +-- Sidebar.tsx
|   |   |   |   +-- MainContent.tsx
|   |   |   |   +-- StatusBar.tsx
|   |   |   |
|   |   |   +-- chat/
|   |   |   |   +-- ChatContainer.tsx
|   |   |   |   +-- MessageList.tsx
|   |   |   |   +-- MessageBubble.tsx
|   |   |   |   +-- ToolCallDisplay.tsx
|   |   |   |   +-- InputArea.tsx
|   |   |   |   +-- SlashCommandMenu.tsx
|   |   |   |
|   |   |   +-- terminal/
|   |   |   |   +-- TerminalContainer.tsx
|   |   |   |   +-- TerminalTabs.tsx
|   |   |   |
|   |   |   +-- preview/
|   |   |   |   +-- BrowserPreview.tsx
|   |   |   |   +-- DOMInspector.tsx
|   |   |   |   +-- ElementSelector.tsx
|   |   |   |
|   |   |   +-- git/
|   |   |   |   +-- GitTree.tsx
|   |   |   |   +-- CommitHistory.tsx
|   |   |   |   +-- DiffViewer.tsx
|   |   |   |   +-- BranchSelector.tsx
|   |   |   |
|   |   |   +-- session/
|   |   |   |   +-- SessionList.tsx
|   |   |   |   +-- SessionCard.tsx
|   |   |   |   +-- SetupScriptEditor.tsx
|   |   |   |   +-- NewSessionDialog.tsx
|   |   |   |
|   |   |   +-- auth/
|   |   |   |   +-- LoginScreen.tsx
|   |   |   |   +-- RepoSelector.tsx
|   |   |   |
|   |   |   +-- editor/
|   |   |       +-- MonacoWrapper.tsx
|   |   |       +-- FileTree.tsx
|   |   |
|   |   +-- hooks/                    # Custom React hooks
|   |   |   +-- useDocker.ts
|   |   |   +-- useGit.ts
|   |   |   +-- useAuth.ts
|   |   |   +-- useClaude.ts
|   |   |   +-- useSession.ts
|   |   |   +-- useTerminal.ts
|   |   |   +-- useWebview.ts
|   |   |
|   |   +-- stores/                   # Zustand stores
|   |   |   +-- session.store.ts
|   |   |   +-- ui.store.ts
|   |   |   +-- settings.store.ts
|   |   |
|   |   +-- styles/                   # Global styles
|   |       +-- globals.css
|   |       +-- theme.css
|   |
|   +-- shared/                       # Shared types and utils
|   |   +-- types/
|   |   |   +-- session.types.ts
|   |   |   +-- docker.types.ts
|   |   |   +-- git.types.ts
|   |   |   +-- claude.types.ts
|   |   |   +-- ipc.types.ts
|   |   |
|   |   +-- constants/
|   |   |   +-- channels.ts           # IPC channel names
|   |   |   +-- defaults.ts
|   |   |
|   |   +-- utils/
|   |       +-- validators.ts
|   |       +-- formatters.ts
|   |
|   +-- webview/                      # Webview preload scripts
|       +-- dom-inspector.preload.ts
|       +-- element-selector.ts
|
+-- resources/                        # Static resources
|   +-- icons/
|   +-- templates/
|   |   +-- Dockerfile.claudette      # Default Dockerfile
|   |   +-- docker-compose.template.yml
|   |   +-- setup.template.sh
|   +-- mcp-servers/                  # Bundled MCP servers
|
+-- test/                             # Test files
|   +-- unit/
|   +-- integration/
|   +-- e2e/
|
+-- .erb/                             # Electron React Boilerplate config (if used)
+-- forge.config.ts                   # Electron Forge configuration
+-- webpack.main.config.ts
+-- webpack.renderer.config.ts
+-- webpack.rules.ts
+-- tsconfig.json
+-- tailwind.config.js
+-- package.json
+-- README.md
```

---

## 4. Core Dependencies

### 4.1 Production Dependencies

```json
{
  "dependencies": {
    // Electron & React Core
    "electron-squirrel-startup": "^1.0.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.28.0",

    // Claude Agent SDK
    "@anthropic-ai/claude-agent-sdk": "^0.1.58",

    // MCP Integration
    "@modelcontextprotocol/sdk": "^1.0.0",

    // State Management
    "zustand": "^5.0.0",
    "@tanstack/react-query": "^5.60.0",

    // Terminal Emulation
    "@xterm/xterm": "^5.5.0",
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/addon-search": "^0.15.0",
    "@xterm/addon-web-links": "^0.11.0",
    "node-pty": "^1.0.0",

    // Code Editor
    "@monaco-editor/react": "^4.7.0",
    "monaco-editor": "^0.52.0",

    // Docker Integration
    "dockerode": "^4.0.0",
    "@types/dockerode": "^3.3.31",

    // Git Operations
    "simple-git": "^3.27.0",
    "isomorphic-git": "^1.27.0",

    // UI Components
    "@radix-ui/react-dialog": "^1.1.0",
    "@radix-ui/react-dropdown-menu": "^2.1.0",
    "@radix-ui/react-tabs": "^1.1.0",
    "@radix-ui/react-tooltip": "^1.1.0",
    "@radix-ui/react-context-menu": "^2.2.0",
    "@radix-ui/react-scroll-area": "^1.2.0",

    // Icons
    "lucide-react": "^0.460.0",

    // Utilities
    "uuid": "^11.0.0",
    "yaml": "^2.6.0",
    "electron-store": "^10.0.0",
    "date-fns": "^4.1.0"
  }
}
```

### 4.2 Development Dependencies

```json
{
  "devDependencies": {
    // Electron Forge
    "@electron-forge/cli": "^7.5.0",
    "@electron-forge/maker-squirrel": "^7.5.0",
    "@electron-forge/maker-zip": "^7.5.0",
    "@electron-forge/maker-deb": "^7.5.0",
    "@electron-forge/maker-dmg": "^7.5.0",
    "@electron-forge/plugin-auto-unpack-natives": "^7.5.0",
    "@electron-forge/plugin-webpack": "^7.5.0",

    // TypeScript
    "typescript": "^5.7.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/node": "^22.0.0",

    // Webpack
    "webpack": "^5.96.0",
    "webpack-cli": "^5.1.0",
    "ts-loader": "^9.5.0",
    "css-loader": "^7.1.0",
    "style-loader": "^4.0.0",
    "postcss-loader": "^8.1.0",
    "fork-ts-checker-webpack-plugin": "^9.0.0",

    // Tailwind
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0",

    // Native Module Rebuilding
    "@electron/rebuild": "^3.6.0",
    "electron": "^33.0.0",

    // Testing
    "vitest": "^2.1.0",
    "@testing-library/react": "^16.0.0",
    "@playwright/test": "^1.49.0",

    // Linting
    "eslint": "^9.15.0",
    "eslint-plugin-react": "^7.37.0",
    "@typescript-eslint/eslint-plugin": "^8.15.0",
    "prettier": "^3.4.0"
  }
}
```

---

## 5. Feature Implementation Strategy

### 5.1 GitHub OAuth Integration

**Implementation Approach:**

```typescript
// src/main/services/auth.service.ts

import { BrowserWindow } from 'electron';
import crypto from 'crypto';

interface PKCEPair {
  codeVerifier: string;
  codeChallenge: string;
}

class AuthService {
  private readonly CLIENT_ID = process.env.GITHUB_CLIENT_ID;
  private readonly REDIRECT_URI = 'claudette://oauth/callback';

  generatePKCE(): PKCEPair {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    return { codeVerifier, codeChallenge };
  }

  async initiateOAuth(): Promise<string> {
    const { codeVerifier, codeChallenge } = this.generatePKCE();

    // Store verifier for token exchange
    this.storeVerifier(codeVerifier);

    const authUrl = new URL('https://github.com/login/oauth/authorize');
    authUrl.searchParams.set('client_id', this.CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', this.REDIRECT_URI);
    authUrl.searchParams.set('scope', 'repo read:user');
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    const authWindow = new BrowserWindow({
      width: 800,
      height: 600,
      webPreferences: { nodeIntegration: false }
    });

    return new Promise((resolve, reject) => {
      authWindow.loadURL(authUrl.toString());

      // Handle redirect with authorization code
      authWindow.webContents.on('will-redirect', async (event, url) => {
        if (url.startsWith(this.REDIRECT_URI)) {
          event.preventDefault();
          const code = new URL(url).searchParams.get('code');
          authWindow.close();
          resolve(code);
        }
      });
    });
  }
}
```

**Key Considerations:**
- Use PKCE (Proof Key for Code Exchange) - GitHub now supports it
- Register custom protocol handler (`claudette://`)
- Store tokens securely using `electron-store` with encryption
- Implement token refresh logic

### 5.2 Multi-Worktree Docker Sessions

**Docker Service Implementation:**

```typescript
// src/main/services/docker.service.ts

import Docker from 'dockerode';
import { generateCompose } from '../utils/docker-compose-generator';

class DockerService {
  private docker: Docker;
  private sessions: Map<string, ContainerSession> = new Map();

  constructor() {
    this.docker = new Docker();
  }

  async createSession(config: SessionConfig): Promise<string> {
    const sessionId = uuid();
    const ports = allocatePorts(this.sessions.size);

    // Generate docker-compose.yml
    const composeConfig = generateCompose({
      sessionId,
      worktreePath: config.worktreePath,
      ports,
      repoDockerfile: config.repoDockerfile,
      setupScript: config.setupScript
    });

    // Write compose file to session directory
    await fs.writeFile(
      path.join(config.worktreePath, '.claudette', 'docker-compose.yml'),
      yaml.stringify(composeConfig)
    );

    // Start container
    await this.startContainer(sessionId, config.worktreePath);

    return sessionId;
  }

  async executeInContainer(sessionId: string, command: string): Promise<ExecResult> {
    const container = await this.getContainer(sessionId);
    const exec = await container.exec({
      Cmd: ['bash', '-c', command],
      AttachStdout: true,
      AttachStderr: true
    });

    return this.streamExec(exec);
  }
}
```

**Docker Compose Template:**

```yaml
# resources/templates/docker-compose.template.yml
version: '3.8'

services:
  claude-session:
    build:
      context: ${REPO_ROOT}
      dockerfile: ${DOCKERFILE_PATH}
    container_name: claudette-${SESSION_ID}
    volumes:
      - ${WORKTREE_PATH}:/workspace:delegated
      - ${MCP_CONFIG_PATH}:/home/claude/.mcp:ro
      - claudette-cache-${SESSION_ID}:/home/claude/.cache
    working_dir: /workspace
    environment:
      - CLAUDE_SESSION_ID=${SESSION_ID}
      - TERM=xterm-256color
    ports:
      - "${WEB_PORT}:3000"
      - "${API_PORT}:8000"
    networks:
      - claudette
    entrypoint: ["/bin/bash", "-c"]
    command: ["source /workspace/.claudette/setup.sh && sleep infinity"]

volumes:
  claudette-cache-${SESSION_ID}:

networks:
  claudette:
    external: true
```

### 5.3 Editable Bash Setup Scripts

**Setup Script Editor Component:**

```typescript
// src/renderer/components/session/SetupScriptEditor.tsx

import { Editor } from '@monaco-editor/react';
import { useSession } from '../../hooks/useSession';

export function SetupScriptEditor({ sessionId }: { sessionId: string }) {
  const { session, updateSetupScript } = useSession(sessionId);

  const defaultScript = `#!/bin/bash
# Claudette Session Setup Script
# This script runs when the Docker container starts

# Install dependencies
if [ -f "package.json" ]; then
  npm install
fi

# Start development server (runs in background)
# npm run dev &

# Custom environment variables
export NODE_ENV=development

# Add your custom setup commands below:
`;

  return (
    <div className="h-full flex flex-col">
      <div className="p-2 bg-zinc-800 border-b border-zinc-700">
        <span className="text-sm text-zinc-400">
          Setup Script - Runs when container starts
        </span>
      </div>
      <Editor
        height="100%"
        defaultLanguage="shell"
        theme="vs-dark"
        value={session?.setupScript || defaultScript}
        onChange={(value) => updateSetupScript(sessionId, value)}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: 'on',
          wordWrap: 'on'
        }}
      />
    </div>
  );
}
```

### 5.4 Claude Agent SDK Integration

**Claude Service Implementation:**

```typescript
// src/main/services/claude.service.ts

import { ClaudeAgent, ClaudeMessage, Tool } from '@anthropic-ai/claude-agent-sdk';

class ClaudeService {
  private agent: ClaudeAgent | null = null;

  async initializeAgent(sessionConfig: SessionConfig): Promise<void> {
    this.agent = new ClaudeAgent({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: 'claude-sonnet-4-20250514',
      workingDirectory: sessionConfig.worktreePath,
      tools: this.getEnabledTools(sessionConfig),
      mcpServers: await this.loadMCPServers(sessionConfig),
      systemPrompt: sessionConfig.customSystemPrompt
    });
  }

  async *streamMessage(
    userMessage: string,
    context?: ConversationContext
  ): AsyncGenerator<StreamEvent> {
    if (!this.agent) throw new Error('Agent not initialized');

    const stream = this.agent.streamMessage(userMessage, {
      conversationId: context?.conversationId,
      attachments: context?.attachments
    });

    for await (const event of stream) {
      yield this.transformEvent(event);
    }
  }

  private getEnabledTools(config: SessionConfig): Tool[] {
    const tools: Tool[] = [
      'read_file',
      'write_file',
      'edit_file',
      'bash',
      'glob',
      'grep',
      'web_search',
      'web_fetch'
    ];

    if (config.enableNotebook) tools.push('notebook_edit');

    return tools;
  }

  private async loadMCPServers(config: SessionConfig) {
    // Load MCP configuration from session
    const mcpConfig = await fs.readJSON(
      path.join(config.worktreePath, '.claudette', 'mcp-config.json')
    ).catch(() => ({ servers: [] }));

    return mcpConfig.servers;
  }
}
```

### 5.5 Terminal Emulation with xterm.js

**Terminal Container Component:**

```typescript
// src/renderer/components/terminal/TerminalContainer.tsx

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

interface TerminalContainerProps {
  sessionId: string;
}

export function TerminalContainer({ sessionId }: TerminalContainerProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    const terminal = new Terminal({
      theme: {
        background: '#1a1a1a',
        foreground: '#e4e4e4',
        cursor: '#e4e4e4',
        cursorAccent: '#1a1a1a',
        selectionBackground: '#404040'
      },
      fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
      fontSize: 13,
      cursorBlink: true
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    terminal.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Connect to PTY in main process via IPC
    const unsubscribe = window.electronAPI.onTerminalData(sessionId, (data) => {
      terminal.write(data);
    });

    terminal.onData((data) => {
      window.electronAPI.sendTerminalInput(sessionId, data);
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      window.electronAPI.resizeTerminal(sessionId, {
        cols: terminal.cols,
        rows: terminal.rows
      });
    });
    resizeObserver.observe(terminalRef.current);

    return () => {
      unsubscribe();
      resizeObserver.disconnect();
      terminal.dispose();
    };
  }, [sessionId]);

  return <div ref={terminalRef} className="h-full w-full" />;
}
```

### 5.6 Embedded Browser Preview with DOM Inspection

**Browser Preview Component:**

```typescript
// src/renderer/components/preview/BrowserPreview.tsx

import { useRef, useState } from 'react';
import { useWebview } from '../../hooks/useWebview';

interface BrowserPreviewProps {
  sessionId: string;
  port: number;
}

export function BrowserPreview({ sessionId, port }: BrowserPreviewProps) {
  const webviewRef = useRef<Electron.WebviewTag>(null);
  const [isInspecting, setIsInspecting] = useState(false);
  const { injectInspector, getElementContext } = useWebview(webviewRef);

  const handleInspectElement = async () => {
    if (!webviewRef.current) return;

    setIsInspecting(true);
    await injectInspector();

    // Listen for element selection
    webviewRef.current.addEventListener('ipc-message', async (event) => {
      if (event.channel === 'element-selected') {
        const elementContext = await getElementContext(event.args[0]);
        // Send to Claude as context
        window.electronAPI.sendToClaude(sessionId, {
          type: 'dom_context',
          element: elementContext
        });
        setIsInspecting(false);
      }
    });
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 p-2 bg-zinc-800 border-b border-zinc-700">
        <input
          type="text"
          value={`http://localhost:${port}`}
          className="flex-1 bg-zinc-900 text-sm px-3 py-1 rounded"
          readOnly
        />
        <button
          onClick={() => webviewRef.current?.reload()}
          className="p-1 hover:bg-zinc-700 rounded"
        >
          Reload
        </button>
        <button
          onClick={handleInspectElement}
          className={`p-1 rounded ${isInspecting ? 'bg-blue-600' : 'hover:bg-zinc-700'}`}
        >
          Select Element
        </button>
        <button
          onClick={() => webviewRef.current?.openDevTools()}
          className="p-1 hover:bg-zinc-700 rounded"
        >
          DevTools
        </button>
      </div>
      <webview
        ref={webviewRef}
        src={`http://localhost:${port}`}
        className="flex-1"
        preload={`file://${window.electronAPI.getPreloadPath('dom-inspector')}`}
      />
    </div>
  );
}
```

**DOM Inspector Preload Script:**

```typescript
// src/webview/dom-inspector.preload.ts

import { ipcRenderer } from 'electron';

let inspectorActive = false;
let highlightOverlay: HTMLElement | null = null;

function createHighlightOverlay(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.id = 'claudette-inspector-overlay';
  overlay.style.cssText = `
    position: fixed;
    pointer-events: none;
    background: rgba(59, 130, 246, 0.3);
    border: 2px solid #3b82f6;
    z-index: 999999;
    transition: all 0.1s ease;
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function getElementSelector(element: HTMLElement): string {
  const parts: string[] = [];
  let current: HTMLElement | null = element;

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      selector += `#${current.id}`;
    } else if (current.className) {
      selector += `.${current.className.split(' ').join('.')}`;
    }
    parts.unshift(selector);
    current = current.parentElement;
  }

  return parts.join(' > ');
}

function getElementContext(element: HTMLElement) {
  return {
    tagName: element.tagName.toLowerCase(),
    id: element.id,
    className: element.className,
    selector: getElementSelector(element),
    innerHTML: element.innerHTML.slice(0, 500),
    outerHTML: element.outerHTML.slice(0, 1000),
    textContent: element.textContent?.slice(0, 500),
    attributes: Array.from(element.attributes).map(attr => ({
      name: attr.name,
      value: attr.value
    })),
    computedStyles: {
      display: getComputedStyle(element).display,
      position: getComputedStyle(element).position,
      width: getComputedStyle(element).width,
      height: getComputedStyle(element).height
    },
    boundingRect: element.getBoundingClientRect()
  };
}

ipcRenderer.on('start-inspector', () => {
  inspectorActive = true;
  highlightOverlay = createHighlightOverlay();
  document.body.style.cursor = 'crosshair';

  document.addEventListener('mouseover', handleMouseOver);
  document.addEventListener('click', handleClick, true);
});

function handleMouseOver(event: MouseEvent) {
  if (!inspectorActive || !highlightOverlay) return;

  const target = event.target as HTMLElement;
  const rect = target.getBoundingClientRect();

  highlightOverlay.style.top = `${rect.top}px`;
  highlightOverlay.style.left = `${rect.left}px`;
  highlightOverlay.style.width = `${rect.width}px`;
  highlightOverlay.style.height = `${rect.height}px`;
}

function handleClick(event: MouseEvent) {
  if (!inspectorActive) return;

  event.preventDefault();
  event.stopPropagation();

  const target = event.target as HTMLElement;
  const context = getElementContext(target);

  ipcRenderer.sendToHost('element-selected', context);

  // Cleanup
  inspectorActive = false;
  document.body.style.cursor = '';
  highlightOverlay?.remove();
  document.removeEventListener('mouseover', handleMouseOver);
  document.removeEventListener('click', handleClick, true);
}
```

### 5.7 Git Tree/Commit Explorer

**Git History Component:**

```typescript
// src/renderer/components/git/CommitHistory.tsx

import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';

interface Commit {
  hash: string;
  message: string;
  author: string;
  date: Date;
  parents: string[];
}

export function CommitHistory({ sessionId }: { sessionId: string }) {
  const { data: commits, isLoading } = useQuery({
    queryKey: ['commits', sessionId],
    queryFn: () => window.electronAPI.getCommitHistory(sessionId, { limit: 100 })
  });

  if (isLoading) return <div>Loading...</div>;

  return (
    <div className="h-full overflow-auto">
      <div className="relative pl-8">
        {/* Git graph line */}
        <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-zinc-700" />

        {commits?.map((commit: Commit, index: number) => (
          <div key={commit.hash} className="relative py-2">
            {/* Commit dot */}
            <div className="absolute left-3 top-4 w-3 h-3 rounded-full bg-blue-500 border-2 border-zinc-800" />

            <div className="bg-zinc-800 rounded p-3 ml-4">
              <div className="flex items-center gap-2">
                <code className="text-xs text-blue-400 font-mono">
                  {commit.hash.slice(0, 7)}
                </code>
                <span className="text-xs text-zinc-500">
                  {formatDistanceToNow(commit.date, { addSuffix: true })}
                </span>
              </div>
              <p className="text-sm mt-1 text-zinc-200">{commit.message}</p>
              <p className="text-xs text-zinc-500 mt-1">{commit.author}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Diff Viewer Component:**

```typescript
// src/renderer/components/git/DiffViewer.tsx

import { DiffEditor } from '@monaco-editor/react';

interface DiffViewerProps {
  original: string;
  modified: string;
  language: string;
  filename: string;
}

export function DiffViewer({ original, modified, language, filename }: DiffViewerProps) {
  return (
    <div className="h-full flex flex-col">
      <div className="p-2 bg-zinc-800 border-b border-zinc-700">
        <span className="text-sm text-zinc-400">{filename}</span>
      </div>
      <DiffEditor
        height="100%"
        original={original}
        modified={modified}
        language={language}
        theme="vs-dark"
        options={{
          readOnly: true,
          renderSideBySide: true,
          minimap: { enabled: false }
        }}
      />
    </div>
  );
}
```

---

## 6. Risk Assessment & Mitigation

### 6.1 High-Risk Areas

| Risk | Probability | Impact | Mitigation Strategy |
|------|-------------|--------|---------------------|
| **Native module compilation failures** (node-pty, dockerode) | HIGH | CRITICAL | Use `@electron/rebuild` in postinstall; pin versions; provide fallback terminal |
| **Docker socket permission issues** | MEDIUM | HIGH | Detect OS and provide setup instructions; use Docker context detection |
| **Claude Agent SDK breaking changes** | MEDIUM | HIGH | Pin version; implement adapter layer; comprehensive error handling |
| **Memory leaks from terminal/webview** | MEDIUM | MEDIUM | Implement proper cleanup; use React strict mode; monitor with DevTools |
| **GitHub OAuth token expiration** | HIGH | LOW | Implement refresh token flow; graceful re-auth prompts |
| **Port conflicts between sessions** | MEDIUM | MEDIUM | Dynamic port allocation; conflict detection; retry logic |
| **Git worktree corruption** | LOW | HIGH | Validate operations; provide recovery tools; backup strategies |
| **Large repository performance** | MEDIUM | MEDIUM | Lazy loading; virtual scrolling; background operations |

### 6.2 Technical Debt Risks

1. **Electron Security Model Evolution**
   - Electron's security model changes frequently
   - Plan for `contextIsolation` and `sandbox` enforcement
   - Regular security audits of preload scripts

2. **Monaco Editor Bundle Size**
   - Monaco adds ~8MB to bundle
   - Consider lazy loading or web workers
   - May need language feature reduction

3. **Docker API Stability**
   - Different Docker Desktop versions behave differently
   - Abstract Docker operations behind service layer
   - Comprehensive error handling for API calls

### 6.3 Mitigation Implementation

```typescript
// src/main/utils/error-boundary.ts

class ServiceErrorBoundary {
  static async wrap<T>(
    operation: () => Promise<T>,
    context: string,
    fallback?: T
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      logger.error(`[${context}] Operation failed:`, error);

      // Send error to renderer for user notification
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('service-error', {
          context,
          message: error.message,
          recoverable: fallback !== undefined
        });
      });

      if (fallback !== undefined) {
        return fallback;
      }
      throw error;
    }
  }
}

// Usage
const containers = await ServiceErrorBoundary.wrap(
  () => docker.listContainers(),
  'DockerService.listContainers',
  [] // Fallback to empty array
);
```

---

## 7. Implementation Phases

### Phase 1: Foundation (Week 1-2)

**Objectives:**
- Project scaffolding with Electron Forge
- Basic window management
- IPC communication infrastructure
- TypeScript configuration

**Deliverables:**
- [ ] Initialize Electron Forge project with webpack-typescript template
- [ ] Configure React 18 with TypeScript
- [ ] Set up Tailwind CSS and Radix UI
- [ ] Implement main/renderer IPC channel architecture
- [ ] Create basic window with dark theme
- [ ] Set up ESLint, Prettier, and pre-commit hooks

**Acceptance Criteria:**
- App launches with basic window
- Hot reload works for renderer
- TypeScript compiles without errors
- IPC communication verified with test messages

### Phase 2: Authentication & GitHub Integration (Week 2-3)

**Objectives:**
- GitHub OAuth with PKCE flow
- Repository selection UI
- Secure token storage

**Deliverables:**
- [ ] Implement PKCE OAuth flow
- [ ] Register custom protocol handler
- [ ] Create login screen component
- [ ] Build repository selector with search
- [ ] Implement secure token storage with electron-store
- [ ] Add token refresh mechanism

**Acceptance Criteria:**
- User can authenticate with GitHub
- Repository list displays correctly
- Tokens persist across app restarts
- Logout clears credentials properly

### Phase 3: Docker & Session Management (Week 3-4)

**Objectives:**
- Docker integration via dockerode
- Git worktree management
- Session lifecycle management

**Deliverables:**
- [ ] Implement DockerService with container management
- [ ] Create worktree creation/deletion logic
- [ ] Build docker-compose generator
- [ ] Implement port allocation system
- [ ] Create session list UI
- [ ] Build new session dialog
- [ ] Implement setup script editor

**Acceptance Criteria:**
- Can create new session with worktree
- Docker container starts with mounted volume
- Setup script executes on container start
- Multiple sessions can run simultaneously
- Sessions persist and restore

### Phase 4: Terminal Integration (Week 4-5)

**Objectives:**
- xterm.js integration
- node-pty backend
- Terminal tab management

**Deliverables:**
- [ ] Set up xterm.js with addons
- [ ] Implement node-pty spawning in main process
- [ ] Connect terminal to Docker container shell
- [ ] Add terminal resize handling
- [ ] Create terminal tabs component
- [ ] Implement copy/paste functionality

**Acceptance Criteria:**
- Terminal displays container shell
- Input/output works correctly
- Resize handled properly
- Multiple terminals per session

### Phase 5: Claude Agent SDK Integration (Week 5-7)

**Objectives:**
- Full Claude Agent SDK integration
- Tool call visualization
- Streaming response handling

**Deliverables:**
- [ ] Initialize Claude Agent with session context
- [ ] Implement streaming message handler
- [ ] Build chat interface components
- [ ] Create tool call visualization
- [ ] Add slash command menu
- [ ] Implement file attachment support
- [ ] Configure MCP server loading

**Acceptance Criteria:**
- Claude responds to messages
- Tool calls display with results
- Streaming works smoothly
- Slash commands functional
- MCP servers connect properly

### Phase 6: Browser Preview & DOM Inspection (Week 7-8)

**Objectives:**
- Embedded webview browser
- Element selection like Cursor
- Context injection to Claude

**Deliverables:**
- [ ] Set up webview component with preload
- [ ] Create URL bar and navigation controls
- [ ] Implement DOM inspector preload script
- [ ] Build element highlight overlay
- [ ] Create context extraction logic
- [ ] Add DevTools toggle

**Acceptance Criteria:**
- Webview loads localhost URLs
- Element hover highlights work
- Click sends element context to Claude
- DevTools accessible

### Phase 7: Git Explorer (Week 8-9)

**Objectives:**
- Visual commit history
- Diff viewing
- Branch management

**Deliverables:**
- [ ] Implement GitService with simple-git
- [ ] Build commit history component
- [ ] Create git graph visualization
- [ ] Add Monaco diff viewer
- [ ] Build branch selector
- [ ] Implement commit details view

**Acceptance Criteria:**
- Commit history displays correctly
- Graph shows branch relationships
- Diffs render properly
- Can switch branches

### Phase 8: Polish & Testing (Week 9-10)

**Objectives:**
- UI refinement
- Performance optimization
- Comprehensive testing

**Deliverables:**
- [ ] Implement keyboard shortcuts
- [ ] Add loading states and skeletons
- [ ] Create error boundary components
- [ ] Write unit tests for services
- [ ] Write integration tests for IPC
- [ ] Write E2E tests with Playwright
- [ ] Performance profiling and optimization

**Acceptance Criteria:**
- App feels responsive
- Errors handled gracefully
- Test coverage > 70%
- No memory leaks detected

### Phase 9: Packaging & Distribution (Week 10-11)

**Objectives:**
- Application signing
- Auto-update mechanism
- Distribution builds

**Deliverables:**
- [ ] Configure Electron Forge makers
- [ ] Set up code signing
- [ ] Implement auto-updater
- [ ] Create DMG for macOS
- [ ] Create installers for Windows/Linux
- [ ] Write installation documentation

**Acceptance Criteria:**
- App installs cleanly
- Updates work automatically
- Signed for all platforms

### Phase 10: Documentation & Launch (Week 11-12)

**Objectives:**
- User documentation
- Developer documentation
- Public release

**Deliverables:**
- [ ] Write user guide
- [ ] Create developer setup docs
- [ ] Record demo video
- [ ] Set up landing page
- [ ] Prepare release notes

---

## 8. Security Considerations

### 8.1 Electron Security Checklist

```typescript
// src/main/index.ts - Security configuration

const mainWindow = new BrowserWindow({
  webPreferences: {
    // Required security settings
    contextIsolation: true,          // Isolate renderer from Node.js
    nodeIntegration: false,          // Disable Node.js in renderer
    sandbox: true,                   // Enable sandbox mode
    preload: path.join(__dirname, 'preload.js'),

    // Content Security Policy
    webSecurity: true,               // Enable same-origin policy
    allowRunningInsecureContent: false,

    // Webview security
    webviewTag: true,                // Enable webview (needed for browser)
  }
});

// Set Content Security Policy
session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
  callback({
    responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "connect-src 'self' https://api.anthropic.com https://api.github.com",
        "img-src 'self' data: https:",
      ].join('; ')
    }
  });
});
```

### 8.2 Credential Storage

```typescript
// src/main/services/secure-storage.ts

import Store from 'electron-store';
import { safeStorage } from 'electron';

class SecureStorage {
  private store: Store;

  constructor() {
    this.store = new Store({
      name: 'claudette-secure',
      encryptionKey: 'claudette-v1'  // Additional layer
    });
  }

  async setToken(key: string, value: string): Promise<void> {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(value);
      this.store.set(key, encrypted.toString('base64'));
    } else {
      // Fallback - warn user about reduced security
      this.store.set(key, value);
    }
  }

  async getToken(key: string): Promise<string | null> {
    const value = this.store.get(key) as string;
    if (!value) return null;

    if (safeStorage.isEncryptionAvailable()) {
      const decrypted = safeStorage.decryptString(
        Buffer.from(value, 'base64')
      );
      return decrypted;
    }
    return value;
  }
}
```

### 8.3 Docker Security

```typescript
// src/main/services/docker.service.ts - Security constraints

const containerConfig = {
  // Resource limits
  HostConfig: {
    Memory: 4 * 1024 * 1024 * 1024,  // 4GB max
    CpuQuota: 200000,                 // 2 CPU cores max
    PidsLimit: 500,                   // Process limit

    // Network isolation
    NetworkMode: 'claudette',         // Custom network

    // Security options
    SecurityOpt: ['no-new-privileges'],
    CapDrop: ['ALL'],                 // Drop all capabilities
    CapAdd: ['CHOWN', 'SETUID', 'SETGID'],  // Add only needed

    // Read-only root filesystem with specific writable paths
    ReadonlyRootfs: false,            // Needed for npm install etc.

    // Mount options
    Binds: [
      `${worktreePath}:/workspace:delegated,Z`,
      `${mcpPath}:/home/claude/.mcp:ro,Z`
    ]
  }
};
```

---

## 9. Testing Strategy

### 9.1 Unit Tests

```typescript
// test/unit/services/docker.service.test.ts

import { describe, it, expect, vi } from 'vitest';
import { DockerService } from '../../../src/main/services/docker.service';

describe('DockerService', () => {
  describe('allocatePorts', () => {
    it('should allocate non-conflicting ports for sessions', () => {
      const ports1 = DockerService.allocatePorts(0);
      const ports2 = DockerService.allocatePorts(1);

      expect(ports1.web).toBe(10000);
      expect(ports2.web).toBe(10010);
      expect(ports1.web).not.toBe(ports2.web);
    });
  });

  describe('generateCompose', () => {
    it('should generate valid docker-compose configuration', () => {
      const config = DockerService.generateCompose({
        sessionId: 'test-123',
        worktreePath: '/path/to/worktree',
        ports: { web: 10000, api: 10001, debug: 10002 }
      });

      expect(config.version).toBe('3.8');
      expect(config.services['claude-session']).toBeDefined();
      expect(config.services['claude-session'].ports).toContain('10000:3000');
    });
  });
});
```

### 9.2 Integration Tests

```typescript
// test/integration/ipc/claude.ipc.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startElectron, stopElectron } from '../helpers/electron';

describe('Claude IPC Integration', () => {
  let app;

  beforeAll(async () => {
    app = await startElectron();
  });

  afterAll(async () => {
    await stopElectron(app);
  });

  it('should stream messages from Claude', async () => {
    const messages: string[] = [];

    app.on('claude-stream', (chunk) => {
      messages.push(chunk);
    });

    await app.invoke('claude:send-message', {
      sessionId: 'test',
      message: 'Hello Claude'
    });

    // Wait for stream to complete
    await new Promise(resolve => setTimeout(resolve, 5000));

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.join('')).toContain('Hello');
  });
});
```

### 9.3 E2E Tests

```typescript
// test/e2e/session-workflow.test.ts

import { test, expect } from '@playwright/test';
import { ElectronApplication, _electron as electron } from 'playwright';

test.describe('Session Workflow', () => {
  let app: ElectronApplication;

  test.beforeAll(async () => {
    app = await electron.launch({
      args: ['.'],
      env: { NODE_ENV: 'test' }
    });
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('should create new session from repository', async () => {
    const window = await app.firstWindow();

    // Navigate to new session
    await window.click('[data-testid="new-session-button"]');

    // Select repository
    await window.fill('[data-testid="repo-search"]', 'my-project');
    await window.click('[data-testid="repo-item-my-project"]');

    // Create session
    await window.click('[data-testid="create-session-button"]');

    // Verify session created
    await expect(window.locator('[data-testid="session-status"]'))
      .toContainText('Running');
  });
});
```

---

## 10. Deployment & Distribution

### 10.1 Electron Forge Configuration

```typescript
// forge.config.ts

import type { ForgeConfig } from '@electron-forge/shared-types';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Claudette',
    executableName: 'claudette',
    icon: './resources/icons/icon',
    appBundleId: 'com.parcha.claudette',
    osxSign: {
      identity: 'Developer ID Application: Your Name (TEAM_ID)',
      optionsForFile: () => ({
        entitlements: './entitlements.plist'
      })
    },
    osxNotarize: {
      appleId: process.env.APPLE_ID!,
      appleIdPassword: process.env.APPLE_PASSWORD!,
      teamId: process.env.APPLE_TEAM_ID!
    }
  },
  makers: [
    {
      name: '@electron-forge/maker-dmg',
      config: {
        background: './resources/dmg-background.png',
        icon: './resources/icons/icon.icns',
        format: 'ULFO'
      }
    },
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        certificateFile: './cert.pfx',
        certificatePassword: process.env.CERTIFICATE_PASSWORD
      }
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          maintainer: 'Parcha',
          homepage: 'https://parcha.com'
        }
      }
    }
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {}
    },
    {
      name: '@electron-forge/plugin-webpack',
      config: {
        mainConfig: './webpack.main.config.ts',
        renderer: {
          config: './webpack.renderer.config.ts',
          entryPoints: [
            {
              html: './src/renderer/index.html',
              js: './src/renderer/index.tsx',
              name: 'main_window',
              preload: {
                js: './src/main/preload.ts'
              }
            }
          ]
        }
      }
    }
  ]
};

export default config;
```

### 10.2 Auto-Update Configuration

```typescript
// src/main/updater.ts

import { autoUpdater } from 'electron-updater';
import { BrowserWindow } from 'electron';

export function initAutoUpdater(mainWindow: BrowserWindow) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    mainWindow.webContents.send('update-available', info);
  });

  autoUpdater.on('download-progress', (progress) => {
    mainWindow.webContents.send('update-progress', progress);
  });

  autoUpdater.on('update-downloaded', () => {
    mainWindow.webContents.send('update-ready');
  });

  // Check for updates on startup
  autoUpdater.checkForUpdates();

  // Check periodically (every 4 hours)
  setInterval(() => {
    autoUpdater.checkForUpdates();
  }, 4 * 60 * 60 * 1000);
}
```

---

## Appendix A: Key Reference Links

### Official Documentation
- [Claude Agent SDK TypeScript](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript)
- [Electron Forge](https://www.electronforge.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [xterm.js](https://xtermjs.org/)
- [@monaco-editor/react](https://github.com/suren-atoyan/monaco-react)

### npm Packages
- [@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
- [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
- [dockerode](https://www.npmjs.com/package/dockerode)
- [simple-git](https://www.npmjs.com/package/simple-git)

### Related Projects
- [DevTree](https://github.com/pwrmind/DevTree) - Git worktree + Dev Containers
- [Sprout](https://github.com/SecDev-Lab/sprout) - Git worktree + Docker Compose CLI
- [Hyper Terminal](https://hyper.is/) - Electron + xterm.js reference

---

## Appendix B: Environment Variables

```bash
# .env.example

# Anthropic API
ANTHROPIC_API_KEY=sk-ant-xxxxx

# GitHub OAuth
GITHUB_CLIENT_ID=xxxxx
GITHUB_CLIENT_SECRET=xxxxx

# Apple Code Signing (for distribution)
APPLE_ID=your@email.com
APPLE_PASSWORD=xxxx-xxxx-xxxx-xxxx
APPLE_TEAM_ID=XXXXXXXXXX

# Windows Code Signing
CERTIFICATE_PASSWORD=xxxxx
```

---

## Appendix C: Default Dockerfile

```dockerfile
# resources/templates/Dockerfile.claudette

FROM node:20-slim

# Install essential tools
RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    vim \
    nano \
    htop \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -ms /bin/bash claude
USER claude
WORKDIR /workspace

# Set up nice prompt
ENV PS1='\[\033[01;32m\]claudette\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ '

# Default command - keep container running
CMD ["sleep", "infinity"]
```

---

*Document prepared by Q Branch. All strategic recommendations subject to field conditions. Remember: proper planning prevents poor performance. Do try not to get killed, 007... er, M.*

**Classification:** TOP SECRET
**Distribution:** M, Q Branch Archives
**Document Location:** `/Users/aj/dev/parcha/claudette/.notes/q-planning-claudette-2025-12-05.md`
