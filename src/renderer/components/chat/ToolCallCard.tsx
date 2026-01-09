import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Terminal, FileText, Search, FolderOpen, Play, Edit2, Globe, Code, HelpCircle, ListTodo, Loader2, ChevronRight, ChevronDown, CheckCircle2, Circle, Clock, ExternalLink, Copy } from 'lucide-react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import type { ToolCall } from '../../../shared/types';
import { useEditorStore } from '../../stores/editor.store';

interface ToolCallCardProps {
  toolCall: ToolCall;
  isLatest?: boolean; // If true, expand by default
  isLatestToolCall?: boolean; // Alias for isLatest
  isStreaming?: boolean; // If currently streaming
}

interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

// Map tool names to icons and labels
const TOOL_CONFIG: Record<string, {
  icon: React.ElementType;
  label: string;
  color: string;
  bgGradient?: string;  // Optional background gradient for special tools
  borderColor?: string; // Optional border color
  iconSize?: number;    // Optional icon size override
}> = {
  Bash: { icon: Terminal, label: 'Bash', color: 'text-green-400' },
  Read: { icon: FileText, label: 'Read', color: 'text-blue-400' },
  Grep: { icon: Search, label: 'Grep', color: 'text-purple-400' },
  Glob: { icon: FolderOpen, label: 'Glob', color: 'text-yellow-400' },
  Write: { icon: FileText, label: 'Write', color: 'text-pink-400' },
  Edit: { icon: Edit2, label: 'Edit', color: 'text-orange-400' },
  WebFetch: { icon: Globe, label: 'WebFetch', color: 'text-cyan-400' },
  WebSearch: { icon: Search, label: 'WebSearch', color: 'text-teal-400' },
  Task: {
    icon: Code,
    label: 'Agent Task',
    color: 'text-purple-400',
    bgGradient: 'from-purple-900/20 to-indigo-900/20',
    borderColor: 'border-purple-500/50',
    iconSize: 18
  },
  TodoWrite: { icon: ListTodo, label: 'Todo', color: 'text-amber-400' },
  AskUserQuestion: { icon: HelpCircle, label: 'Ask', color: 'text-rose-400' },
};

const DEFAULT_CONFIG = { icon: Play, label: 'Tool', color: 'text-gray-400' };

// Extract subagent type from Task tool input
function getSubagentType(input: Record<string, unknown>): string | null {
  const description = (input.description as string) || '';
  const prompt = (input.prompt as string) || '';
  const combined = `${description} ${prompt}`.toLowerCase();

  // Pattern match common subagent types from descriptions
  if (combined.includes('explore') || combined.includes('search')) return 'EXPLORE';
  if (combined.includes('plan')) return 'PLAN';
  if (combined.includes('implement') || combined.includes('code') || combined.includes('bond')) return 'IMPLEMENT';
  if (combined.includes('document') || combined.includes('moneypenny')) return 'DOCUMENT';
  if (combined.includes('test') || combined.includes('verify') || combined.includes('scaramanga')) return 'TEST';
  if (combined.includes('q') || combined.includes('briefing')) return 'BRIEF';

  // Check for explicit subagent_type field
  if (input.subagent_type) {
    return (input.subagent_type as string).toUpperCase();
  }

  return 'TASK'; // Fallback generic label
}

// Format the tool input as a readable string for the summary
function formatToolInput(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Bash':
      return (input.command as string) || '';
    case 'Read':
      return (input.file_path as string) || '';
    case 'Grep':
      return `${input.pattern || ''} ${input.path || ''}`.trim();
    case 'Glob':
      return (input.pattern as string) || '';
    case 'Write':
      return (input.file_path as string) || '';
    case 'Edit':
      return (input.file_path as string) || '';
    case 'WebFetch':
      return (input.url as string) || '';
    case 'WebSearch':
      return (input.query as string) || '';
    case 'Task': {
      const type = getSubagentType(input);
      const description = (input.description as string) || (input.prompt as string)?.slice(0, 80) || '';
      return type ? `[${type}] ${description}` : description;
    }
    case 'TodoWrite': {
      const todos = input.todos as TodoItem[] | undefined;
      if (!todos?.length) return 'Updating tasks...';
      const inProgress = todos.filter(t => t.status === 'in_progress').length;
      const completed = todos.filter(t => t.status === 'completed').length;
      const pending = todos.filter(t => t.status === 'pending').length;
      return `${completed}/${todos.length} done${inProgress > 0 ? `, ${inProgress} active` : ''}${pending > 0 ? `, ${pending} pending` : ''}`;
    }
    default: {
      const firstValue = Object.values(input).find(v => typeof v === 'string');
      return (firstValue as string) || JSON.stringify(input).slice(0, 100);
    }
  }
}

