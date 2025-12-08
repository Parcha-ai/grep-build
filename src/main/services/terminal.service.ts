import * as pty from 'node-pty';
import { v4 as uuid } from 'uuid';
import Store from 'electron-store';
import { DockerService } from './docker.service';
import type { Session } from '../../shared/types';

interface Terminal {
  id: string;
  sessionId: string;
  ptyProcess: pty.IPty;
  outputListeners: Set<(data: string) => void>;
}

export class TerminalService {
  private terminals: Map<string, Terminal> = new Map();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private store: any;
  private dockerService: DockerService;

  constructor() {
    this.store = new Store({ name: 'grep-sessions' });
    this.dockerService = new DockerService();
  }

  private getSession(sessionId: string) {
    return this.store.get(`sessions.${sessionId}`) as { containerId?: string; worktreePath: string } | undefined;
  }

  async createTerminal(sessionId: string): Promise<string> {
    const session = this.getSession(sessionId);
    console.log('Creating terminal for session:', sessionId);
    console.log('Session data:', JSON.stringify(session, null, 2));

    if (!session) throw new Error(`Session ${sessionId} not found`);

    const terminalId = uuid();

    let ptyProcess: pty.IPty;

    if (session.containerId) {
      // Attach to Docker container
      ptyProcess = pty.spawn('docker', ['exec', '-it', session.containerId, '/bin/bash'], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: process.env.HOME || '/',
        env: process.env as { [key: string]: string },
      });
    } else {
      // Local terminal in worktree
      const shell = process.platform === 'win32'
        ? 'powershell.exe'
        : process.env.SHELL || '/bin/zsh'; // Use user's shell or fallback to zsh on macOS

      console.log('Spawning shell:', shell);
      console.log('Working directory:', session.worktreePath);
      console.log('Platform:', process.platform);

      try {
        ptyProcess = pty.spawn(shell, [], {
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          cwd: session.worktreePath,
          env: {
            ...process.env as { [key: string]: string },
            TERM: 'xterm-256color',
          },
        });
      } catch (err) {
        console.error('PTY spawn error:', err);
        throw err;
      }
    }

    const terminal: Terminal = {
      id: terminalId,
      sessionId,
      ptyProcess,
      outputListeners: new Set(),
    };

    // Handle output
    ptyProcess.onData((data) => {
      terminal.outputListeners.forEach(listener => listener(data));
    });

    // Handle exit
    ptyProcess.onExit(({ exitCode }) => {
      console.log(`Terminal ${terminalId} exited with code ${exitCode}`);
      this.terminals.delete(terminalId);
    });

    this.terminals.set(terminalId, terminal);
    return terminalId;
  }

  write(terminalId: string, data: string): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) throw new Error(`Terminal ${terminalId} not found`);
    terminal.ptyProcess.write(data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return;
    terminal.ptyProcess.resize(cols, rows);
  }

  onOutput(terminalId: string, callback: (data: string) => void): () => void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) throw new Error(`Terminal ${terminalId} not found`);

    terminal.outputListeners.add(callback);

    return () => {
      terminal.outputListeners.delete(callback);
    };
  }

  closeTerminal(terminalId: string): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return;

    terminal.ptyProcess.kill();
    this.terminals.delete(terminalId);
  }

  closeAllTerminalsForSession(sessionId: string): void {
    for (const [terminalId, terminal] of this.terminals) {
      if (terminal.sessionId === sessionId) {
        this.closeTerminal(terminalId);
      }
    }
  }
}
