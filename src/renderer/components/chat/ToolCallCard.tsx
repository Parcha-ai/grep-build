import React, { useState, useMemo, useEffect } from 'react';
import { Terminal, FileText, Search, FolderOpen, Play, Edit2, Globe, Code, HelpCircle, ListTodo, Loader2, ChevronRight, ChevronDown, CheckCircle2, Circle, Clock, ExternalLink } from 'lucide-react';
import type { ToolCall } from '../../../shared/types';
import { useEditorStore } from '../../stores/editor.store';

interface ToolCallCardProps {
  toolCall: ToolCall;
  isLatest?: boolean; // If true, expand by default
}

interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

// Map tool names to icons and labels
const TOOL_CONFIG: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  Bash: { icon: Terminal, label: 'Bash', color: 'text-green-400' },
  Read: { icon: FileText, label: 'Read', color: 'text-blue-400' },
  Grep: { icon: Search, label: 'Grep', color: 'text-purple-400' },
  Glob: { icon: FolderOpen, label: 'Glob', color: 'text-yellow-400' },
  Write: { icon: FileText, label: 'Write', color: 'text-pink-400' },
  Edit: { icon: Edit2, label: 'Edit', color: 'text-orange-400' },
  WebFetch: { icon: Globe, label: 'WebFetch', color: 'text-cyan-400' },
  WebSearch: { icon: Search, label: 'WebSearch', color: 'text-teal-400' },
  Task: { icon: Code, label: 'Task', color: 'text-indigo-400' },
  TodoWrite: { icon: ListTodo, label: 'Todo', color: 'text-amber-400' },
  AskUserQuestion: { icon: HelpCircle, label: 'Ask', color: 'text-rose-400' },
};

const DEFAULT_CONFIG = { icon: Play, label: 'Tool', color: 'text-gray-400' };

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
    case 'Task':
      return (input.description as string) || (input.prompt as string)?.slice(0, 80) || '';
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

