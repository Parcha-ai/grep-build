import React, { useState, useEffect } from 'react';
import { Brain, Loader2, ChevronRight, ChevronDown } from 'lucide-react';

interface ThinkingBlockProps {
  content: string;
  isStreaming?: boolean;
}

export default function ThinkingBlock({ content, isStreaming }: ThinkingBlockProps) {
  // Auto-expand when actively streaming so user can see thinking in real-time
  const [isExpanded, setIsExpanded] = useState(isStreaming ?? false);

  // Auto-expand when streaming starts, auto-collapse when streaming ends
  useEffect(() => {
    setIsExpanded(isStreaming ?? false);
  }, [isStreaming]);

  // Generate a summary - take first meaningful line, truncated
  const summary = (() => {
    if (!content) return 'Processing...';
    const firstLine = content.split('\n').find(l => l.trim()) || '';
    return firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine;
  })();

  // Status dot color - same pattern as ToolCallCard
  const dotColor = isStreaming ? 'bg-purple-500' : 'bg-purple-500';

  return (
    <div className="font-mono text-sm">
      {/* Header row - clickable */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 py-0.5 hover:bg-claude-surface/50 transition-colors text-left"
      >
        {/* Expand/collapse chevron */}
        {isExpanded ? (
          <ChevronDown size={12} className="text-purple-400 flex-shrink-0" />
        ) : (
          <ChevronRight size={12} className="text-purple-400 flex-shrink-0" />
        )}

        {/* Status dot */}
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor} ${isStreaming ? 'animate-pulse' : ''}`}
        />

        {/* Brain icon and label */}
        <Brain size={14} className="text-purple-400 flex-shrink-0" />
        <span className="font-semibold text-purple-400">Thinking</span>

        {/* Summary (only when collapsed) */}
        {!isExpanded && (
          <span className="text-claude-text-secondary truncate flex-1">{summary}</span>
        )}

        {/* Loading spinner for active thinking */}
        {isStreaming && (
          <Loader2 size={12} className="text-purple-500 animate-spin flex-shrink-0" />
        )}
      </button>

      {/* Expanded content */}
      {isExpanded && content && (
        <div className="ml-6 mt-1 p-2 bg-claude-surface/30 border-l-2 border-purple-500/30">
          <pre className="whitespace-pre-wrap text-sm text-claude-text-secondary leading-relaxed overflow-x-auto">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}
