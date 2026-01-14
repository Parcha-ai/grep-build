import React from 'react';
import ReactMarkdown from 'react-markdown';
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

  // Sort messages by timestamp and filter out system messages
  const sortedMessages = React.useMemo(() => {
    return [...messages]
      .filter(msg => msg.role !== 'system') // Don't show system messages in chat
      .sort((a, b) => {
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
          <p className="text-lg mb-2">Start a conversation</p>
          <p className="text-sm">Ask questions, request code changes, or get help debugging.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 min-w-0">
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
                <div key={event.id} className="prose prose-invert max-w-none font-mono text-claude-text break-words min-w-0" style={{ overflowWrap: 'anywhere' }}>
                  <ReactMarkdown
                    components={{
                      code({ className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || '');
                        const isBlock = String(children).includes('\n') || match;
                        if (isBlock) {
                          return (
                            <div className="overflow-hidden border border-claude-border my-2" style={{ borderRadius: 0 }}>
                              {match && (
                                <div className="px-2 py-1 text-xs font-bold font-mono bg-claude-surface border-b border-claude-border text-claude-text-secondary" style={{ letterSpacing: '0.05em' }}>
                                  {match[1].toUpperCase()}
                                </div>
                              )}
                              <pre className="p-3 bg-claude-bg m-0 whitespace-pre-wrap break-words">
                                <code className="text-sm font-mono text-claude-text" {...props}>{children}</code>
                              </pre>
                            </div>
                          );
                        }
                        return <code className="px-1 py-0.5 text-sm font-mono bg-claude-surface text-claude-accent" style={{ borderRadius: 0 }} {...props}>{children}</code>;
                      },
                      p({ children }) { return <p className="my-1 leading-relaxed">{children}</p>; },
                      ul({ children }) { return <ul className="my-1 ml-6 pl-0 list-disc list-outside">{children}</ul>; },
                      ol({ children }) { return <ol className="my-1 ml-6 pl-0 list-decimal list-outside">{children}</ol>; },
                      li({ children }) { return <li className="my-0.5 ml-0 pl-1">{children}</li>; },
                      h1({ children }) { return <h1 className="text-lg font-bold mt-3 mb-1">{children}</h1>; },
                      h2({ children }) { return <h2 className="text-base font-bold mt-2 mb-1">{children}</h2>; },
                      h3({ children }) { return <h3 className="text-sm font-bold mt-2 mb-1">{children}</h3>; },
                      strong({ children }) { return <strong className="font-bold text-claude-text">{children}</strong>; },
                      em({ children }) { return <em className="italic">{children}</em>; },
                    }}
                  >
                    {event.content}
                  </ReactMarkdown>
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
          <div className="flex gap-0.5">
            <div
              className="w-2 h-2 bg-claude-accent"
              style={{ animation: 'pulse-square 1.2s ease-in-out infinite 0s' }}
            />
            <div
              className="w-2 h-2 bg-claude-accent"
              style={{ animation: 'pulse-square 1.2s ease-in-out infinite 0.4s' }}
            />
            <div
              className="w-2 h-2 bg-claude-accent"
              style={{ animation: 'pulse-square 1.2s ease-in-out infinite 0.8s' }}
            />
          </div>
          <span className="text-sm">Grep is thinking...</span>
        </div>
      )}
    </div>
  );
}
