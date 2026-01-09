import React, { useState, useEffect, useRef } from 'react';
import { Brain, Loader2, ChevronRight, ChevronDown } from 'lucide-react';

interface ThinkingBlockProps {
  content: string;
  isStreaming?: boolean;
}

export default function ThinkingBlock({ content, isStreaming }: ThinkingBlockProps) {
  // Start collapsed by default - user can expand if they want to see full thinking
  const [isExpanded, setIsExpanded] = useState(false);
  const expandedRef = useRef<HTMLDivElement>(null);

  // Auto-scroll expanded view to bottom when new content arrives
  useEffect(() => {
    if (isExpanded && expandedRef.current) {
      expandedRef.current.scrollTop = expandedRef.current.scrollHeight;
    }
  }, [content, isExpanded]);

  // Get last 2-3 lines for collapsed preview (shows latest updates)
  const previewLines = (() => {
    if (!content) return 'Processing...';
    const lines = content.split('\n').filter(l => l.trim());
    const lastLines = lines.slice(-3); // Last 3 lines
    return lastLines.join('\n');
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

        {/* Loading spinner for active thinking */}
        {isStreaming && (
          <Loader2 size={12} className="text-purple-500 animate-spin flex-shrink-0" />
        )}
      </button>

      {/* Preview (collapsed) - shows last 2-3 lines streaming in */}
      {!isExpanded && content && (
        <div className="ml-6 mt-1 p-2 bg-claude-surface/30 border-l-2 border-purple-500/30">
          <pre className="whitespace-pre-wrap text-xs text-claude-text-secondary/80 leading-relaxed overflow-hidden">
            {previewLines}
          </pre>
        </div>
      )}

      {/* Expanded content - fixed height with scroll, won't push input down */}
      {isExpanded && content && (
        <div
          ref={expandedRef}
          className="ml-6 mt-1 p-2 bg-claude-surface/30 border-l-2 border-purple-500/30 max-h-64 overflow-y-auto scroll-smooth"
        >
          <pre className="whitespace-pre-wrap text-sm text-claude-text-secondary leading-relaxed overflow-x-auto">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}
