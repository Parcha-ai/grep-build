import { EventEmitter } from 'events';
import Store from 'electron-store';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import { app } from 'electron';
import { DockerService } from './docker.service';
import { GitService } from './git.service';
import type { Session, SessionStatus } from '../../shared/types';

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

  constructor() {
    super();
    this.store = new Store({ name: 'grep-sessions' });
    this.dockerService = new DockerService();
    this.gitService = new GitService();
    this.sessionsPath = path.join(app.getPath('userData'), 'sessions');
  }

  private async ensureSessionsDirectory(): Promise<void> {
    await fs.mkdir(this.sessionsPath, { recursive: true });
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

    this.updateSessionStatus(session, 'starting');

    try {
      const containerId = await this.dockerService.startContainer(session);
      session.containerId = containerId;
      this.updateSessionStatus(session, 'running');
    } catch (error) {
      this.updateSessionStatus(session, 'error');
      throw error;
    }
  }

  async stopSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    this.updateSessionStatus(session, 'stopping');

    try {
      if (session.containerId) {
        await this.dockerService.stopContainer(session.containerId);
      }
      this.updateSessionStatus(session, 'stopped');
    } catch (error) {
      this.updateSessionStatus(session, 'error');
      throw error;
    }
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
    const session = this.store.get(`sessions.${sessionId}`) as Session | undefined;
    return session || null;
  }

  listSessions(): Session[] {
    return this.getSessions();
  }

  private getSessions(): Session[] {
    const sessions = this.store.get('sessions') as Record<string, Session> | undefined;
    if (!sessions) return [];
    return Object.values(sessions);
  }

  async updateSession(sessionId: string, updates: Partial<Session>): Promise<Session> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

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
