import React, { useEffect, useRef } from 'react';
import { useSessionStore } from '../../stores/session.store';
import { useAudioStore } from '../../stores/audio.store';
import MessageList from './MessageList';
import InputArea from './InputArea';
import PermissionDialog from './PermissionDialog';
import QuestionDialog from './QuestionDialog';
import ThinkingBlock from './ThinkingBlock';
import { SoundVisualization } from './SoundVisualization';
import type { Session } from '../../../shared/types';

interface ChatContainerProps {
  session: Session;
}

export default function ChatContainer({ session }: ChatContainerProps) {
  const {
    messages,
    isStreaming,
    streamEvents,
    currentStreamContent,
    currentThinkingContent,
    currentToolCalls,
    currentSystemInfo,
    pendingPermission,
    approvePermission,
    denyPermission,
    pendingQuestion,
    answerQuestion,
    subscribeToClaude,
  } = useSessionStore();
  const { audioModeActive, ttsStates } = useAudioStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const sessionMessages = messages[session.id] || [];
  const isSessionStreaming = isStreaming[session.id] || false;
  const sessionStreamEvents = streamEvents[session.id] || [];
  const streamContent = currentStreamContent[session.id] || '';
  const thinkingContent = currentThinkingContent[session.id] || '';
  const streamingToolCalls = currentToolCalls[session.id] || [];
  const systemInfo = currentSystemInfo[session.id] || null;
  const isAudioMode = audioModeActive[session.id] || false;
  const currentPermissionRequest = pendingPermission[session.id] || null;
  const currentQuestionRequest = pendingQuestion[session.id] || null;

  // Check if any TTS is actively playing for messages in this session
  const isTTSPlaying = sessionMessages.some(msg => ttsStates[msg.id]?.isPlaying);

  useEffect(() => {
    const unsubscribe = subscribeToClaude();
    return unsubscribe;
  }, [subscribeToClaude]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessionMessages, streamContent, thinkingContent, streamingToolCalls]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden font-mono bg-claude-bg">
      {/* Header - brutalist */}
      <div className="h-10 border-b border-claude-border flex items-center justify-between px-4 bg-claude-surface/50">
        <div className="flex items-center">
          <h2 className="text-sm font-bold text-claude-text uppercase" style={{ letterSpacing: '0.1em' }}>
            {session.name}
          </h2>
          {session.status === 'running' && (
            <span
              className="ml-2 px-1.5 py-0.5 text-xs font-bold uppercase bg-green-500/20 text-green-500"
              style={{ borderRadius: 0, letterSpacing: '0.05em' }}
            >
              ACTIVE
            </span>
          )}
        </div>

        {/* Audio visualization - shows when in audio mode and working/speaking */}
        {isAudioMode && (isSessionStreaming || isTTSPlaying) && (
          <div className="flex items-center gap-2">
            <SoundVisualization
              isActive={true}
              variant="bars"
              size="sm"
            />
            <span className="text-xs text-blue-400 uppercase font-bold" style={{ letterSpacing: '0.05em' }}>
              {isTTSPlaying ? 'SPEAKING' : 'THINKING'}
            </span>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <MessageList
          messages={sessionMessages}
          isStreaming={isSessionStreaming}
          streamEvents={sessionStreamEvents}
          streamContent={streamContent}
          streamingToolCalls={streamingToolCalls}
          currentToolCalls={streamingToolCalls}
        />

        {/* Permission request - inline at end of chat */}
        {currentPermissionRequest && (
          <div className="px-4 py-2">
            <PermissionDialog
              request={currentPermissionRequest}
              onApprove={(modifiedInput) => approvePermission(session.id, modifiedInput)}
              onDeny={() => denyPermission(session.id)}
            />
          </div>
        )}

        {/* Question request - inline at end of chat */}
        {currentQuestionRequest && (
          <div className="px-4 py-2">
            <QuestionDialog
              request={currentQuestionRequest}
              onAnswer={(answers) => answerQuestion(session.id, answers)}
            />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Active thinking section - separate from message history */}
      {isSessionStreaming && thinkingContent && (
        <div className="border-t border-claude-border bg-claude-surface/30 px-4 py-2">
          <ThinkingBlock content={thinkingContent} isStreaming={true} />
        </div>
      )}

      {/* Input */}
      <InputArea
        sessionId={session.id}
        disabled={session.status !== 'running'}
        systemInfo={systemInfo}
        isStreaming={isSessionStreaming}
      />
    </div>
  );
}
