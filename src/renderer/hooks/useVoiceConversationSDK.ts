import { useCallback, useEffect, useRef, useState } from 'react';
import { Conversation, type Mode, type Status, type Callbacks } from '@elevenlabs/client';

interface ToolCall {
  toolCallId: string;
  toolName: string;
  parameters: Record<string, unknown>;
}

interface UseVoiceConversationOptions {
  agentId: string;
  sessionId: string;
  systemPrompt?: string;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onClaudeResponse?: (text: string) => void;
  onError?: (error: string) => void;
  onToolCall?: (toolCall: ToolCall) => Promise<string>;
}

interface VoiceConversationState {
  isConnected: boolean;
  isConnecting: boolean;
  isRecording: boolean;
  isSpeaking: boolean;
  currentTranscript: string;
  error: string | null;
  audioLevel: number;
  shouldReconnect: boolean; // Trigger for auto-reconnect
}

/**
 * Hook for ElevenLabs Conversational AI voice mode using the official SDK
 *
 * This version uses @elevenlabs/client with WebRTC for:
 * - Built-in hardware-level echo cancellation
 * - Proper mode change detection (speaking/listening)
 * - Official SDK maintenance and updates
 */
export const useVoiceConversationSDK = ({
  agentId,
  sessionId,
  systemPrompt,
  onTranscript,
  onClaudeResponse,
  onError,
  onToolCall,
}: UseVoiceConversationOptions) => {
  const [state, setState] = useState<VoiceConversationState>({
    isConnected: false,
    isConnecting: false,
    isRecording: false,
    isSpeaking: false,
    currentTranscript: '',
    error: null,
    audioLevel: 0,
    shouldReconnect: false,
  });

  // Conversation instance ref
  const conversationRef = useRef<Conversation | null>(null);
  const isConnectedRef = useRef(false);

  // Refs for callbacks to avoid stale closures
  const onTranscriptRef = useRef(onTranscript);
  const onClaudeResponseRef = useRef(onClaudeResponse);
  const onErrorRef = useRef(onError);
  const onToolCallRef = useRef(onToolCall);

  // Keep refs updated
  onTranscriptRef.current = onTranscript;
  onClaudeResponseRef.current = onClaudeResponse;
  onErrorRef.current = onError;
  onToolCallRef.current = onToolCall;

  // Audio level polling interval
  const audioLevelIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Track if disconnect was intentional (user-initiated)
  const intentionalDisconnectRef = useRef(false);

  // Track connection start time for token expiry detection
  const connectionStartTimeRef = useRef<number | null>(null);

  // Auto-reconnect state
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 3;

  
  /**
   * Connect to ElevenLabs and start voice mode using the official SDK
   */
  const connect = useCallback(async () => {
    try {
      // Reset intentional disconnect flag - we're trying to connect now
      intentionalDisconnectRef.current = false;
      setState(s => ({ ...s, isConnecting: true, error: null }));

      // On macOS, check and request microphone permission first
      if (window.electronAPI?.audio?.checkMicrophonePermission) {
        const permStatus = await window.electronAPI.audio.checkMicrophonePermission();
        console.log('[VoiceConversationSDK] Microphone permission status:', permStatus);

        if (!permStatus.granted) {
          if (permStatus.canRequest) {
            console.log('[VoiceConversationSDK] Requesting microphone permission...');
            const result = await window.electronAPI.audio.requestMicrophonePermission();
            if (!result.granted) {
              const errorMsg = result.error || 'Microphone access denied';
              console.error('[VoiceConversationSDK] Microphone permission denied:', errorMsg);
              setState(s => ({ ...s, isConnecting: false, error: errorMsg }));
              onErrorRef.current?.(errorMsg);
              return;
            }
            console.log('[VoiceConversationSDK] Microphone permission granted');
          } else {
            const errorMsg = 'Microphone access denied. Please enable it in System Settings > Privacy & Security > Microphone.';
            console.error('[VoiceConversationSDK]', errorMsg);
            setState(s => ({ ...s, isConnecting: false, error: errorMsg }));
            onErrorRef.current?.(errorMsg);
            return;
          }
        }
      }

      // Request microphone access before starting session
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        const errorMsg = 'Failed to access microphone';
        console.error('[VoiceConversationSDK]', errorMsg, e);
        setState(s => ({ ...s, isConnecting: false, error: errorMsg }));
        onErrorRef.current?.(errorMsg);
        return;
      }

      // Get conversation token from main process (which has the API key)
      // Use conversation token + WebRTC for hardware echo cancellation
      console.log('[VoiceConversationSDK] Requesting conversation token for WebRTC...');
      const tokenResult = await window.electronAPI.voice.getConversationToken({ agentId });
      console.log('[VoiceConversationSDK] Token result:', { success: tokenResult.success, hasToken: !!tokenResult.conversationToken, error: tokenResult.error });

      if (!tokenResult.success || !tokenResult.conversationToken) {
        throw new Error(tokenResult.error || 'Failed to get conversation token');
      }

      console.log('[VoiceConversationSDK] Got token, starting WebRTC session...', 'token length:', tokenResult.conversationToken?.length);

      // Build client tools if onToolCall is provided
      const clientTools: Record<string, (params: unknown) => Promise<string>> = {};
      if (onToolCallRef.current) {
        // We'll handle unhandled tool calls via the callback
      }

      // Start session with the official SDK using WebRTC for hardware echo cancellation
      const conversation = await Conversation.startSession({
        conversationToken: tokenResult.conversationToken,
        connectionType: 'webrtc', // Use WebRTC for hardware-level echo cancellation
        clientTools,

        // Callbacks
        onConnect: ({ conversationId }) => {
          console.log('[VoiceConversationSDK] Connected, conversationId:', conversationId);
          isConnectedRef.current = true;
          connectionStartTimeRef.current = Date.now();
          reconnectAttemptsRef.current = 0; // Reset reconnect attempts on successful connect
          setState(s => ({ ...s, isConnected: true, isConnecting: false }));
        },

        onDisconnect: (details) => {
          console.log('[VoiceConversationSDK] Disconnected:', details, {
            intentional: intentionalDisconnectRef.current,
            connectionDuration: connectionStartTimeRef.current
              ? Math.round((Date.now() - connectionStartTimeRef.current) / 1000) + 's'
              : 'unknown',
            reconnectAttempts: reconnectAttemptsRef.current,
          });

          isConnectedRef.current = false;
          conversationRef.current = null;
          connectionStartTimeRef.current = null;
          setState(s => ({ ...s, isConnected: false, isRecording: false, isSpeaking: false }));

          // Clear audio level polling
          if (audioLevelIntervalRef.current) {
            clearInterval(audioLevelIntervalRef.current);
            audioLevelIntervalRef.current = null;
          }

          // Auto-reconnect if disconnect was NOT intentional (e.g., token expired, network blip)
          // But not for explicit errors like quota exceeded
          const detailsStr = JSON.stringify(details || {}).toLowerCase();
          const isRecoverableDisconnect = !intentionalDisconnectRef.current &&
            !detailsStr.includes('quota') &&
            !detailsStr.includes('limit') &&
            !detailsStr.includes('unauthorized') &&
            reconnectAttemptsRef.current < maxReconnectAttempts;

          if (isRecoverableDisconnect) {
            reconnectAttemptsRef.current++;
            console.log(`[VoiceConversationSDK] Auto-reconnecting (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})...`);
            // Delay a bit before reconnecting to avoid rapid reconnect loops
            const delay = 1000 * reconnectAttemptsRef.current; // Exponential backoff: 1s, 2s, 3s
            setTimeout(() => {
              // Only reconnect if we're still supposed to be connected (not intentionally disconnected)
              if (!intentionalDisconnectRef.current) {
                // Trigger reconnect via state - the effect below will handle the actual reconnection
                setState(s => ({ ...s, shouldReconnect: true, error: `Reconnecting (attempt ${reconnectAttemptsRef.current})...` }));
              }
            }, delay);
          } else if (!intentionalDisconnectRef.current) {
            console.log('[VoiceConversationSDK] Not auto-reconnecting:', {
              intentional: intentionalDisconnectRef.current,
              hasQuotaError: detailsStr.includes('quota'),
              hasLimitError: detailsStr.includes('limit'),
              hasUnauthorized: detailsStr.includes('unauthorized'),
              reconnectAttempts: reconnectAttemptsRef.current,
            });
          }
        },

        onError: (message, context) => {
          console.error('[VoiceConversationSDK] Error:', message, context);
          setState(s => ({ ...s, error: message }));
          onErrorRef.current?.(message);
        },

        onMessage: ({ message, role }) => {
          console.log('[VoiceConversationSDK] Message from', role, ':', message.slice(0, 100));

          if (role === 'user') {
            // User transcription
            setState(s => ({ ...s, currentTranscript: message }));
            // Final transcriptions are sent here
            onTranscriptRef.current?.(message, true);
          } else if (role === 'agent') {
            // Agent response
            onClaudeResponseRef.current?.(message);
          }
        },

        onModeChange: ({ mode }) => {
          console.log('[VoiceConversationSDK] Mode changed to:', mode);
          // 'speaking' = agent is talking, 'listening' = waiting for user
          setState(s => ({ ...s, isSpeaking: mode === 'speaking' }));
        },

        onStatusChange: ({ status }) => {
          console.log('[VoiceConversationSDK] Status changed to:', status);
          setState(s => ({
            ...s,
            isConnecting: status === 'connecting',
            isConnected: status === 'connected',
          }));
        },

        onInterruption: (props) => {
          console.log('[VoiceConversationSDK] Interruption:', props);
        },

        onUnhandledClientToolCall: async (toolCall) => {
          console.log('[VoiceConversationSDK] Unhandled tool call:', toolCall);
          if (onToolCallRef.current) {
            try {
              const result = await onToolCallRef.current({
                toolCallId: toolCall.tool_call_id,
                toolName: toolCall.tool_name,
                parameters: toolCall.parameters as Record<string, unknown>,
              });
              console.log('[VoiceConversationSDK] Tool result:', result);
              // Return the result to the SDK so the agent receives it
              return result;
            } catch (error) {
              console.error('[VoiceConversationSDK] Tool call error:', error);
              return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
            }
          }
          return 'No handler for this tool call';
        },
      });

      conversationRef.current = conversation;

      // Start audio level polling
      audioLevelIntervalRef.current = setInterval(() => {
        if (conversationRef.current && isConnectedRef.current) {
          try {
            const level = conversationRef.current.getInputVolume();
            setState(s => ({ ...s, audioLevel: level }));
          } catch {
            // Ignore errors if conversation is being torn down
          }
        }
      }, 100);

      // Mark as recording since the SDK handles mic capture
      setState(s => ({ ...s, isRecording: true }));

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to connect';
      console.error('[VoiceConversationSDK] Connect error:', error);
      setState(s => ({ ...s, isConnecting: false, error: errorMessage }));
      onErrorRef.current?.(errorMessage);
    }
  }, [agentId]);

  /**
   * Start recording - with the SDK, this is handled automatically
   * This is a no-op since the SDK captures audio from connection start
   */
  const startRecording = useCallback(async () => {
    if (!conversationRef.current || !isConnectedRef.current) {
      console.warn('[VoiceConversationSDK] Not connected');
      return;
    }

    // Unmute the microphone if it was muted
    conversationRef.current.setMicMuted(false);
    setState(s => ({ ...s, isRecording: true }));
  }, []);

  /**
   * Stop recording - mutes the microphone
   */
  const stopRecording = useCallback(async () => {
    if (!conversationRef.current) {
      return;
    }

    // Mute the microphone
    conversationRef.current.setMicMuted(true);
    setState(s => ({ ...s, isRecording: false }));
  }, []);

  /**
   * Disconnect from voice mode
   */
  const disconnect = useCallback(async () => {
    console.log('[VoiceConversationSDK] User-initiated disconnect');
    // Mark disconnect as intentional to prevent auto-reconnect
    intentionalDisconnectRef.current = true;

    // Clear audio level polling
    if (audioLevelIntervalRef.current) {
      clearInterval(audioLevelIntervalRef.current);
      audioLevelIntervalRef.current = null;
    }

    // End the SDK session
    if (conversationRef.current) {
      await conversationRef.current.endSession();
      conversationRef.current = null;
    }

    isConnectedRef.current = false;
    connectionStartTimeRef.current = null;
    setState({
      isConnected: false,
      isConnecting: false,
      isRecording: false,
      isSpeaking: false,
      currentTranscript: '',
      error: null,
      audioLevel: 0,
      shouldReconnect: false,
    });
  }, []);

  /**
   * Send text for TTS (to speak Claude's response)
   * Note: With the SDK, this sends a user message - the agent may respond
   */
  const speak = useCallback(async (text: string) => {
    if (!conversationRef.current || !isConnectedRef.current) {
      console.warn('[VoiceConversationSDK] Not connected');
      return;
    }

    // Use sendUserMessage to inject text into the conversation
    conversationRef.current.sendUserMessage(text);
  }, []);

  /**
   * Send context update (inform agent of state changes)
   */
  const updateContext = useCallback(async (context: string) => {
    if (!conversationRef.current || !isConnectedRef.current) {
      console.warn('[VoiceConversationSDK] Not connected, skipping context update');
      return;
    }

    console.log('[VoiceConversationSDK] Sending context update');
    conversationRef.current.sendContextualUpdate(context);
  }, []);

  /**
   * Send user activity signal
   */
  const sendUserActivity = useCallback(() => {
    if (!conversationRef.current || !isConnectedRef.current) {
      return;
    }

    conversationRef.current.sendUserActivity();
  }, []);

  // Track previous sessionId to detect session switches
  const previousSessionIdRef = useRef(sessionId);

  // Disconnect when sessionId changes (user switched sessions)
  useEffect(() => {
    if (previousSessionIdRef.current !== sessionId && conversationRef.current) {
      console.log('[VoiceConversationSDK] Session changed from', previousSessionIdRef.current, 'to', sessionId, '- disconnecting voice');
      // Mark as intentional to prevent auto-reconnect
      intentionalDisconnectRef.current = true;
      // Disconnect the old session's voice connection
      if (audioLevelIntervalRef.current) {
        clearInterval(audioLevelIntervalRef.current);
        audioLevelIntervalRef.current = null;
      }
      conversationRef.current.endSession();
      conversationRef.current = null;
      isConnectedRef.current = false;
      connectionStartTimeRef.current = null;
      setState({
        isConnected: false,
        isConnecting: false,
        isRecording: false,
        isSpeaking: false,
        currentTranscript: '',
        error: null,
        audioLevel: 0,
        shouldReconnect: false,
      });
    }
    previousSessionIdRef.current = sessionId;
  }, [sessionId]);

  // Auto-reconnect effect - triggered when shouldReconnect becomes true
  useEffect(() => {
    if (state.shouldReconnect && !state.isConnected && !state.isConnecting) {
      console.log('[VoiceConversationSDK] Reconnect effect triggered');
      // Reset the shouldReconnect flag and initiate connection
      setState(s => ({ ...s, shouldReconnect: false }));
      connect();
    }
  }, [state.shouldReconnect, state.isConnected, state.isConnecting, connect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Mark as intentional so any pending reconnect attempts are cancelled
      intentionalDisconnectRef.current = true;
      if (audioLevelIntervalRef.current) {
        clearInterval(audioLevelIntervalRef.current);
      }
      if (conversationRef.current) {
        conversationRef.current.endSession();
      }
    };
  }, []);

  return {
    ...state,
    connect,
    disconnect,
    startRecording,
    stopRecording,
    speak,
    updateContext,
    sendUserActivity,
  };
};
