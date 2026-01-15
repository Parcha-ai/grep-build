import { EventEmitter } from 'events';
import Store from 'electron-store';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import { app } from 'electron';
import simpleGit from 'simple-git';
import { DockerService } from './docker.service';
import { GitService } from './git.service';
import type { Session, SessionStatus } from '../../shared/types';
import Anthropic from '@anthropic-ai/sdk';

interface SessionCreateConfig {
  name: string;
  repoUrl: string;
  branch: string;
  setupScript?: string;
}

const DEFAULT_SETUP_SCRIPT = `#!/bin/bash
# Grep Session Setup Script
# This script runs when the Docker container starts

# Install dependencies
if [ -f "package.json" ]; then
  npm install
elif [ -f "requirements.txt" ]; then
  pip install -r requirements.txt
fi

# Custom environment variables
export NODE_ENV=development

# Add your custom setup commands below:
`;

export class SessionService extends EventEmitter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private store: any;
  private dockerService: DockerService;
  private gitService: GitService;
  private sessionsPath: string;
  private discoveredSessionsCache: Map<string, Session> = new Map();
  private lastDiscoveryTime: number = 0;
  private readonly DISCOVERY_CACHE_TTL = 60000; // 1 minute cache

  constructor() {
    super();
    this.store = new Store({ name: 'claudette-sessions' });
    this.dockerService = new DockerService();
    this.gitService = new GitService();
    this.sessionsPath = path.join(app.getPath('userData'), 'sessions');
  }

  private async ensureSessionsDirectory(): Promise<void> {
    await fs.mkdir(this.sessionsPath, { recursive: true });
  }

  private generateSessionNameAsync(sessionId: string, firstUserMessage: string, actualPath: string): void {
    // Run name generation in background without blocking discovery
    (async () => {
      try {
        // Get API key from settings store
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const settingsStore = new Store({ name: 'claudette-settings' }) as any;
        const apiKey = settingsStore.get('anthropicApiKey') as string | undefined;

        if (!apiKey) {
          console.log('[Session] No API key, skipping name generation for:', sessionId);
          return;
        }

        const anthropic = new Anthropic({ apiKey });

        console.log('[Session] Generating name for:', path.basename(actualPath));

        const response = await anthropic.messages.create({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 50,
          messages: [{
            role: 'user',
            content: `Generate a concise 3-5 word descriptive title for this coding session. First message: "${firstUserMessage.slice(0, 200)}"

Only return the title, nothing else.`
          }]
        });

        const title = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
        if (title) {
          this.store.set(`sessionNames.${sessionId}`, title);
          console.log('[Session] Generated name:', path.basename(actualPath), '→', title);

          // Emit event so UI can refresh
          this.emit('sessionNameGenerated', { sessionId, name: title });
        }
      } catch (error) {
        console.error('[Session] Error generating name:', error);
      }
    })();
  }

  private updateSessionStatus(session: Session, status: SessionStatus): Session {
    session.status = status;
    session.updatedAt = new Date();
    this.store.set(`sessions.${session.id}`, session);
    this.emit('statusChanged', session);
    return session;
  }

  async createSession(config: SessionCreateConfig): Promise<Session> {
    await this.ensureSessionsDirectory();

    const sessionId = uuid();
    const sessions = this.getSessions();
    const sessionIndex = sessions.length;
    const ports = this.dockerService.allocatePorts(sessionIndex);

    // Clone repo to sessions directory
    const repoName = config.repoUrl.split('/').pop()?.replace('.git', '') || sessionId;
    const repoPath = path.join(this.sessionsPath, sessionId, repoName);
    const worktreePath = path.join(this.sessionsPath, sessionId, 'worktrees', config.branch);

    const session: Session = {
      id: sessionId,
      name: config.name,
      repoPath,
      worktreePath,
      branch: config.branch,
      status: 'creating',
      ports,
      createdAt: new Date(),
      updatedAt: new Date(),
      setupScript: config.setupScript || DEFAULT_SETUP_SCRIPT,
    };

    // Save session
    this.store.set(`sessions.${sessionId}`, session);
    this.emit('statusChanged', session);

    try {
      // Clone the repository
      await fs.mkdir(path.dirname(repoPath), { recursive: true });
      await this.gitService.clone(config.repoUrl, repoPath);

      // Create worktree for the branch
      await fs.mkdir(path.dirname(worktreePath), { recursive: true });
      await this.gitService.createWorktree(repoPath, worktreePath, config.branch);

      // Create .grep directory with setup script
      const grepDir = path.join(worktreePath, '.grep');
      await fs.mkdir(grepDir, { recursive: true });
      await fs.writeFile(
        path.join(grepDir, 'setup.sh'),
        session.setupScript,
        { mode: 0o755 }
      );

      this.updateSessionStatus(session, 'stopped');
      return session;
    } catch (error) {
      this.updateSessionStatus(session, 'error');
      throw error;
    }
  }

  async startSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    // Simply activate the session - no Docker needed
    this.updateSessionStatus(session, 'running');
  }

  async stopSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    // Simply deactivate the session
    this.updateSessionStatus(session, 'stopped');
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    // Stop and remove container
    if (session.containerId) {
      await this.dockerService.stopContainer(session.containerId);
      await this.dockerService.removeContainer(session.containerId);
    }

    // Release ports
    this.dockerService.releasePorts(session.ports);

    // Remove session directory
    const sessionDir = path.join(this.sessionsPath, sessionId);
    await fs.rm(sessionDir, { recursive: true, force: true });

    // Remove from store
    this.store.delete(`sessions.${sessionId}`);
  }

  async getSession(sessionId: string): Promise<Session | null> {
    // Check store first (for manually created sessions)
    const storedSession = this.store.get(`sessions.${sessionId}`) as Session | undefined;
    if (storedSession) return storedSession;

    // Check discovered sessions cache
    if (this.discoveredSessionsCache.has(sessionId)) {
      return this.discoveredSessionsCache.get(sessionId)!;
    }

    // If cache is stale, refresh discovery and check again
    const now = Date.now();
    if (now - this.lastDiscoveryTime > this.DISCOVERY_CACHE_TTL) {
      await this.listSessions(); // This will refresh the cache
      return this.discoveredSessionsCache.get(sessionId) || null;
    }

    return null;
  }

  async listSessions(): Promise<Session[]> {
    // Discover sessions from ~/.claude/projects/ directory
    const claudeSessions = await this.discoverClaudeSessions();

    // Update cache with discovered sessions
    this.discoveredSessionsCache.clear();
    claudeSessions.forEach(s => this.discoveredSessionsCache.set(s.id, s));
    this.lastDiscoveryTime = Date.now();

    // Merge with any sessions in our store (shouldn't be many since we discover from Claude)
    const storedSessions = this.getSessions();

    // Deduplicate by SESSION ID (not path - multiple sessions per path is valid!)
    const sessionMap = new Map<string, Session>();

    storedSessions.forEach(s => sessionMap.set(s.id, s));
    // Merge discovered sessions with stored ones, preserving user settings like model selection
    claudeSessions.forEach(s => {
      const existing = sessionMap.get(s.id);
      if (existing) {
        // Merge: discovered session data + preserved user settings from stored session
        sessionMap.set(s.id, {
          ...s,
          // Preserve user-set properties from stored session
          model: existing.model,
          lastBrowserUrl: existing.lastBrowserUrl,
        });
      } else {
        sessionMap.set(s.id, s);
      }
    });

    // Sort by createdAt (newest first) for stable ordering
    const allSessions = Array.from(sessionMap.values());
    allSessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return allSessions;
  }

  private getSessions(): Session[] {
    const sessions = this.store.get('sessions') as Record<string, Session> | undefined;
    if (!sessions) return [];
    // Filter out stub objects that only have sdkSessionId (from old code paths)
    return Object.values(sessions).filter(s => s.name && s.repoPath);
  }

  private async discoverClaudeSessions(): Promise<Session[]> {
    const sessions: Session[] = [];
    const homeDir = require('os').homedir();
    const claudeProjectsDir = path.join(homeDir, '.claude', 'projects');

    console.log('[Session Discovery] Scanning:', claudeProjectsDir);

    try {
      const entries = await fs.readdir(claudeProjectsDir, { withFileTypes: true });
      console.log('[Session Discovery] Found', entries.length, 'entries');

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

        const projectDir = path.join(claudeProjectsDir, entry.name);
        console.log('[Session Discovery] Scanning project directory:', entry.name);

        // Find a valid project path from ANY transcript in this directory
        // This handles cases where some transcripts have stale Docker paths
        let validProjectPath: string | null = null;
        try {
          // Find .jsonl files (skip agent files and summary files)
          const files = await fs.readdir(projectDir);
          const jsonlFiles = files.filter(f =>
            f.endsWith('.jsonl') &&
            !f.startsWith('agent-') &&
            f.length > 20  // Skip short summary files
          );

          // First pass: find ANY valid cwd from the transcripts
          for (const jsonlFile of jsonlFiles) {
            try {
              const transcriptPath = path.join(projectDir, jsonlFile);
              const content = await fs.readFile(transcriptPath, 'utf-8');
              const lines = content.split('\n').filter(l => l.trim());

              for (const line of lines.slice(0, 50)) {
                try {
                  const parsed = JSON.parse(line);
                  if (parsed.cwd) {
                    try {
                      await fs.access(parsed.cwd);
                      validProjectPath = parsed.cwd;
                      console.log('[Session Discovery] Found valid path:', validProjectPath);
                      break;
                    } catch {
                      // Path doesn't exist, try next
                    }
                  }
                } catch {
                  // Not valid JSON, skip
                }
              }
              if (validProjectPath) break;
            } catch {
              // Error reading transcript, try next
            }
          }

          // Second pass: create sessions for each transcript using the valid path
          for (const jsonlFile of jsonlFiles) {
            try {
              const transcriptPath = path.join(projectDir, jsonlFile);
              const stats = await fs.stat(transcriptPath);
              const content = await fs.readFile(transcriptPath, 'utf-8');
              const lines = content.split('\n').filter(l => l.trim());

              // Parse lines to find cwd, sessionId, and first user message
              let sessionCwd: string | null = null;
              let transcriptSessionId: string | null = null;
              let firstUserMessage: string | null = null;

              for (const line of lines.slice(0, 50)) {
                try {
                  const parsed = JSON.parse(line);
                  if (parsed.cwd) sessionCwd = parsed.cwd;
                  if (parsed.sessionId) transcriptSessionId = parsed.sessionId;

                  // Extract first user message for name generation
                  if (!firstUserMessage && parsed.type === 'user') {
                    const content = parsed.message?.content || parsed.content;
                    if (typeof content === 'string') {
                      firstUserMessage = content;
                    } else if (Array.isArray(content)) {
                      const textBlock = content.find((b: any) => b.type === 'text');
                      if (textBlock?.text) {
                        firstUserMessage = textBlock.text;
                      }
                    }
                  }

                  if (sessionCwd && transcriptSessionId && firstUserMessage) break;
                } catch {
                  // Not valid JSON, skip
                }
              }

              // Skip empty transcripts (0 bytes or no lines)
              if (stats.size === 0 || lines.length === 0) {
                console.log('[Session Discovery] Skipping empty transcript:', jsonlFile);
                continue;
              }

              // Use the cached valid path if the transcript's cwd doesn't exist
              let actualPath: string;
              try {
                await fs.access(sessionCwd!); // Non-null assertion: sessionCwd checked above
                actualPath = sessionCwd!;
              } catch {
                // Path doesn't exist - use the cached valid path from first pass
                if (validProjectPath) {
                  actualPath = validProjectPath;
                  console.log('[Session Discovery] Using cached path for', jsonlFile, ':', actualPath);
                } else {
                  // No valid path found in any transcript - skip
                  console.log('[Session Discovery] No valid path found for project:', entry.name);
                  continue;
                }
              }

              // At this point actualPath is guaranteed to be a valid string

              // Get git branch
              let branch = 'main';
              try {
                const git = simpleGit(actualPath);
                const status = await git.status();
                branch = status.current || 'main';
              } catch {
                // Not a git repo or can't get branch
              }

              // Use transcript session ID if available, otherwise hash the transcript file name
              const sessionId = transcriptSessionId || jsonlFile.replace('.jsonl', '');

              // Check if there's a custom name set by Claude (via UpdateSessionName tool)
              const customName = this.store.get(`sessionNames.${sessionId}`) as string | undefined;
              const displayName = customName || `${path.basename(actualPath)} - ${new Date(stats.mtime).toLocaleDateString()}`;

              // Queue background name generation for sessions without custom names
              if (!customName && firstUserMessage) {
                // Generate name asynchronously without blocking discovery
                this.generateSessionNameAsync(sessionId, firstUserMessage, actualPath);
              }

              // Create session from transcript (ephemeral - not stored)
              const session: Session = {
                id: sessionId,
                name: displayName,
                repoPath: actualPath,
                worktreePath: actualPath,
                branch,
                status: 'running',
                ports: { web: 3000, api: 8080, debug: 9229 },
                setupScript: DEFAULT_SETUP_SCRIPT,
                isDevMode: true,
                createdAt: stats.birthtime,
                updatedAt: stats.mtime,  // Use file modification time for sorting
              };

              // Store ONLY the sdkSessionId mapping in a separate object
              // Don't store the full session - discovered sessions are ephemeral
              this.store.set(`sdkSessionMappings.${sessionId}`, sessionId);
              sessions.push(session);
            } catch (fileError) {
              // Error reading this transcript file, skip it
              console.log('[Session Discovery] Error reading transcript:', jsonlFile, fileError);
            }
          }
        } catch (dirError) {
          console.log('[Session Discovery] Error reading project directory:', entry.name, dirError);
        }
      }

      console.log('[Session Discovery] Total discovered:', sessions.length, 'sessions');
    } catch (error) {
      console.error('[Session Discovery] Failed to scan projects directory:', error);
    }

    return sessions;
  }

  async updateSession(sessionId: string, updates: Partial<Session>): Promise<Session> {
    const session = await this.getSession(sessionId);
    if (!session) {
      // Silently ignore updates for ephemeral (discovered) sessions
      // These are read-only and recreated on each discovery
      console.log('[Session] Ignoring update for ephemeral session:', sessionId);
      // Return a minimal session object to satisfy the caller
      return {
        id: sessionId,
        name: 'Ephemeral Session',
        repoPath: '',
        worktreePath: '',
        branch: 'main',
        status: 'running',
        ports: { web: 3000, api: 8080, debug: 9229 },
        setupScript: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    const updatedSession = {
      ...session,
      ...updates,
      id: session.id, // Prevent ID changes
      updatedAt: new Date(),
    };

    // If setup script changed, update the file
    if (updates.setupScript) {
      const setupPath = path.join(session.worktreePath, '.grep', 'setup.sh');
      await fs.writeFile(setupPath, updates.setupScript, { mode: 0o755 });
    }

    this.store.set(`sessions.${sessionId}`, updatedSession);
    return updatedSession;
  }
}
