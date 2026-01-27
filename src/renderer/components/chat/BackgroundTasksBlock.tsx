import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Loader2, ChevronRight, ChevronDown, CheckCircle2, XCircle, Square } from 'lucide-react';
import type { BackgroundTask } from '../../stores/session.store';

interface BackgroundTasksBlockProps {
  tasks: BackgroundTask[];
  onStopTask?: (taskId: string) => void;
  onViewOutput?: (taskId: string) => void;
}

export default function BackgroundTasksBlock({ tasks, onStopTask, onViewOutput }: BackgroundTasksBlockProps) {
  // Start collapsed by default - user can expand if they want to see all tasks
  const [isExpanded, setIsExpanded] = useState(false);
  const expandedRef = useRef<HTMLDivElement>(null);

  // Auto-scroll expanded view to bottom when new output arrives
  useEffect(() => {
    if (isExpanded && expandedRef.current) {
      expandedRef.current.scrollTop = expandedRef.current.scrollHeight;
    }
  }, [tasks, isExpanded]);

  // Calculate stats
  const runningTasks = tasks.filter(t => t.status === 'running').length;
  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  const errorTasks = tasks.filter(t => t.status === 'error').length;

  // Get preview - first running task's command
  const firstRunningTask = tasks.find(t => t.status === 'running');
  const previewText = firstRunningTask
    ? firstRunningTask.command.slice(0, 60) + (firstRunningTask.command.length > 60 ? '...' : '')
    : runningTasks === 0
      ? `${completedTasks} completed${errorTasks > 0 ? `, ${errorTasks} failed` : ''}`
      : '';

  // Get last few lines of output for preview
  const getOutputPreview = (output: string, lines = 3): string => {
    if (!output) return '';
    const outputLines = output.split('\n').filter(l => l.trim());
    return outputLines.slice(-lines).join('\n');
  };

  // Colors - cyan/teal accent for background tasks
  const accentColor = 'text-cyan-400';
  const dotColor = runningTasks > 0 ? 'bg-cyan-500' : errorTasks > 0 ? 'bg-red-500' : 'bg-green-500';
  const borderColor = 'border-cyan-500/30';

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
          className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor} ${runningTasks > 0 ? 'animate-pulse' : ''}`}
        />

        {/* Icon and label */}
        <Terminal size={14} className={`${accentColor} flex-shrink-0`} />
        <span className={`font-semibold ${accentColor}`}>
          Background ({runningTasks} running)
        </span>

        {/* Loading spinner for running tasks */}
        {runningTasks > 0 && (
          <Loader2 size={12} className="text-cyan-400 animate-spin flex-shrink-0" />
        )}
      </button>

      {/* Preview (collapsed) - shows first running task's command */}
      {!isExpanded && previewText && (
        <div className={`ml-6 mt-1 p-2 bg-claude-surface/30 border-l-2 ${borderColor}`}>
          <div className="flex items-center gap-2 text-xs text-claude-text-secondary/80">
            {firstRunningTask ? (
              <>
                <span className="text-green-400">$</span>
                <span className="text-cyan-400 truncate">{previewText}</span>
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
          className={`ml-6 mt-1 p-2 bg-claude-surface/30 border-l-2 ${borderColor} max-h-80 overflow-y-auto scroll-smooth`}
        >
          <div className="space-y-3">
            {tasks.map((task) => (
              <div key={task.id} className="border-b border-claude-border/30 pb-2 last:border-b-0 last:pb-0">
                {/* Task header */}
                <div className="flex items-center gap-2 text-xs mb-1">
                  {/* Status icon */}
                  {task.status === 'completed' ? (
                    <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
                  ) : task.status === 'error' ? (
                    <XCircle size={14} className="text-red-500 flex-shrink-0" />
                  ) : (
                    <Loader2 size={14} className="text-cyan-400 animate-spin flex-shrink-0" />
                  )}

                  {/* Command */}
                  <span className="text-green-400">$</span>
                  <span className={`flex-1 truncate ${
                    task.status === 'completed'
                      ? 'text-claude-text-secondary'
                      : task.status === 'error'
                        ? 'text-red-400'
                        : 'text-cyan-400'
                  }`}>
                    {task.command.slice(0, 80)}{task.command.length > 80 ? '...' : ''}
                  </span>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {task.status === 'running' && onStopTask && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onStopTask(task.id);
                        }}
                        className="px-1.5 py-0.5 text-[10px] font-bold bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30"
                        style={{ borderRadius: 0 }}
                        title="Stop task"
                      >
                        <Square size={10} />
                      </button>
                    )}
                    {task.outputFile && onViewOutput && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onViewOutput(task.id);
                        }}
                        className="px-1.5 py-0.5 text-[10px] font-bold bg-claude-surface hover:bg-claude-accent hover:text-black text-claude-text-secondary border border-claude-border"
                        style={{ borderRadius: 0 }}
                      >
                        View
                      </button>
                    )}
                  </div>
                </div>

                {/* Output preview */}
                {task.output && (
                  <pre className="ml-6 text-[11px] text-claude-text-secondary/70 whitespace-pre-wrap overflow-x-auto max-h-20 overflow-y-auto bg-black/20 p-1">
                    {getOutputPreview(task.output, 4)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
