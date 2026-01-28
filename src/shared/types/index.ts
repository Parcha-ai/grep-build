// Core Types for Grep

// SSH configuration for remote execution
export interface SSHConfig {
  host: string;
  port: number;           // Default: 22
  username: string;
  privateKeyPath: string; // Path to local private key
  remoteWorkdir: string;  // Working directory on remote machine
  passphrase?: string;    // Encrypted passphrase for private key
  worktreeScript?: string; // Optional script to run on remote to set up worktree
  syncSettings?: boolean;  // If true, sync ~/.claude settings to remote before starting
}

// Saved SSH config (persisted to electron-store, no passphrase)
export interface SavedSSHConfig {
  host: string;
  port: string;
  username: string;
  privateKeyPath: string;
  remoteWorkdir: string;
  sessionName: string;
  worktreeScript: string;
  syncSettings: boolean;
}

export interface Session {
  id: string;
  name: string;
  repoPath: string;
  worktreePath: string;
  branch: string;
  containerId?: string;
  sshConfig?: SSHConfig;  // Present if this is an SSH remote session
  status: SessionStatus;
  ports: PortAllocation;
  createdAt: Date;
  updatedAt: Date;
  setupScript: string;
  isDevMode?: boolean; // True for local dev sessions (no Docker)
  isTeleported?: boolean; // True for sessions imported from claude.ai/code
  lastBrowserUrl?: string; // Last URL visited in browser preview
  model?: string; // Selected Claude model for this session
  worktreeInstructions?: string; // Setup instructions to send to Claude when session starts
  worktreeInstructionsSent?: boolean; // Track if instructions have been sent
  errorMessage?: string; // Error message when status is 'error'
  setupOutput?: string; // Output from worktree setup script (for SSH sessions)
  // Fork/worktree relationship
  isWorktree?: boolean; // True if this is a worktree fork of another repo
  parentRepoPath?: string; // Path to the parent repo this was forked from
  forkName?: string; // Silly memorable name for this fork (e.g., "fuzzy-tiger")
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
  alwaysApprove?: boolean; // If true, save permission pattern to project settings
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
  content: string;
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

// Plan approval types - for ExitPlanMode tool
export interface PlanApprovalRequest {
  sessionId: string;
  requestId: string;
  planContent: string;
  planFilePath?: string;
  allowedPrompts?: Array<{ tool: string; prompt: string }>;
}

export interface PlanApprovalResponse {
  requestId: string;
  approved: boolean;
}

// Export audio types
export * from './audio';
