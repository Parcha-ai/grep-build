import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Terminal, FileText, Search, FolderOpen, Play, Edit2, Globe, Code, HelpCircle, ListTodo, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import type { ToolCall } from '../../../shared/types';

interface ToolCallCardProps {
  toolCall: ToolCall;
}

interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

// Map tool names to icons and colors
const TOOL_CONFIG: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  Bash: { icon: Terminal, label: 'Bash', color: 'text-amber-500' },
  Read: { icon: FileText, label: 'Read', color: 'text-blue-400' },
  Grep: { icon: Search, label: 'Grep', color: 'text-purple-400' },
  Glob: { icon: FolderOpen, label: 'Glob', color: 'text-green-400' },
  Write: { icon: FileText, label: 'Write', color: 'text-cyan-400' },
  Edit: { icon: Edit2, label: 'Edit', color: 'text-yellow-400' },
  WebFetch: { icon: Globe, label: 'WebFetch', color: 'text-pink-400' },
  WebSearch: { icon: Search, label: 'WebSearch', color: 'text-indigo-400' },
  Task: { icon: Code, label: 'Task', color: 'text-emerald-400' },
  TodoWrite: { icon: ListTodo, label: 'Todo', color: 'text-orange-400' },
  AskUserQuestion: { icon: HelpCircle, label: 'Question', color: 'text-violet-400' },
};

const DEFAULT_CONFIG = { icon: Play, label: 'Tool', color: 'text-gray-400' };
const MAX_VISIBLE_LINES = 6;

// Format the tool input as a readable string
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
      return (input.description as string) || (input.prompt as string)?.slice(0, 50) || '';
    case 'TodoWrite': {
      const todos = input.todos as TodoItem[] | undefined;
      if (!todos?.length) return 'Updating tasks...';
      const completed = todos.filter(t => t.status === 'completed').length;
      const inProgress = todos.filter(t => t.status === 'in_progress').length;
      return `${completed}/${todos.length} done${inProgress ? `, ${inProgress} in progress` : ''}`;
    }
    default: {
      // Return first string value from input
      const firstValue = Object.values(input).find(v => typeof v === 'string');
      return (firstValue as string) || JSON.stringify(input).slice(0, 100);
    }
  }
}

// Get todo items from input
function getTodoItems(input: Record<string, unknown>): TodoItem[] | null {
  const todos = input.todos as TodoItem[] | undefined;
  return todos?.length ? todos : null;
}

// Render a single todo item
function TodoItemRow({ todo }: { todo: TodoItem }) {
  const getStatusIcon = () => {
    switch (todo.status) {
      case 'completed':
        return <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" />;
      case 'in_progress':
        return <Loader2 size={14} className="text-amber-500 animate-spin flex-shrink-0" />;
      case 'pending':
      default:
        return <Circle size={14} className="text-claude-text-secondary flex-shrink-0" />;
    }
  };

  return (
    <div className="flex items-start gap-2 py-0.5">
      {getStatusIcon()}
      <span className={`${todo.status === 'completed' ? 'text-claude-text-secondary line-through' : 'text-claude-text'}`}>
        {todo.status === 'in_progress' ? (todo.activeForm || todo.content) : todo.content}
      </span>
    </div>
  );
}

// Format the tool result as displayable lines
function formatToolResult(result: unknown): string[] {
  if (result === undefined || result === null) return [];

  if (typeof result === 'string') {
    return result.split('\n');
  }

  if (typeof result === 'object') {
    return JSON.stringify(result, null, 2).split('\n');
  }

  return [String(result)];
}

export default function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const config = TOOL_CONFIG[toolCall.name] || DEFAULT_CONFIG;
  const Icon = config.icon;

  const commandDisplay = useMemo(() => formatToolInput(toolCall.name, toolCall.input), [toolCall.name, toolCall.input]);
  const outputLines = useMemo(() => formatToolResult(toolCall.result), [toolCall.result]);
  const todoItems = useMemo(() => toolCall.name === 'TodoWrite' ? getTodoItems(toolCall.input) : null, [toolCall.name, toolCall.input]);

  const hasMoreLines = outputLines.length > MAX_VISIBLE_LINES;
  const visibleLines = isExpanded ? outputLines : outputLines.slice(0, MAX_VISIBLE_LINES);
  const hiddenCount = outputLines.length - MAX_VISIBLE_LINES;

  // Map status to display status
  const displayStatus = toolCall.status === 'completed' ? 'complete' : toolCall.status;

  return (
    <div className="my-2 font-mono text-sm">
      {/* Header */}
      <div className="flex items-center gap-2">
        {/* Status indicator */}
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            displayStatus === 'running' || displayStatus === 'pending'
              ? 'bg-amber-500 animate-pulse'
              : displayStatus === 'error'
              ? 'bg-red-500'
              : 'bg-emerald-500'
          }`}
        />

        {/* Tool icon */}
        <Icon size={14} className={config.color} />

        {/* Tool type */}
        <span className={`font-semibold ${config.color}`}>
          {config.label}
        </span>

        {/* Command/Input */}
        <span className="text-claude-text-secondary truncate flex-1">
          {commandDisplay}
        </span>
      </div>

      {/* Error message */}
      {toolCall.error && (
        <div className="mt-1 ml-4 border-l-2 border-red-500/50 pl-3">
          <span className="text-red-400 text-xs">{toolCall.error}</span>
        </div>
      )}

      {/* Todo list for TodoWrite */}
      {todoItems && (
        <div className="mt-1 ml-4 border-l-2 border-orange-500/30 pl-3">
          {todoItems.map((todo, index) => (
            <TodoItemRow key={index} todo={todo} />
          ))}
        </div>
      )}

      {/* Generic output for other tools */}
      {!todoItems && outputLines.length > 0 && (
        <div className="mt-1 ml-4 border-l-2 border-claude-border/50 pl-3">
          {visibleLines.map((line, index) => (
            <div key={index} className="flex items-start">
              <span className="text-claude-text-secondary mr-2 select-none">└</span>
              <span className="text-claude-text whitespace-pre-wrap break-all">
                {line || ' '}
              </span>
            </div>
          ))}

          {/* Expand/collapse toggle */}
          {hasMoreLines && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1 text-claude-text-secondary hover:text-claude-text mt-1 text-xs"
            >
              {isExpanded ? (
                <>
                  <ChevronDown size={12} />
                  <span>Show less</span>
                </>
              ) : (
                <>
                  <ChevronRight size={12} />
                  <span>... +{hiddenCount} lines</span>
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
