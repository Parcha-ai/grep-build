// Core Types for Claudette

export interface Session {
  id: string;
  name: string;
  repoPath: string;
  worktreePath: string;
  branch: string;
  containerId?: string;
  status: SessionStatus;
  ports: PortAllocation;
  createdAt: Date;
  updatedAt: Date;
  setupScript: string;
  isDevMode?: boolean; // True for local dev sessions (no Docker)
}

export type SessionStatus = 'creating' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

export interface PortAllocation {
  web: number;
  api: number;
  debug: number;
}

export interface GitHubUser {
  id: number;
  login: string;
  name: string;
  email: string;
  avatarUrl: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  description: string;
  private: boolean;
  cloneUrl: string;
  sshUrl: string;
  defaultBranch: string;
  updatedAt: string;
}

export interface Commit {
  hash: string;
  message: string;
  author: string;
  authorEmail: string;
  date: Date;
  parents: string[];
}

export interface Branch {
  name: string;
  current: boolean;
  remote?: string;
  commit: string;
}

export interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'error';
  result?: unknown;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: ToolCall[];
  attachments?: Attachment[];
  timestamp: Date;
}

export interface Attachment {
  type: 'file' | 'image' | 'dom_element';
  name: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface DOMElementContext {
  tagName: string;
  id?: string;
  className?: string;
  selector: string;
  innerHTML: string;
  outerHTML: string;
  textContent?: string;
  attributes: { name: string; value: string }[];
  computedStyles: Record<string, string>;
  boundingRect: DOMRect;
}

export interface ContainerStats {
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  networkRx: number;
  networkTx: number;
}

export interface AppSettings {
  theme: 'dark' | 'light' | 'system';
  fontSize: number;
  fontFamily: string;
  anthropicApiKey?: string;
  githubToken?: string;
  defaultSetupScript: string;
  autoStartContainer: boolean;
}
