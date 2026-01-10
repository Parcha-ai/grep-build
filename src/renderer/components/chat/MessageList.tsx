import React from 'react';
import MessageBubble from './MessageBubble';
import ToolCallCard from './ToolCallCard';
import type { ChatMessage, ToolCall } from '../../../shared/types';
import type { StreamEvent } from '../../stores/session.store';

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamEvents: StreamEvent[];
  streamContent: string;
  streamingToolCalls?: ToolCall[];
  currentToolCalls?: ToolCall[]; // Live-updated tool calls (not snapshots)
}

export default function MessageList({
  messages,
  isStreaming,
  streamEvents,
  streamContent,
  streamingToolCalls,
  currentToolCalls = [],
}: MessageListProps) {
  // All hooks must be called before any conditional returns

  // Create a map for quick lookup of current tool call state by ID
  const toolCallMap = React.useMemo(() => {
    const map = new Map<string, ToolCall>();
    for (const tc of currentToolCalls) {
      map.set(tc.id, tc);
    }
    return map;
  }, [currentToolCalls]);

  // Sort messages by timestamp to ensure chronological order
  const sortedMessages = React.useMemo(() => {
    return [...messages].sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return timeA - timeB;
    });
  }, [messages]);

  // Check if we have any content to show (either messages, streaming content, or streaming tool calls)
  const hasStreamingContent = isStreaming && (streamContent || (streamingToolCalls && streamingToolCalls.length > 0));

  if (messages.length === 0 && !hasStreamingContent) {
    return (
      <div className="h-full flex items-center justify-center text-claude-text-secondary">
        <div className="text-center">
          <p className="text-lg mb-2">Start a conversation with Claude</p>
          <p className="text-sm">Ask questions, request code changes, or get help debugging.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {sortedMessages.map((message, index) => (
        <MessageBubble
          key={message.id}
          message={message}
          isLatestMessage={!hasStreamingContent && index === sortedMessages.length - 1}
        />
      ))}

      {/* Streaming events in chronological order (excluding thinking - shown separately) */}
      {isStreaming && streamEvents.length > 0 && (
        <div className="space-y-2">
          {streamEvents.map((event) => {
            // Skip thinking events - they're shown in the dedicated thinking section
            if (event.type === 'thinking') {
              return null;
            } else if (event.type === 'tool') {
              // Use the live-updated tool call from currentToolCalls, fall back to snapshot
              const liveToolCall = toolCallMap.get(event.toolCall!.id) || event.toolCall!;
              return (
                <ToolCallCard
                  key={event.id}
                  toolCall={liveToolCall}
                  isLatest={false}
                  isStreaming={true}
                />
              );
            } else if (event.type === 'text' && event.content) {
              return (
                <div key={event.id} className="text-claude-text font-mono">
                  {event.content}
                </div>
              );
            }
            return null;
          })}
        </div>
      )}

      {/* Loading indicator - only show when streaming but no content yet */}
      {isStreaming && !hasStreamingContent && (
        <div className="flex items-center gap-2 text-claude-text-secondary">
          <div className="flex gap-1">
            <div className="w-2 h-2 rounded-full bg-claude-accent animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-2 h-2 rounded-full bg-claude-accent animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 rounded-full bg-claude-accent animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          <span className="text-sm">Claude is thinking...</span>
        </div>
      )}
    </div>
  );
}
