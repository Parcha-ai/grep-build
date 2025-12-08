import React from 'react';
import MessageBubble from './MessageBubble';
import type { ChatMessage, ToolCall } from '../../../shared/types';

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamContent: string;
  thinkingContent?: string;
  streamingToolCalls?: ToolCall[];
}

export default function MessageList({
  messages,
  isStreaming,
  streamContent,
  thinkingContent,
  streamingToolCalls,
}: MessageListProps) {
  // Check if we have any content to show (either messages, streaming content, thinking, or streaming tool calls)
  const hasStreamingContent = isStreaming && (streamContent || thinkingContent || (streamingToolCalls && streamingToolCalls.length > 0));

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
      {messages.map((message, index) => (
        <MessageBubble
          key={message.id}
          message={message}
          isLatestMessage={!hasStreamingContent && index === messages.length - 1}
        />
      ))}

      {/* Streaming message with tool calls and thinking */}
      {hasStreamingContent && (
        <MessageBubble
          message={{
            id: 'streaming',
            role: 'assistant',
            content: streamContent || '',
            timestamp: new Date(),
          }}
          isStreaming
          streamingToolCalls={streamingToolCalls}
          thinkingContent={thinkingContent}
          isLatestMessage={true}
        />
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
