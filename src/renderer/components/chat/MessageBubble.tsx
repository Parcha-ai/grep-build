import React from 'react';
import { User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import ToolCallCard from './ToolCallCard';
import type { ChatMessage, ToolCall } from '../../../shared/types';

interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
  streamingToolCalls?: ToolCall[];
}

export default function MessageBubble({ message, isStreaming, streamingToolCalls }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  // Use streaming tool calls if provided, otherwise use message.toolCalls
  const toolCalls = streamingToolCalls || message.toolCalls || [];

  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar - only for user messages */}
      {isUser && (
        <div
          className="w-7 h-7 flex items-center justify-center flex-shrink-0 bg-blue-600"
          style={{ borderRadius: 0 }}
        >
          <User size={14} className="text-white" />
        </div>
      )}

      {/* Content */}
      <div className={`flex-1 ${isUser ? 'max-w-[85%] text-right' : ''}`}>
        {isUser ? (
          // User messages - brutalist bubble
          <div
            className="inline-block px-3 py-2 bg-blue-600"
            style={{ borderRadius: 0 }}
          >
            <p className="whitespace-pre-wrap text-white font-mono text-sm">{message.content}</p>
          </div>
        ) : (
          // Assistant messages - markdown content + tool calls
          <div className="space-y-2">
            {/* Render markdown content */}
            {message.content && (
              <div className="prose prose-invert prose-sm max-w-none font-mono text-claude-text">
                <ReactMarkdown
                  components={{
                    // Custom code block rendering
                    code({ className, children, ...props }) {
                      const match = /language-(\w+)/.exec(className || '');
                      const isBlock = String(children).includes('\n') || match;

                      if (isBlock) {
                        return (
                          <div className="overflow-hidden border border-claude-border my-2" style={{ borderRadius: 0 }}>
                            {match && (
                              <div
                                className="px-2 py-1 text-[10px] font-bold font-mono bg-claude-surface border-b border-claude-border text-claude-text-secondary"
                                style={{ letterSpacing: '0.05em' }}
                              >
                                {match[1].toUpperCase()}
                              </div>
                            )}
                            <pre className="p-3 bg-claude-bg m-0 whitespace-pre-wrap break-words">
                              <code className="text-xs font-mono text-claude-text" {...props}>
                                {children}
                              </code>
                            </pre>
                          </div>
                        );
                      }

                      // Inline code
                      return (
                        <code
                          className="px-1 py-0.5 text-xs font-mono bg-claude-surface text-claude-accent"
                          style={{ borderRadius: 0 }}
                          {...props}
                        >
                          {children}
                        </code>
                      );
                    },
                    // Style paragraphs
                    p({ children }) {
                      return <p className="my-1 leading-relaxed">{children}</p>;
                    },
                    // Style lists
                    ul({ children }) {
                      return <ul className="my-1 ml-4 list-disc">{children}</ul>;
                    },
                    ol({ children }) {
                      return <ol className="my-1 ml-4 list-decimal">{children}</ol>;
                    },
                    li({ children }) {
                      return <li className="my-0.5">{children}</li>;
                    },
                    // Style headings
                    h1({ children }) {
                      return <h1 className="text-lg font-bold mt-3 mb-1">{children}</h1>;
                    },
                    h2({ children }) {
                      return <h2 className="text-base font-bold mt-2 mb-1">{children}</h2>;
                    },
                    h3({ children }) {
                      return <h3 className="text-sm font-bold mt-2 mb-1">{children}</h3>;
                    },
                    // Style links
                    a({ href, children }) {
                      return (
                        <a href={href} className="text-claude-accent underline hover:no-underline">
                          {children}
                        </a>
                      );
                    },
                    // Style blockquotes
                    blockquote({ children }) {
                      return (
                        <blockquote className="border-l-2 border-claude-accent pl-3 my-2 text-claude-text-secondary">
                          {children}
                        </blockquote>
                      );
                    },
                    // Style strong/bold
                    strong({ children }) {
                      return <strong className="font-bold text-claude-text">{children}</strong>;
                    },
                    // Style emphasis/italic
                    em({ children }) {
                      return <em className="italic">{children}</em>;
                    },
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
            )}

            {/* Render tool calls from the structured array */}
            {toolCalls.map((toolCall) => (
              <ToolCallCard key={toolCall.id} toolCall={toolCall} />
            ))}
          </div>
        )}

        {/* Timestamp */}
        <div
          className={`text-[10px] mt-1 font-mono text-claude-text-secondary ${isUser ? 'text-right' : ''}`}
        >
          {isStreaming ? (
            <span className="flex items-center gap-1">
              <span
                className="inline-block w-1.5 h-1.5 animate-pulse bg-claude-accent"
                style={{ borderRadius: 0 }}
              />
              <span style={{ letterSpacing: '0.05em' }}>TYPING...</span>
            </span>
          ) : (
            <span style={{ letterSpacing: '0.02em' }}>{formatTime(message.timestamp)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTime(date: Date): string {
  return new Date(date).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}