// Clickable file path component
function ClickableFilePath({ filePath, label, lineNumber }: { filePath: string; label?: string; lineNumber?: number }) {
  const openFile = useEditorStore((state) => state.openFile);
  const fileName = filePath.split('/').pop() || filePath;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    openFile(filePath, lineNumber);
  };

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-1 text-claude-text-secondary hover:text-blue-400 transition-colors group"
    >
      <FileText size={12} />
      <span className="group-hover:underline">{label || fileName}</span>
      <ExternalLink size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}

// Helper to detect language from file path
function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', json: 'json', md: 'markdown', html: 'html', css: 'css',
    scss: 'scss', yaml: 'yaml', yml: 'yaml', sh: 'shell', bash: 'shell',
  };
  return langMap[ext] || 'plaintext';
}

// Render a file write view - shows file content being written with Monaco Editor
function WriteView({ content, filePath }: { content: string; filePath: string }) {
  const language = getLanguageFromPath(filePath);

  return (
    <div className="space-y-2 text-xs">
      {/* File header - clickable */}
      <div className="font-semibold flex items-center gap-2">
        <ClickableFilePath filePath={filePath} label={`Writing: ${filePath.split('/').pop() || filePath}`} />
      </div>

      {/* Monaco Editor for file content */}
      <div className="border border-green-500/50 overflow-hidden" style={{ borderRadius: 0 }}>
        <div className="px-2 py-1 bg-green-900/40 text-green-400 text-xs font-bold uppercase" style={{ letterSpacing: '0.05em' }}>
          NEW FILE
        </div>
        <Editor
          height="300px"
          language={language}
          value={content}
          theme="vs-dark"
          loading={<div className="p-4 text-claude-text-secondary">Loading editor...</div>}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            lineNumbers: 'on',
            folding: false,
            renderLineHighlight: 'none',
            contextmenu: false,
            automaticLayout: true,
          }}
          onMount={(editor, monaco) => {
            // Monaco loaded successfully
            monaco.editor.setTheme('vs-dark');
          }}
        />
      </div>
    </div>
  );
}

// Render a diff view for Edit tool using Monaco diff editor
function DiffView({ oldString, newString, filePath }: { oldString: string; newString: string; filePath: string }) {
  const language = getLanguageFromPath(filePath);
  const editorRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      // Cleanup: properly dispose the diff editor on unmount
      if (editorRef.current) {
        try {
          editorRef.current.dispose();
        } catch (e) {
          // Ignore disposal errors
        }
        editorRef.current = null;
      }
    };
  }, []);

  return (
    <div className="space-y-2 text-xs">
      {/* File header - clickable */}
      <div className="font-semibold">
        <ClickableFilePath filePath={filePath} />
      </div>

      {/* Monaco Diff Editor - side by side */}
      <div className="border border-claude-border overflow-hidden" style={{ borderRadius: 0 }}>
        <div className="px-2 py-1 bg-claude-surface text-claude-text-secondary text-xs font-bold uppercase border-b border-claude-border" style={{ letterSpacing: '0.05em' }}>
          DIFF
        </div>
        <DiffEditor
          height="400px"
          language={language}
          original={oldString}
          modified={newString}
          theme="vs-dark"
          loading={<div className="p-4 text-claude-text-secondary">Loading...</div>}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            lineNumbers: 'on',
            contextmenu: false,
            renderLineHighlight: 'all',
            automaticLayout: true,
            renderSideBySide: true,
            enableSplitViewResizing: false,
            renderOverviewRuler: false,
          }}
          onMount={(editor, monaco) => {
            editorRef.current = editor;
            monaco.editor.setTheme('vs-dark');
          }}
        />
      </div>
    </div>
  );
}

