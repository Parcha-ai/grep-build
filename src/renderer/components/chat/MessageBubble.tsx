import React, { useMemo } from 'react';
import { User, Bot } from 'lucide-react';
import ToolCallCard from './ToolCallCard';
import { parseMessageContent, type MessagePart } from '../../utils/messageParser';
import type { ChatMessage, ToolCall } from '../../../shared/types';

interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
  streamingToolCalls?: ToolCall[];
}

export default function MessageBubble({ message, isStreaming, streamingToolCalls }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  // Parse text content for code blocks (no longer extracting tool calls from text)
  const parsedParts = useMemo(() => {
    if (isUser || !message.content) {
      return message.content ? [{ type: 'text' as const, content: message.content }] : [];
    }
    return parseMessageContent(message.content);
  }, [message.content, isUser]);

  // Use streaming tool calls if provided, otherwise use message.toolCalls
  const toolCalls = streamingToolCalls || message.toolCalls || [];

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
          isUser ? 'bg-blue-600' : 'bg-claude-accent'
        }`}
      >
        {isUser ? (
          <User size={16} className="text-white" />
        ) : (
          <Bot size={16} className="text-white" />
        )}
      </div>

      {/* Content */}
      <div className={`flex-1 max-w-[85%] ${isUser ? 'text-right' : ''}`}>
        {isUser ? (
          // User messages - simple bubble
          <div className="inline-block rounded-xl px-4 py-3 bg-blue-600 text-white">
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        ) : (
          // Assistant messages - text content + tool calls
          <div className="space-y-2">
            {/* Render text/code content */}
            {parsedParts.map((part, index) => (
              <MessagePartRenderer key={`part-${index}`} part={part} />
            ))}

            {/* Render tool calls from the structured array */}
            {toolCalls.map((toolCall) => (
              <ToolCallCard key={toolCall.id} toolCall={toolCall} />
            ))}
          </div>
        )}

        {/* Timestamp */}
        <div
          className={`text-xs text-claude-text-secondary mt-1 ${isUser ? 'text-right' : ''}`}
        >
          {isStreaming ? (
            <span className="flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-claude-accent animate-pulse" />
              Typing...
            </span>
          ) : (
            formatTime(message.timestamp)
          )}
        </div>
      </div>
    </div>
  );
}

function MessagePartRenderer({ part }: { part: MessagePart }) {
  switch (part.type) {
    case 'text':
      return <TextContent content={part.content} />;
    case 'code_block':
      return <CodeBlock language={part.language} code={part.code} />;
    default:
      return null;
  }
}

function TextContent({ content }: { content: string }) {
  // Parse inline code and basic formatting
  const parts = content.split(/(`[^`]+`)/g);

  return (
    <div className="text-claude-text leading-relaxed">
      {parts.map((part, index) => {
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code
              key={index}
              className="bg-claude-surface px-1.5 py-0.5 rounded text-sm font-mono text-claude-accent"
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        // Handle line breaks
        return (
          <span key={index}>
            {part.split('\n').map((line, lineIndex, arr) => (
              <React.Fragment key={lineIndex}>
                {line}
                {lineIndex < arr.length - 1 && <br />}
              </React.Fragment>
            ))}
          </span>
        );
      })}
    </div>
  );
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  return (
    <div className="rounded-lg overflow-hidden border border-claude-border">
      {language && (
        <div className="bg-claude-surface px-3 py-1.5 text-xs text-claude-text-secondary border-b border-claude-border">
          {language}
        </div>
      )}
      <pre className="bg-claude-bg p-3 overflow-x-auto">
        <code className="text-sm font-mono text-claude-text">{code}</code>
      </pre>
    </div>
  );
}

function formatTime(date: Date): string {
  return new Date(date).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}
