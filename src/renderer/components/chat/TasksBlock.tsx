import React, { useState, useEffect, useRef } from 'react';
import { ListTodo, Loader2, ChevronRight, ChevronDown, CheckCircle2, Circle, Clock } from 'lucide-react';

export interface Task {
  id: string;
  subject: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed';
  owner?: string;
  activeForm?: string;
  blocks?: string[];
  blockedBy?: string[];
}

interface TasksBlockProps {
  tasks: Task[];
  isStreaming?: boolean;
}

export default function TasksBlock({ tasks, isStreaming }: TasksBlockProps) {
  // Start collapsed by default - user can expand if they want to see all tasks
  const [isExpanded, setIsExpanded] = useState(false);
  const expandedRef = useRef<HTMLDivElement>(null);

  // Auto-scroll expanded view to bottom when new tasks arrive
  useEffect(() => {
    if (isExpanded && expandedRef.current) {
      expandedRef.current.scrollTop = expandedRef.current.scrollHeight;
    }
  }, [tasks, isExpanded]);

  // Calculate stats
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  const inProgressTask = tasks.find(t => t.status === 'in_progress');

  // Get preview text (current active task or progress summary)
  const previewText = (() => {
    if (inProgressTask) {
      return inProgressTask.activeForm || inProgressTask.subject;
    }
    if (completedTasks === totalTasks && totalTasks > 0) {
      return 'All tasks completed';
    }
    return `${completedTasks}/${totalTasks} tasks completed`;
  })();

  // Colors - green accent for tasks
  const accentColor = 'text-green-400';
  const dotColor = inProgressTask ? 'bg-amber-500' : completedTasks === totalTasks ? 'bg-green-500' : 'bg-green-500';
  const borderColor = 'border-green-500/30';

  return (
    <div className="font-mono text-sm">
      {/* Header row - clickable */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 py-0.5 hover:bg-claude-surface/50 transition-colors text-left"
      >
        {/* Expand/collapse chevron */}
        {isExpanded ? (
          <ChevronDown size={12} className={`${accentColor} flex-shrink-0`} />
        ) : (
          <ChevronRight size={12} className={`${accentColor} flex-shrink-0`} />
        )}

        {/* Status dot */}
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor} ${inProgressTask && isStreaming ? 'animate-pulse' : ''}`}
        />

        {/* Icon and label */}
        <ListTodo size={14} className={`${accentColor} flex-shrink-0`} />
        <span className={`font-semibold ${accentColor}`}>
          Tasks ({completedTasks}/{totalTasks})
        </span>

        {/* Loading spinner for active tasks while streaming */}
        {inProgressTask && isStreaming && (
          <Loader2 size={12} className="text-amber-400 animate-spin flex-shrink-0" />
        )}
      </button>

      {/* Preview (collapsed) - shows current active task or progress */}
      {!isExpanded && (
        <div className={`ml-6 mt-1 p-2 bg-claude-surface/30 border-l-2 ${borderColor}`}>
          <div className="flex items-center gap-2 text-xs text-claude-text-secondary/80">
            {inProgressTask ? (
              <>
                <Clock size={12} className="text-amber-400 animate-pulse flex-shrink-0" />
                <span className="text-amber-400">{previewText}</span>
              </>
            ) : completedTasks === totalTasks ? (
              <>
                <CheckCircle2 size={12} className="text-green-500 flex-shrink-0" />
                <span className="text-green-500">{previewText}</span>
              </>
            ) : (
              <span>{previewText}</span>
            )}
          </div>
        </div>
      )}

      {/* Expanded content - fixed height with scroll */}
      {isExpanded && (
        <div
          ref={expandedRef}
          className={`ml-6 mt-1 p-2 bg-claude-surface/30 border-l-2 ${borderColor} max-h-64 overflow-y-auto scroll-smooth`}
        >
          <div className="space-y-1.5">
            {tasks.map((task) => (
              <div key={task.id} className="flex items-start gap-2 text-xs">
                {/* Status icon */}
                {task.status === 'completed' ? (
                  <CheckCircle2 size={14} className="text-green-500 flex-shrink-0 mt-0.5" />
                ) : task.status === 'in_progress' ? (
                  <Clock size={14} className="text-amber-500 flex-shrink-0 mt-0.5 animate-pulse" />
                ) : (
                  <Circle size={14} className="text-claude-text-secondary flex-shrink-0 mt-0.5" />
                )}

                {/* Task text */}
                <span className={
                  task.status === 'completed'
                    ? 'text-claude-text-secondary line-through'
                    : task.status === 'in_progress'
                      ? 'text-amber-400'
                      : 'text-claude-text'
                }>
                  {task.status === 'in_progress' && task.activeForm
                    ? task.activeForm
                    : task.subject}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
