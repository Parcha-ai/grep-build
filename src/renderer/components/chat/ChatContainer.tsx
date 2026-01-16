import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSessionStore } from '../../stores/session.store';
import { useAudioStore } from '../../stores/audio.store';
import MessageList from './MessageList';
import InputArea from './InputArea';
import PermissionDialog from './PermissionDialog';
import QuestionDialog from './QuestionDialog';
import ThinkingBlock from './ThinkingBlock';
import CompactionBar from './CompactionBar';
import { SoundVisualization } from './SoundVisualization';
import { ArrowDown } from 'lucide-react';
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
    compactionStatus,
  } = useSessionStore();
  const { audioModeActive, ttsStates } = useAudioStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [hasNewContent, setHasNewContent] = useState(false);
  const lastMessageCountRef = useRef(0);

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
  const currentCompactionStatus = compactionStatus[session.id] || null;

  // Check if any TTS is actively playing for messages in this session
  const isTTSPlaying = sessionMessages.some(msg => ttsStates[msg.id]?.isPlaying);

  useEffect(() => {
    const unsubscribe = subscribeToClaude();
    return unsubscribe;
  }, [subscribeToClaude]);

  // Check if user is at bottom of chat
  const checkIfAtBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return true;

    const threshold = 100; // pixels from bottom to consider "at bottom"
    const isBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    setIsAtBottom(isBottom);
    setShowScrollButton(!isBottom);
    return isBottom;
  }, []);

  // Handle scroll events
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      checkIfAtBottom();
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [checkIfAtBottom]);

  // Auto-scroll only if user is at bottom
  useEffect(() => {
    if (isAtBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      setHasNewContent(false); // Clear new content flag when at bottom
    } else {
      // Check if we got new content while scrolled up
      const currentCount = sessionMessages.length;
      if (currentCount > lastMessageCountRef.current || streamContent || thinkingContent) {
        setHasNewContent(true);
      }
    }
    lastMessageCountRef.current = sessionMessages.length;
  }, [sessionMessages, streamContent, thinkingContent, streamingToolCalls, isAtBottom]);

  // Scroll to bottom function for FAB
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setIsAtBottom(true);
    setShowScrollButton(false);
    setHasNewContent(false);
  }, []);

  return (
    <div className="flex-1 flex flex-col overflow-hidden font-mono bg-claude-bg min-w-0">
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
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 relative">
        <MessageList
          messages={sessionMessages}
          isStreaming={isSessionStreaming}
          streamEvents={sessionStreamEvents}
          streamContent={streamContent}
          streamingToolCalls={streamingToolCalls}
          currentToolCalls={streamingToolCalls}
        />

        <div ref={messagesEndRef} />

        {/* Floating action button to scroll to bottom - brutalist terminal style */}
        {showScrollButton && (
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-50">
            <button
              onClick={scrollToBottom}
              className={`px-4 py-2 border-2 border-claude-accent bg-claude-surface hover:bg-claude-surface-hover text-claude-accent transition-all flex items-center gap-2 ${
                hasNewContent ? 'animate-pulse shadow-lg shadow-claude-accent/50' : ''
              }`}
              style={{ borderRadius: 0 }}
              title="Scroll to bottom"
            >
              <span className="text-xs font-bold uppercase" style={{ letterSpacing: '0.05em' }}>
                {hasNewContent ? 'NEW' : '▼'}
              </span>
              <ArrowDown size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Active thinking section - separate from message history */}
      {isSessionStreaming && thinkingContent && (
        <div className="border-t border-claude-border bg-claude-surface/30 px-4 py-2">
          <ThinkingBlock content={thinkingContent} isStreaming={true} />
        </div>
      )}

      {/* Smart Compact / Compaction status bar */}
      {currentCompactionStatus && currentCompactionStatus.isCompacting && (
        <CompactionBar status={currentCompactionStatus} />
      )}

      {/* Permission request - prominent above input */}
      {currentPermissionRequest && (
        <div className="border-t border-claude-border px-4 py-3 bg-claude-surface">
          <PermissionDialog
            request={currentPermissionRequest}
            onApprove={(modifiedInput) => approvePermission(session.id, modifiedInput)}
            onDeny={() => denyPermission(session.id)}
          />
        </div>
      )}

      {/* Question request - prominent above input */}
      {currentQuestionRequest && (
        <div className="border-t border-claude-border px-4 py-3 bg-claude-surface">
          <QuestionDialog
            request={currentQuestionRequest}
            onAnswer={(answers) => answerQuestion(session.id, answers)}
          />
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
