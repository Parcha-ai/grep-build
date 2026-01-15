// Core Types for Grep

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
  isTeleported?: boolean; // True for sessions imported from claude.ai/code
  lastBrowserUrl?: string; // Last URL visited in browser preview
  model?: string; // Selected Claude model for this session
}

export type SessionStatus = 'creating' | 'starting' | 'setup' | 'running' | 'stopping' | 'stopped' | 'error';

// Setup progress event for worktree initialization
export interface SetupProgressEvent {
  sessionId: string;
  status: 'running' | 'completed' | 'error';
  message?: string;
  output?: string;
  error?: string;
}

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

// Content block for interleaved rendering of text and tool calls
export interface ContentBlock {
  type: 'text' | 'tool_use';
  text?: string; // For text blocks
  toolCallId?: string; // For tool_use blocks - reference to toolCalls array
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string; // Combined text content (for backwards compat and search)
  contentBlocks?: ContentBlock[]; // Ordered blocks for interleaved rendering
  toolCalls?: ToolCall[];
  attachments?: Attachment[];
  timestamp: Date;
  interrupted?: boolean; // True if message was interrupted before completion
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

// Permission request from Agent SDK
export interface PermissionRequest {
  sessionId: string;
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  message?: string;
}

// Permission response to Agent SDK
export interface PermissionResponse {
  requestId: string;
  approved: boolean;
  modifiedInput?: Record<string, unknown>;
}

// Question types for AskUserQuestion tool
export interface QuestionOption {
  label: string;
  description: string;
}

export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

export interface QuestionRequest {
  sessionId: string;
  requestId: string;
  questions: Question[];
}

export interface QuestionResponse {
  requestId: string;
  answers: Record<string, string>;
}

// Extension types (commands, skills, agents)
export interface Command {
  name: string;
  path: string;
  content: string;
  description?: string;
  scope: 'user' | 'project';
}

export interface Skill {
  name: string;
  path: string;
  description?: string;
  scope: 'user' | 'project';
}

export interface AgentDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  disallowedTools?: string[];
  model?: string;
  scope: 'user' | 'project';
}

// Browser snapshot types
export interface BrowserSnapshot {
  url: string;
  screenshot: string;
  html: string;
  timestamp: Date;
}

// Smart Compact types - context compaction with automatic model switching
export interface CompactionStatus {
  sessionId: string;
  isCompacting: boolean;
  smartCompact?: {
    enabled: boolean;
    originalModel: string;
    compactingModel: string;
    reason: string; // e.g., "Model does not support extended context"
  };
  preTokens?: number;
  trigger?: 'manual' | 'auto';
}

export interface CompactionComplete {
  sessionId: string;
  preTokens: number;
  postTokens?: number;
  smartCompact?: {
    modelSwitched: boolean;
    restoredModel: string;
  };
}

// Export audio types
export * from './audio';
