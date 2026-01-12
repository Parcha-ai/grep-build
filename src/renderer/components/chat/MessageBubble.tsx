import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ToolCallCard from './ToolCallCard';
import { SpeakerButton } from './SpeakerButton';
import { useEditorStore } from '../../stores/editor.store';
import type { ChatMessage, ToolCall } from '../../../shared/types';

// Regex to match file paths with optional line numbers
// Matches: /path/to/file.ext or /path/to/file.ext:123
const FILE_PATH_REGEX = /(\/(?:Users|home|var|etc|opt|tmp|usr|app|src|lib|pkg|workspace)[^\s:,;)}\]"'`<>]*\.[a-zA-Z0-9]+(?::\d+)?)/g;

interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
  streamingToolCalls?: ToolCall[];
  isLatestMessage?: boolean; // True only for the most recent message in the conversation
}

function MessageBubble({ message, isStreaming, streamingToolCalls, isLatestMessage = false }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const openFile = useEditorStore((state) => state.openFile);

  // Use streaming tool calls if provided, otherwise use message.toolCalls
  const toolCalls = streamingToolCalls || message.toolCalls || [];

  // Check if this is a tool-only message (no text content)
  const isToolOnlyMessage = !message.content && toolCalls.length > 0;

  return (
    <div className="flex gap-2 min-w-0">
      {/* Content */}
      <div className="flex-1 min-w-0">
        {isUser ? (
          // User messages - left border accent with subtle background
          <div className="border-l-2 border-blue-500 pl-3 py-1 bg-blue-500/5">
            <p className="whitespace-pre-wrap text-claude-text font-mono text-base">
              {message.content}
            </p>
          </div>
        ) : (
          // Assistant messages - tools → content
          <div className="space-y-2">
            {/* Interrupted indicator */}
            {message.interrupted && (
              <div className="flex items-center gap-2 px-2 py-1 bg-amber-500/10 border-l-2 border-amber-500 text-amber-400 text-xs font-mono">
                <span style={{ letterSpacing: '0.05em' }}>INTERRUPTED</span>
              </div>
            )}

            {/* Tool calls execute (during action) */}
            {toolCalls.map((toolCall, index) => (
              <ToolCallCard
                key={toolCall.id}
                toolCall={toolCall}
                isLatestToolCall={isLatestMessage && index === toolCalls.length - 1}
                isStreaming={isStreaming}
              />
            ))}

            {/* Final content streams last (summary/response) */}
            {message.content && (
              <div className="relative group">
                {/* Speaker button - top right, brutalist style */}
                <div className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                  <SpeakerButton
                    messageId={message.id}
                    text={message.content}
                  />
                </div>
                <div className="prose prose-invert max-w-none font-mono text-claude-text pr-12 break-words" style={{ overflowWrap: 'anywhere' }}>
                  <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
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
                                className="px-2 py-1 text-xs font-bold font-mono bg-claude-surface border-b border-claude-border text-claude-text-secondary"
                                style={{ letterSpacing: '0.05em' }}
                              >
                                {match[1].toUpperCase()}
                              </div>
                            )}
                            <pre className="p-3 bg-claude-bg m-0 whitespace-pre-wrap break-words">
                              <code className="text-sm font-mono text-claude-text" {...props}>
                                {children}
                              </code>
                            </pre>
                          </div>
                        );
                      }

                      // Inline code - check if it's a file path
                      const codeText = String(children);
                      const isFilePath = FILE_PATH_REGEX.test(codeText);
                      FILE_PATH_REGEX.lastIndex = 0; // Reset regex

                      if (isFilePath) {
                        // Parse the file path with optional line number
                        const lineMatch = codeText.match(/:(\d+)$/);
                        const filePath = lineMatch ? codeText.slice(0, -lineMatch[0].length) : codeText;
                        const lineNumber = lineMatch ? parseInt(lineMatch[1], 10) : undefined;
                        const fileName = filePath.split('/').pop() || filePath;

                        return (
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openFile(filePath, lineNumber);
                            }}
                            className="px-1 py-0.5 text-sm font-mono bg-claude-surface text-cyan-400 hover:text-cyan-300 hover:bg-claude-surface/80 cursor-pointer"
                            style={{ borderRadius: 0 }}
                            title={`Open ${filePath}${lineNumber ? ` at line ${lineNumber}` : ''}`}
                          >
                            {fileName}{lineNumber ? `:${lineNumber}` : ''}
                          </button>
                        );
                      }

                      return (
                        <code
                          className="px-1 py-0.5 text-sm font-mono bg-claude-surface text-claude-accent"
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
                      return <ul className="my-1 ml-6 pl-0 list-disc list-outside">{children}</ul>;
                    },
                    ol({ children }) {
                      return <ol className="my-1 ml-6 pl-0 list-decimal list-outside">{children}</ol>;
                    },
                    li({ children }) {
                      return <li className="my-0.5 ml-0 pl-1">{children}</li>;
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
                        <a
                          href={href}
                          onClick={(e) => {
                            e.preventDefault();
                            if (href) {
                              window.electronAPI.app.openExternal(href);
                            }
                          }}
                          className="text-claude-accent underline hover:no-underline cursor-pointer"
                        >
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
                    // Style tables
                    table({ children }) {
                      return (
                        <div className="my-2 overflow-x-auto">
                          <table className="min-w-full border border-claude-border" style={{ borderRadius: 0 }}>
                            {children}
                          </table>
                        </div>
                      );
                    },
                    thead({ children }) {
                      return <thead className="bg-claude-surface">{children}</thead>;
                    },
                    tbody({ children }) {
                      return <tbody>{children}</tbody>;
                    },
                    tr({ children }) {
                      return <tr className="border-b border-claude-border">{children}</tr>;
                    },
                    th({ children }) {
                      return (
                        <th className="px-3 py-2 text-left text-sm font-bold border-r border-claude-border last:border-r-0">
                          {children}
                        </th>
                      );
                    },
                    td({ children }) {
                      return (
                        <td className="px-3 py-2 text-sm border-r border-claude-border last:border-r-0">
                          {children}
                        </td>
                      );
                    },
                  }}
                >
                  {message.content}
                </ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Timestamp - hide for tool-only messages to keep UI clean */}
        {!isToolOnlyMessage && (
          <div
            className={`text-xs mt-1 font-mono text-claude-text-secondary ${isUser ? 'text-right' : ''}`}
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
        )}
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

// Memoize to prevent unnecessary re-renders when props haven't changed
export default React.memo(MessageBubble);
