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

  // Subscribe to thinking content and assistant text for incremental updates
  // Use stable references for empty values to prevent infinite re-renders
  const currentThinkingContent = useSessionStore((state) => state.currentThinkingContent[sessionId] || '');
  const currentStreamContent = useSessionStore((state) => state.currentStreamContent[sessionId] || '');
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
    speak,
  } = useVoiceConversation({
    agentId,
    sessionId,
    // No systemPrompt - use agent's main prompt configured via ElevenLabs API
    // This allows us to update the prompt via API without code changes
    onTranscript: (text, isFinal) => {
      // Update store with transcript for display
      setVoiceModeTranscript(sessionId, text);
      // Note: We no longer send directly to Grep here.
      // ElevenLabs agent decides when to call the execute_grep_command tool.
      if (isFinal && text.trim()) {
        console.log('[MicrophoneButton] Final transcript received, waiting for tool call:', text.slice(0, 50));
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
    // Handle tool calls from ElevenLabs agent
    onToolCall: async (toolCall) => {
      console.log('[MicrophoneButton] Tool call received:', toolCall.toolName, toolCall.parameters);

      if (toolCall.toolName === 'execute_grep_command') {
        const instruction = toolCall.parameters.instruction as string;
        if (instruction) {
          console.log('[MicrophoneButton] Executing Grep command:', instruction.slice(0, 100));

          // Send to Grep/Agent SDK
          onTranscriptionComplete?.(instruction);

          // Return a clear "in progress" response
          return `TASK SUBMITTED. Grep is now working on: "${instruction.slice(0, 50)}...". Call get_task_status every 5-10 seconds to check progress and announce what Grep is doing.`;
        }
        return 'No instruction provided';
      }

      // Status polling tool - agent calls this to get latest updates
      if (toolCall.toolName === 'get_task_status') {
        const currentState = useSessionStore.getState();
        const sessionIsStreaming = currentState.isStreaming[sessionId];
        const thinking = currentState.currentThinkingContent[sessionId] || '';
        const streamContent = currentState.currentStreamContent[sessionId] || '';
        const toolCalls = currentState.currentToolCalls[sessionId] || [];
        const sessionMessages = currentState.messages[sessionId] || [];

        // Get latest tool call for context
        const latestToolCall = toolCalls.length > 0 ? toolCalls[toolCalls.length - 1] : null;
        let currentAction = 'Processing';
        if (latestToolCall) {
          const toolName = latestToolCall.name?.toLowerCase() || '';
          if (toolName.includes('read')) currentAction = `Reading ${latestToolCall.input?.file_path || 'a file'}`;
          else if (toolName.includes('write')) currentAction = `Writing to ${latestToolCall.input?.file_path || 'a file'}`;
          else if (toolName.includes('edit')) currentAction = `Editing ${latestToolCall.input?.file_path || 'a file'}`;
          else if (toolName.includes('bash')) currentAction = 'Running a command';
          else if (toolName.includes('glob') || toolName.includes('grep')) currentAction = 'Searching the codebase';
          else if (toolName.includes('task')) currentAction = 'Working with a sub-agent';
          else currentAction = `Using ${toolName}`;
        }

        // Extract latest thinking sentence
        const thinkingSentences = thinking.split(/[.!?]\s+/).filter(s => s.trim().length > 10);
        const latestThinking = thinkingSentences.length > 0 ? thinkingSentences[thinkingSentences.length - 1].slice(0, 100) : '';

        if (sessionIsStreaming) {
          return JSON.stringify({
            status: 'working',
            currentAction: currentAction,
            latestThought: latestThinking,
            toolCallCount: toolCalls.length,
            message: `Grep is currently ${currentAction.toLowerCase()}. ${latestThinking ? `Thinking: "${latestThinking}..."` : ''}`
          });
        } else {
          // Task complete - get last assistant message
          const lastMessage = sessionMessages[sessionMessages.length - 1];
          let completionSummary = 'Task completed';
          if (lastMessage?.role === 'assistant' && typeof lastMessage.content === 'string') {
            // Extract first meaningful sentence
            const content = lastMessage.content;
            const firstSentence = content.split(/[.!?]\s+/)[0]?.slice(0, 150) || 'Task completed';
            completionSummary = firstSentence;
          }

          return JSON.stringify({
            status: 'complete',
            currentAction: 'Finished',
            completionSummary: completionSummary,
            message: `Done! ${completionSummary}`
          });
        }
      }

      return `Unknown tool: ${toolCall.toolName}`;
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

  // Send context updates when messages change (Grep responded)
  const prevMessagesLengthRef = useRef(messages.length);
  const prevStreamingRef = useRef(isStreaming);

  useEffect(() => {
    // Only send update if messages actually changed (not on initial render)
    if (hookConnected && messages.length > 0 && messages.length !== prevMessagesLengthRef.current) {
      const lastMessage = messages[messages.length - 1];

      // If Grep (assistant) responded, send a progress update
      if (lastMessage?.role === 'assistant') {
        const summary = summarizeForVoice(lastMessage.content);
        console.log('[MicrophoneButton] Grep responded, sending progress update:', summary);

        // If streaming just ended, this is the COMPLETION - announce it clearly
        if (!isStreaming && prevStreamingRef.current) {
          console.log('[MicrophoneButton] Streaming ended, announcing completion:', summary);
          // Send clear completion context update
          updateContext(`TASK COMPLETE: ${summary}\nGrep has finished. Ready for next request.`);
          // Proactively speak the completion with "Done" prefix
          speak(`Done. ${summary}`);
        } else {
          // Still streaming - just a progress update
          updateContext(`Grep progress: ${summary}\nStatus: Still working...`);
        }
      } else {
        // User message - just update context
        console.log('[MicrophoneButton] Messages changed, sending context update');
        const context = generateContextRef.current();
        console.log('[MicrophoneButton] Context preview:', context.slice(0, 100));
        updateContext(context);
      }
    }
    prevMessagesLengthRef.current = messages.length;
    prevStreamingRef.current = isStreaming;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hookConnected, messages.length, isStreaming, summarizeForVoice, speak]);

  // User activity signal ref for preventing "are you there?" prompts
  const activityIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Send user activity signals while streaming to prevent "are you there?" prompts
  useEffect(() => {
    if (hookConnected && isStreaming) {
      // Send activity signal immediately when streaming starts
      window.electronAPI.voice.sendUserActivity();
      console.log('[MicrophoneButton] Sent initial user activity signal');

      // Send activity signal every 15 seconds while working
      activityIntervalRef.current = setInterval(() => {
        window.electronAPI.voice.sendUserActivity();
        console.log('[MicrophoneButton] Sent periodic user activity signal');
      }, 15000);
    } else {
      // Clear interval when not streaming
      if (activityIntervalRef.current) {
        clearInterval(activityIntervalRef.current);
        activityIntervalRef.current = null;
      }
    }

    return () => {
      if (activityIntervalRef.current) {
        clearInterval(activityIntervalRef.current);
        activityIntervalRef.current = null;
      }
    };
  }, [hookConnected, isStreaming]);

  // NOTE: Push-based speech updates removed in favor of polling model.
  // The ElevenLabs agent now calls get_task_status tool to poll for updates.
  // This is more reliable than trying to push verbatim speech to the agent.

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