// Render a file write view - shows file content being written with line numbers
function WriteView({ content, filePath }: { content: string; filePath: string }) {
  const lines = content.split('\n');

  return (
    <div className="space-y-2 text-xs">
      {/* File header - clickable */}
      <div className="font-semibold flex items-center gap-2">
        <ClickableFilePath filePath={filePath} label={`Writing: ${filePath.split('/').pop() || filePath}`} />
      </div>

      {/* File content display */}
      <div className="border border-claude-border overflow-hidden" style={{ borderRadius: 0 }}>
        {/* New file content - green */}
        <div className="bg-green-950/30">
          <div className="px-2 py-1 bg-green-900/40 text-green-400 text-xs font-bold uppercase" style={{ letterSpacing: '0.05em' }}>
            NEW FILE
          </div>
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            {lines.map((line, idx) => (
              <div key={`line-${idx}`} className="flex hover:bg-green-900/20">
                <span className="w-10 flex-shrink-0 px-2 text-green-500/60 bg-green-900/20 select-none text-right border-r border-green-900/30">
                  {idx + 1}
                </span>
                <span className="flex-1 px-2 text-green-300 whitespace-pre">
                  <span className="text-green-500 mr-1">+</span>
                  {line || ' '}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Render a diff view for Edit tool - shows old and new with line numbers
function DiffView({ oldString, newString, filePath }: { oldString: string; newString: string; filePath: string }) {
  const oldLines = oldString.split('\n');
  const newLines = newString.split('\n');

  return (
    <div className="space-y-2 text-xs">
      {/* File header - clickable */}
      <div className="font-semibold">
        <ClickableFilePath filePath={filePath} />
      </div>

      {/* Diff display */}
      <div className="border border-claude-border overflow-hidden" style={{ borderRadius: 0 }}>
        {/* Old content - red */}
        <div className="bg-red-950/30 border-b border-claude-border">
          <div className="px-2 py-1 bg-red-900/40 text-red-400 text-xs font-bold uppercase" style={{ letterSpacing: '0.05em' }}>
            REMOVED
          </div>
          <div className="overflow-x-auto max-h-32 overflow-y-auto">
            {oldLines.map((line, idx) => (
              <div key={`old-${idx}`} className="flex hover:bg-red-900/20">
                <span className="w-10 flex-shrink-0 px-2 text-red-500/60 bg-red-900/20 select-none text-right border-r border-red-900/30">
                  {idx + 1}
                </span>
                <span className="flex-1 px-2 text-red-300 whitespace-pre">
                  <span className="text-red-500 mr-1">-</span>
                  {line || ' '}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* New content - green */}
        <div className="bg-green-950/30">
          <div className="px-2 py-1 bg-green-900/40 text-green-400 text-xs font-bold uppercase" style={{ letterSpacing: '0.05em' }}>
            ADDED
          </div>
          <div className="overflow-x-auto max-h-32 overflow-y-auto">
            {newLines.map((line, idx) => (
              <div key={`new-${idx}`} className="flex hover:bg-green-900/20">
                <span className="w-10 flex-shrink-0 px-2 text-green-500/60 bg-green-900/20 select-none text-right border-r border-green-900/30">
                  {idx + 1}
                </span>
                <span className="flex-1 px-2 text-green-300 whitespace-pre">
                  <span className="text-green-500 mr-1">+</span>
                  {line || ' '}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Render expanded content based on tool type
function ExpandedContent({ toolCall }: { toolCall: ToolCall }) {
  const { name, input, result } = toolCall;

  // Special rendering for Read tool - show clickable file path
  if (name === 'Read') {
    const filePath = (input.file_path as string) || '';
    const lineNumber = (input.offset as number) || undefined;

    return (
      <div className="space-y-2 text-xs">
        {/* Clickable file path header */}
        <div className="font-semibold">
          <ClickableFilePath filePath={filePath} lineNumber={lineNumber} />
        </div>

        {/* Result preview if available */}
        {result !== undefined && (
          <div>
            <div className="text-claude-text-secondary mb-1 font-semibold">Content Preview:</div>
            <pre className="whitespace-pre-wrap text-claude-text bg-claude-bg/50 p-2 overflow-x-auto max-h-60 overflow-y-auto font-mono text-sm">
              {typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result).slice(0, 2000)}
              {typeof result === 'string' && result.length > 2000 && '...'}
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

  // For other tools, show input and result
  return (
    <div className="space-y-2 text-xs">
      {/* Input section */}
      <div>
        <div className="text-claude-text-secondary mb-1 font-semibold">Input:</div>
        <pre className="whitespace-pre-wrap text-claude-text bg-claude-bg/50 p-2 overflow-x-auto max-h-40 overflow-y-auto">
          {typeof input === 'object' ? JSON.stringify(input, null, 2) : String(input)}
        </pre>
      </div>

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

export default function ToolCallCard({ toolCall, isLatest = false }: ToolCallCardProps) {
  // Expand by default if this is the latest tool call
  const [isExpanded, setIsExpanded] = useState(isLatest);

  // Auto-collapse when this is no longer the latest, auto-expand when it becomes latest
  useEffect(() => {
    setIsExpanded(isLatest);
  }, [isLatest]);

  const config = TOOL_CONFIG[toolCall.name] || DEFAULT_CONFIG;
  const Icon = config.icon;

  const commandDisplay = useMemo(() => formatToolInput(toolCall.name, toolCall.input), [toolCall.name, toolCall.input]);

  const isRunning = toolCall.status === 'running' || toolCall.status === 'pending';

  // Status dot color
  const dotColor = isRunning ? 'bg-yellow-500' : 'bg-green-500';

  return (
    <div className="font-mono text-sm">
      {/* Header row - clickable */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 py-0.5 hover:bg-claude-surface/50 transition-colors text-left"
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

        {/* Tool icon and name */}
        <Icon size={14} className={config.color} />
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
