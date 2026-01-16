import React, { useCallback, useEffect, useRef } from 'react';
import { Mic, Loader2 } from 'lucide-react';
import { useVoiceConversation } from '../../hooks/useVoiceConversation';
import { useAudioStore } from '../../stores/audio.store';
import { useSessionStore } from '../../stores/session.store';

// Stable empty array references outside component to prevent infinite re-renders
const EMPTY_MESSAGES: never[] = [];
const EMPTY_TOOL_CALLS: never[] = [];

// Debounce helper
function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delay: number
): (...args: Args) => void {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const debouncedFn = useCallback((...args: Args) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      callbackRef.current(...args);
    }, delay);
  }, [delay]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return debouncedFn;
}

interface MicrophoneButtonProps {
  sessionId: string;
  onTranscriptionComplete?: (text: string) => void;
  onInterimTranscript?: (text: string) => void;
  disabled?: boolean;
}

/**
 * Microphone Button - Toggles ElevenLabs Voice Mode
 *
 * Click: Toggle voice mode on/off
 * When on, the InputArea shows voice mode UI
 */
export const MicrophoneButton: React.FC<MicrophoneButtonProps> = ({
  sessionId,
  onTranscriptionComplete,
  disabled = false,
}) => {
  const {
    settings: audioSettings,
    voiceModeStates,
    setVoiceModeConnecting,
    setVoiceModeConnected,
    setVoiceModeDisconnected,
    setVoiceModeSpeaking,
    setVoiceModeTranscript,
    setVoiceModeAgentResponse,
    setVoiceModeError,
    setAudioMode,
  } = useAudioStore();

  const agentId = audioSettings?.elevenLabsAgentId || 'agent_8101kf1x665ve49b9zy8jbtvhq12';
  const voiceState = voiceModeStates[sessionId];
  const isConnected = voiceState?.isConnected || false;
  const isConnecting = voiceState?.isConnecting || false;

  // Get session context for ElevenLabs agent
  // Use stable empty array reference to avoid infinite re-renders
  const messages = useSessionStore((state) => state.messages[sessionId]) || EMPTY_MESSAGES;
  const session = useSessionStore((state) => state.sessions.find(s => s.id === sessionId));
  const isStreaming = useSessionStore((state) => !!state.isStreaming[sessionId]);

  // Subscribe to thinking content for incremental updates
  // Use stable references for empty values to prevent infinite re-renders
  const currentThinkingContent = useSessionStore((state) => state.currentThinkingContent[sessionId] || '');
  const currentToolCalls = useSessionStore((state) => state.currentToolCalls[sessionId] || EMPTY_TOOL_CALLS);

  // Generate context summary for ElevenLabs agent
  const generateContextSummary = useCallback(() => {
    const recentMessages = messages.slice(-5);
    const messageSummary = recentMessages
      .map(m => `${m.role}: ${(m.content as string)?.slice(0, 100) || '[tool/media content]'}`)
      .join('\n');

    return `Current Grep Session Context:
- Working directory: ${session?.repoPath || 'unknown'}
- Branch: ${session?.branch || 'unknown'}
- Session state: ${isStreaming ? 'Currently working on a task' : 'Idle, waiting for input'}
- Recent conversation:
${messageSummary || 'No messages yet'}`;
  }, [messages, session, isStreaming]);

  const {
    isConnected: hookConnected,
    isConnecting: hookConnecting,
    isSpeaking,
    currentTranscript,
    error,
    connect,
    disconnect,
    startRecording,
    updateContext,
  } = useVoiceConversation({
    agentId,
    sessionId,
    onTranscript: (text, isFinal) => {
      // Update store with transcript
      setVoiceModeTranscript(sessionId, text);

      // When final, send DIRECTLY to Grep and notify ElevenLabs
      if (isFinal && text.trim()) {
        // Send directly to Grep/Agent SDK
        onTranscriptionComplete?.(text);

        // Notify ElevenLabs that task was submitted (so it can say "On it")
        updateContext(`User request submitted to Grep: "${text.trim()}"\nStatus: Processing request...`);
      }
    },
    onClaudeResponse: (text) => {
      // Update store with agent response
      setVoiceModeAgentResponse(sessionId, text);
      console.log('[MicrophoneButton] Agent response:', text.slice(0, 50));
    },
    onError: (error) => {
      console.error('[MicrophoneButton] Voice error:', error);
      setVoiceModeError(sessionId, error);
    },
  });

  // Sync hook state to store
  useEffect(() => {
    if (hookConnecting && !isConnecting) {
      setVoiceModeConnecting(sessionId);
    }
  }, [hookConnecting, isConnecting, sessionId, setVoiceModeConnecting]);

  useEffect(() => {
    if (hookConnected && !isConnected) {
      setVoiceModeConnected(sessionId);
      setAudioMode(sessionId, true);
    } else if (!hookConnected && isConnected) {
      setVoiceModeDisconnected(sessionId);
    }
  }, [hookConnected, isConnected, sessionId, setVoiceModeConnected, setVoiceModeDisconnected, setAudioMode]);

  useEffect(() => {
    setVoiceModeSpeaking(sessionId, isSpeaking);
  }, [isSpeaking, sessionId, setVoiceModeSpeaking]);

  useEffect(() => {
    if (currentTranscript) {
      setVoiceModeTranscript(sessionId, currentTranscript);
    }
  }, [currentTranscript, sessionId, setVoiceModeTranscript]);

  useEffect(() => {
    if (error) {
      setVoiceModeError(sessionId, error);
    }
  }, [error, sessionId, setVoiceModeError]);

  // Ref to hold generateContextSummary to avoid dependency issues
  const generateContextRef = useRef(generateContextSummary);
  generateContextRef.current = generateContextSummary;

  // Send initial context when connected
  useEffect(() => {
    console.log('[MicrophoneButton] Connection effect fired, hookConnected:', hookConnected);
    if (hookConnected) {
      const context = generateContextRef.current();
      console.log('[MicrophoneButton] Sending initial context, preview:', context.slice(0, 100));
      updateContext(context);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hookConnected]);

  // Helper to summarize assistant response for voice announcements
  const summarizeForVoice = useCallback((content: unknown): string => {
    if (typeof content !== 'string') return 'Task completed';

    // Check for common patterns in Claude responses
    if (content.includes('Created') || content.includes('created')) {
      const match = content.match(/[Cc]reated?\s+(?:file\s+)?[`"]?([^`"\n]+)[`"]?/);
      if (match) return `Created ${match[1]}`;
    }
    if (content.includes('Updated') || content.includes('updated') || content.includes('Modified') || content.includes('modified')) {
      return 'Made the changes';
    }
    if (content.includes('Done') || content.includes('done') || content.includes('Complete') || content.includes('complete')) {
      return 'Done';
    }
    if (content.includes('Error') || content.includes('error') || content.includes('failed')) {
      return 'Encountered an issue';
    }

    // Truncate to first sentence/line if nothing specific found
    const firstLine = content.split('\n')[0].slice(0, 100);
    return firstLine.length < content.length ? firstLine + '...' : firstLine;
  }, []);

  // Helper to extract meaningful updates from thinking content
  const summarizeThinkingForVoice = useCallback((thinkingContent: string, toolCalls: typeof currentToolCalls): string | null => {
    // Extract the last meaningful portion of thinking
    const lines = thinkingContent.split('\n').filter(l => l.trim());
    if (lines.length === 0) return null;

    // Check for tool calls in progress
    if (toolCalls.length > 0) {
      const lastTool = toolCalls[toolCalls.length - 1];
      const toolName = lastTool.name?.toLowerCase() || '';

      // Map tool names to voice-friendly descriptions
      if (toolName.includes('read')) {
        const file = lastTool.input?.file_path || lastTool.input?.path || 'a file';
        return `Reading ${typeof file === 'string' ? file.split('/').pop() : 'file'}`;
      }
      if (toolName.includes('write')) {
        const file = lastTool.input?.file_path || lastTool.input?.path || 'a file';
        return `Writing to ${typeof file === 'string' ? file.split('/').pop() : 'file'}`;
      }
      if (toolName.includes('edit')) {
        const file = lastTool.input?.file_path || 'a file';
        return `Editing ${typeof file === 'string' ? file.split('/').pop() : 'file'}`;
      }
      if (toolName.includes('bash') || toolName.includes('command')) {
        return 'Running a command';
      }
      if (toolName.includes('glob') || toolName.includes('grep') || toolName.includes('search')) {
        return 'Searching the codebase';
      }
      if (toolName.includes('task') || toolName.includes('agent')) {
        return 'Spawning a sub-agent';
      }

      return `Using ${toolName}`;
    }

    // Look for patterns in thinking text (last 500 chars to keep it recent)
    const recentThinking = thinkingContent.slice(-500);

    // Common thinking patterns
    if (recentThinking.includes('let me') || recentThinking.includes("Let me")) {
      const match = recentThinking.match(/[Ll]et me ([^.!?\n]{10,50})/);
      if (match) return match[1].trim();
    }
    if (recentThinking.includes('I\'ll') || recentThinking.includes("I will")) {
      const match = recentThinking.match(/I(?:'ll| will) ([^.!?\n]{10,50})/);
      if (match) return match[1].trim();
    }
    if (recentThinking.includes('Looking') || recentThinking.includes('looking')) {
      return 'Analyzing the code';
    }
    if (recentThinking.includes('need to') || recentThinking.includes('Need to')) {
      const match = recentThinking.match(/[Nn]eed to ([^.!?\n]{10,50})/);
      if (match) return match[1].trim();
    }

    return null;
  }, []);

  // Send context updates when messages change (Grep responded)
  const prevMessagesLengthRef = useRef(messages.length);
  useEffect(() => {
    // Only send update if messages actually changed (not on initial render)
    if (hookConnected && messages.length > 0 && messages.length !== prevMessagesLengthRef.current) {
      const lastMessage = messages[messages.length - 1];

      // If Grep (assistant) responded, send a progress update
      if (lastMessage?.role === 'assistant') {
        const summary = summarizeForVoice(lastMessage.content);
        console.log('[MicrophoneButton] Grep responded, sending progress update:', summary);
        updateContext(`Grep update: ${summary}\nStatus: ${isStreaming ? 'Still working...' : 'Ready for next request'}`);
      } else {
        // User message - just update context
        console.log('[MicrophoneButton] Messages changed, sending context update');
        const context = generateContextRef.current();
        console.log('[MicrophoneButton] Context preview:', context.slice(0, 100));
        updateContext(context);
      }
    }
    prevMessagesLengthRef.current = messages.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hookConnected, messages.length, isStreaming, summarizeForVoice]);

  // Track last sent thinking summary to avoid duplicates
  const lastSentThinkingRef = useRef<string | null>(null);

  // Debounced function to send thinking updates
  const sendThinkingUpdate = useDebouncedCallback((thinking: string, tools: typeof currentToolCalls) => {
    if (!hookConnected || !isStreaming) return;

    const summary = summarizeThinkingForVoice(thinking, tools);
    if (summary && summary !== lastSentThinkingRef.current) {
      console.log('[MicrophoneButton] Sending thinking update:', summary);
      lastSentThinkingRef.current = summary;
      updateContext(`Grep progress: ${summary}`);
    }
  }, 1500); // Debounce to 1.5s to avoid spamming ElevenLabs

  // Send incremental thinking updates while streaming
  useEffect(() => {
    if (hookConnected && isStreaming && (currentThinkingContent || currentToolCalls.length > 0)) {
      sendThinkingUpdate(currentThinkingContent, currentToolCalls);
    }

    // Reset tracking when streaming ends
    if (!isStreaming) {
      lastSentThinkingRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hookConnected, isStreaming, currentThinkingContent, currentToolCalls.length]);

  const handleClick = useCallback(async () => {
    if (isConnected) {
      // Disconnect voice mode
      await disconnect();
      setVoiceModeDisconnected(sessionId);
      setAudioMode(sessionId, false);
    } else if (!isConnecting) {
      // Connect to voice mode
      try {
        setVoiceModeConnecting(sessionId);
        await connect();
        // Start recording immediately after connecting
        setTimeout(async () => {
          await startRecording();
        }, 100);
      } catch (e) {
        console.error('[MicrophoneButton] Failed to connect:', e);
        setVoiceModeError(sessionId, e instanceof Error ? e.message : 'Failed to connect');
      }
    }
  }, [isConnected, isConnecting, connect, disconnect, startRecording, sessionId,
      setVoiceModeConnecting, setVoiceModeDisconnected, setVoiceModeError, setAudioMode]);

  const getStatusColor = () => {
    if (error || voiceState?.error) return 'text-red-500';
    if (isConnected) return 'text-green-500 hover:text-red-400'; // Green when on, hover shows it will turn off
    if (isConnecting) return 'text-yellow-500';
    return 'text-claude-text-secondary hover:text-claude-accent';
  };

  const getTitle = () => {
    if (error || voiceState?.error) return `Error: ${error || voiceState?.error}`;
    if (isConnecting) return 'Connecting to voice mode...';
    if (isConnected) return 'Voice mode ON - Click to turn off';
    return 'Click to start voice mode';
  };

  const renderIcon = () => {
    if (isConnecting) {
      return <Loader2 className="w-4 h-4 animate-spin" />;
    }

    if (isConnected) {
      return (
        <div className="relative">
          <Mic className="w-4 h-4" />
          <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
        </div>
      );
    }

    return <Mic className="w-4 h-4" />;
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled || isConnecting}
      className={`
        relative p-1 transition-all duration-200
        ${getStatusColor()}
        ${disabled || isConnecting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
      style={{ borderRadius: 0 }}
      title={getTitle()}
    >
      {renderIcon()}
    </button>
  );
};
