import React, { useEffect, useRef } from 'react';
import { useSessionStore } from '../../stores/session.store';
import MessageList from './MessageList';
import InputArea from './InputArea';
import type { Session } from '../../../shared/types';

interface ChatContainerProps {
  session: Session;
}

export default function ChatContainer({ session }: ChatContainerProps) {
  const { messages, isStreaming, currentStreamContent, currentToolCalls, subscribeToClaude } =
    useSessionStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const sessionMessages = messages[session.id] || [];
  const isSessionStreaming = isStreaming[session.id] || false;
  const streamContent = currentStreamContent[session.id] || '';
  const streamingToolCalls = currentToolCalls[session.id] || [];

  useEffect(() => {
    const unsubscribe = subscribeToClaude();
    return unsubscribe;
  }, [subscribeToClaude]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessionMessages, streamContent, streamingToolCalls]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="h-12 border-b border-claude-border flex items-center px-4">
        <h2 className="font-medium">{session.name}</h2>
        {session.status === 'running' && (
          <span className="ml-2 px-2 py-0.5 text-xs bg-green-500/20 text-green-500 rounded">
            Running
          </span>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <MessageList
          messages={sessionMessages}
          isStreaming={isSessionStreaming}
          streamContent={streamContent}
          streamingToolCalls={streamingToolCalls}
        />
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <InputArea sessionId={session.id} disabled={session.status !== 'running'} />
    </div>
  );
}
