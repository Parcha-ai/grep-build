import React, { useMemo } from 'react';
import { Terminal, FileText, Search, FolderOpen, Play, Edit2, Globe, Code, HelpCircle, ListTodo, Loader2 } from 'lucide-react';
import type { ToolCall } from '../../../shared/types';

interface ToolCallCardProps {
  toolCall: ToolCall;
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
      return (input.description as string) || (input.prompt as string)?.slice(0, 80) || '';
    case 'TodoWrite': {
      const todos = input.todos as TodoItem[] | undefined;
      if (!todos?.length) return 'Updating tasks...';
      return JSON.stringify(input).slice(0, 100);
    }
    default: {
      const firstValue = Object.values(input).find(v => typeof v === 'string');
      return (firstValue as string) || JSON.stringify(input).slice(0, 100);
    }
  }
}

export default function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const config = TOOL_CONFIG[toolCall.name] || DEFAULT_CONFIG;
  const Icon = config.icon;

  const commandDisplay = useMemo(() => formatToolInput(toolCall.name, toolCall.input), [toolCall.name, toolCall.input]);

  const isRunning = toolCall.status === 'running' || toolCall.status === 'pending';

  // Status dot color
  const dotColor = isRunning ? 'bg-yellow-500' : 'bg-green-500';

  return (
    <div className="flex items-center gap-2 py-0.5 font-mono text-sm">
      {/* Status dot */}
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor} ${isRunning ? 'animate-pulse' : ''}`}
      />

      {/* Tool icon and name */}
      <Icon size={14} className={config.color} />
      <span className={`font-semibold ${config.color}`}>{config.label}</span>

      {/* Input/command */}
      <span className="text-claude-text-secondary truncate">{commandDisplay}</span>

      {/* Loading spinner for running tools */}
      {isRunning && (
        <Loader2 size={12} className="text-yellow-500 animate-spin flex-shrink-0" />
      )}
    </div>
  );
}