// Render expanded content based on tool type
function ExpandedContent({ toolCall }: { toolCall: ToolCall }) {
  const { name, input, result } = toolCall;

  // Special rendering for Read tool - show clickable file path with Monaco preview
  if (name === 'Read') {
    const filePath = (input.file_path as string) || '';
    const lineNumber = (input.offset as number) || undefined;
    const language = getLanguageFromPath(filePath);

    return (
      <div className="space-y-2 text-xs">
        {/* Clickable file path header */}
        <div className="font-semibold">
          <ClickableFilePath filePath={filePath} lineNumber={lineNumber} />
        </div>

        {/* Result preview with Monaco if available */}
        {result !== undefined && (
          <div>
            <div className="text-claude-text-secondary mb-1 font-semibold">Content Preview:</div>
            {typeof result === 'string' && result.length > 10 ? (
              <div className="border border-claude-border overflow-hidden" style={{ borderRadius: 0 }}>
                <Editor
                  height="300px"
                  language={language}
                  value={result.slice(0, 5000)}
                  theme="vs-dark"
                  loading={<div className="p-4 text-claude-text-secondary">Loading...</div>}
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    fontSize: 13,
                    lineNumbers: 'on',
                    folding: true,
                    renderLineHighlight: 'none',
                    contextmenu: false,
                    automaticLayout: true,
                  }}
                />
              </div>
            ) : (
              <pre className="whitespace-pre-wrap text-claude-text bg-claude-bg/50 p-2 overflow-x-auto max-h-60 overflow-y-auto font-mono text-sm">
                {typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result)}
              </pre>
            )}
          </div>
        )}
      </div>
    );
  }

  // Special rendering for Bash tool - show command line
  if (name === 'Bash') {
    const command = (input.command as string) || '';

    return (
      <div className="space-y-2 text-xs">
        {command && (
          <div>
            <div className="text-claude-text-secondary mb-1 font-semibold">Command:</div>
            <pre className="whitespace-pre-wrap text-green-400 bg-black/50 p-2 overflow-x-auto font-mono border-l-2 border-green-500/30">
              $ {command}
            </pre>
          </div>
        )}

        {/* Result section */}
        {result !== undefined && (
          <div>
            <div className="text-claude-text-secondary mb-1 font-semibold">Output:</div>
            <pre className="whitespace-pre-wrap text-claude-text bg-claude-bg/50 p-2 overflow-x-auto max-h-60 overflow-y-auto font-mono text-sm">
              {typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result)}
            </pre>
          </div>
        )}
      </div>
    );
  }

  // Special rendering for Write tool - show file content being written
  if (name === 'Write') {
    const content = (input.content as string) || '';
    const filePath = (input.file_path as string) || '';

    if (content) {
      return <WriteView content={content} filePath={filePath} />;
    }
  }

  // Special rendering for Edit tool - show diff view
  if (name === 'Edit') {
    const oldString = (input.old_string as string) || '';
    const newString = (input.new_string as string) || '';
    const filePath = (input.file_path as string) || '';

    if (oldString || newString) {
      return <DiffView oldString={oldString} newString={newString} filePath={filePath} />;
    }
  }

  // Special rendering for TodoWrite - show task list
  if (name === 'TodoWrite') {
    const todos = input.todos as TodoItem[] | undefined;
    if (!todos?.length) return null;

    return (
      <div className="space-y-1">
        {todos.map((todo, index) => (
          <div key={index} className="flex items-start gap-2 text-xs">
            {todo.status === 'completed' ? (
              <CheckCircle2 size={14} className="text-green-500 flex-shrink-0 mt-0.5" />
            ) : todo.status === 'in_progress' ? (
              <Clock size={14} className="text-amber-500 flex-shrink-0 mt-0.5 animate-pulse" />
            ) : (
              <Circle size={14} className="text-claude-text-secondary flex-shrink-0 mt-0.5" />
            )}
            <span className={
              todo.status === 'completed'
                ? 'text-claude-text-secondary line-through'
                : todo.status === 'in_progress'
                  ? 'text-amber-400'
                  : 'text-claude-text'
            }>
              {todo.status === 'in_progress' ? (todo.activeForm || todo.content) : todo.content}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // Check if input has meaningful content
  const hasInput = typeof input === 'object'
    ? Object.keys(input).length > 0
    : input !== null && input !== undefined && String(input).trim() !== '';

  // For other tools, show input and result
  return (
    <div className="space-y-2 text-xs">
      {/* Input section - only show if there's meaningful input */}
      {hasInput && (
        <div>
          <div className="text-claude-text-secondary mb-1 font-semibold">Input:</div>
          <pre className="whitespace-pre-wrap text-claude-text bg-claude-bg/50 p-2 overflow-x-auto max-h-40 overflow-y-auto">
            {typeof input === 'object' ? JSON.stringify(input, null, 2) : String(input)}
          </pre>
        </div>
      )}

      {/* Result section (if available) */}
      {result !== undefined && (
        <div>
          <div className="text-claude-text-secondary mb-1 font-semibold">Result:</div>
          <pre className="whitespace-pre-wrap text-claude-text bg-claude-bg/50 p-2 overflow-x-auto max-h-60 overflow-y-auto">
            {typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result)}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function ToolCallCard({ toolCall, isLatest = false, isLatestToolCall = false }: ToolCallCardProps) {
  // Expand by default if this is the latest tool call
  const shouldExpand = isLatest || isLatestToolCall;
  const [isExpanded, setIsExpanded] = useState(shouldExpand);

  // Auto-collapse when this is no longer the latest, auto-expand when it becomes latest
  useEffect(() => {
    setIsExpanded(shouldExpand);
  }, [shouldExpand]);

  const config = TOOL_CONFIG[toolCall.name] || DEFAULT_CONFIG;
  const Icon = config.icon;

  const commandDisplay = useMemo(() => formatToolInput(toolCall.name, toolCall.input), [toolCall.name, toolCall.input]);

  const isRunning = toolCall.status === 'running' || toolCall.status === 'pending';

  // Detect if this is a Task tool (subagent)
  const isTaskTool = toolCall.name === 'Task';
  const subagentType = isTaskTool ? getSubagentType(toolCall.input) : null;

  // Status dot color
  const dotColor = isRunning ? 'bg-yellow-500' : 'bg-green-500';

  // Apply enhanced styling for Task tools
  const cardClasses = isTaskTool
    ? `font-mono text-sm bg-gradient-to-r ${config.bgGradient} border-l-4 ${config.borderColor} px-2 py-1 rounded`
    : 'font-mono text-sm';

  const buttonClasses = `w-full flex items-center gap-2 py-0.5 hover:bg-claude-surface/50 transition-colors text-left ${
    isTaskTool && isRunning ? 'animate-pulse-slow' : ''
  }`;

  return (
    <div className={cardClasses}>
      {/* Subagent type badge (Task tools only) */}
      {isTaskTool && subagentType && (
        <div className="mb-1 inline-block px-2 py-0.5 text-[10px] bg-purple-500/20 border border-purple-500/50 text-purple-300 font-bold tracking-wider rounded">
          {subagentType}
        </div>
      )}

      {/* Header row - clickable */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={buttonClasses}
      >
        {/* Expand/collapse chevron */}
        {isExpanded ? (
          <ChevronDown size={12} className={config.color} />
        ) : (
          <ChevronRight size={12} className={config.color} />
        )}

        {/* Status dot */}
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor} ${isRunning ? 'animate-pulse' : ''}`}
        />

        {/* Tool icon and name (larger icon for Task tools) */}
        <Icon size={config.iconSize || 14} className={config.color} />
        <span className={`font-semibold ${config.color}`}>{config.label}</span>

        {/* Input/command summary (only when collapsed) */}
        {!isExpanded && (
          <span className="text-claude-text-secondary truncate flex-1">{commandDisplay}</span>
        )}

        {/* Loading spinner for running tools */}
        {isRunning && (
          <Loader2 size={12} className="text-yellow-500 animate-spin flex-shrink-0" />
        )}
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="ml-6 mt-1 p-2 bg-claude-surface/30 border-l-2 border-current" style={{ borderColor: config.color.replace('text-', '') }}>
          <ExpandedContent toolCall={toolCall} />
        </div>
      )}
    </div>
  );
}
