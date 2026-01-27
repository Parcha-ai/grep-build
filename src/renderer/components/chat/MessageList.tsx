import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import MessageBubble from './MessageBubble';
import ToolCallCard from './ToolCallCard';
import ReleaseNotes from '../common/ReleaseNotes';
import { getLatestRelease } from '../../../shared/config/release-notes';
import type { ChatMessage, ToolCall } from '../../../shared/types';
import type { StreamEvent } from '../../stores/session.store';

interface QueuedMessage {
  id: string;
  message: string;
  attachments?: unknown[];
  timestamp: number;
}

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamEvents: StreamEvent[];
  streamContent: string;
  streamingToolCalls?: ToolCall[];
  currentToolCalls?: ToolCall[]; // Live-updated tool calls (not snapshots)
  queuedMessages?: QueuedMessage[];
  onBackgroundTask?: (toolCall: ToolCall) => void; // Callback to background a running Bash command
}

export default function MessageList({
  messages,
  isStreaming,
  streamEvents,
  streamContent,
  streamingToolCalls,
  currentToolCalls = [],
  queuedMessages = [],
  onBackgroundTask,
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

  // Track whether to show release notes banner (dismissible)
  const [showReleaseNotes, setShowReleaseNotes] = useState(true);

  // Check localStorage for dismissed version
  useEffect(() => {
    const dismissedVersion = localStorage.getItem('grep-dismissed-release');
    const latestVersion = getLatestRelease().version;
    if (dismissedVersion === latestVersion) {
      setShowReleaseNotes(false);
    }
  }, []);

  const handleDismissReleaseNotes = () => {
    const latestVersion = getLatestRelease().version;
    localStorage.setItem('grep-dismissed-release', latestVersion);
    setShowReleaseNotes(false);
  };

  if (messages.length === 0 && !hasStreamingContent) {
    return (
      <div className="h-full flex flex-col">
        {/* Release notes banner at top */}
        {showReleaseNotes && (
          <ReleaseNotes banner onDismiss={handleDismissReleaseNotes} />
        )}

        {/* Empty state message */}
        <div className="flex-1 flex items-center justify-center text-claude-text-secondary">
          <div className="text-center max-w-md px-4">
            <div className="text-4xl mb-4">$_</div>
            <p className="text-lg mb-2 font-bold text-claude-text">Ready to grep</p>
            <p className="text-sm text-claude-text-secondary">
              Ask questions, request code changes, or get help debugging.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2 text-xs">
              <span className="px-2 py-1 border border-claude-border text-claude-text-secondary">
                Tab → cycle modes
              </span>
              <span className="px-2 py-1 border border-claude-border text-claude-text-secondary">
                Cmd+K → quick search
              </span>
              <span className="px-2 py-1 border border-claude-border text-claude-text-secondary">
                Cmd+L → clear chat
              </span>
            </div>
          </div>
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
          isOldMessage={index < sortedMessages.length - 10}
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
                  onBackground={onBackgroundTask}
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

      {/* Queued messages - show as pending user messages */}
      {queuedMessages.length > 0 && (
        <div className="space-y-2 mt-4">
          {queuedMessages.map((queuedMsg, index) => (
            <div
              key={queuedMsg.id}
              className="flex items-start gap-2 p-3 border border-dashed border-claude-border bg-claude-surface/30 opacity-70"
            >
              <div className="flex-shrink-0">
                <div className="w-6 h-6 flex items-center justify-center bg-amber-500/20 border border-amber-500/50">
                  <span className="text-xs text-amber-400 font-bold">{index + 1}</span>
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold text-amber-400 uppercase" style={{ letterSpacing: '0.05em' }}>
                    QUEUED
                  </span>
                  <span className="text-[10px] text-claude-text-secondary">
                    Will send after current response
                  </span>
                </div>
                <p className="text-sm text-claude-text break-words" style={{ overflowWrap: 'anywhere' }}>
                  {queuedMsg.message.length > 200
                    ? `${queuedMsg.message.slice(0, 200)}...`
                    : queuedMsg.message}
                </p>
                {queuedMsg.attachments && queuedMsg.attachments.length > 0 && (
                  <div className="mt-1 text-[10px] text-claude-text-secondary">
                    + {queuedMsg.attachments.length} attachment{queuedMsg.attachments.length > 1 ? 's' : ''}
                  </div>
                )}
              </div>
            </div>
          ))}
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
