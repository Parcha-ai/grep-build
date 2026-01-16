import { useCallback, useEffect, useRef, useState } from 'react';

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
  onToolCall?: (toolCall: ToolCall) => Promise<string>;  // Returns result to send back
}

interface VoiceConversationState {
  isConnected: boolean;
  isConnecting: boolean;
  isRecording: boolean;
  isSpeaking: boolean;
  currentTranscript: string;
  error: string | null;
}

/**
 * Hook for ElevenLabs Conversational AI voice mode
 *
 * Provides:
 * - Connection management to ElevenLabs WebSocket
 * - Microphone audio capture and streaming
 * - Real-time transcription display
 * - Audio playback of responses
 * - Integration with Claude (via transcript callbacks)
 */
export const useVoiceConversation = ({
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
  });

  // Audio context and stream refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const cleanupFunctionsRef = useRef<Array<() => void>>([]);
  const isConnectedRef = useRef(false);

  // Audio playback refs
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const playbackContextRef = useRef<AudioContext | null>(null);

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

  /**
   * Set up event listeners
   */
  const setupListeners = useCallback(() => {
    console.log('[VoiceConversation] Setting up listeners');

    const unsubConnected = window.electronAPI.voice.onConnected(() => {
      console.log('[VoiceConversation] Connected');
      isConnectedRef.current = true;
      setState(s => ({ ...s, isConnected: true, isConnecting: false }));
    });
    cleanupFunctionsRef.current.push(unsubConnected);

    const unsubDisconnected = window.electronAPI.voice.onDisconnected(() => {
      console.log('[VoiceConversation] Disconnected');
      isConnectedRef.current = false;
      setState(s => ({ ...s, isConnected: false, isRecording: false }));
    });
    cleanupFunctionsRef.current.push(unsubDisconnected);

    const unsubReconnecting = window.electronAPI.voice.onReconnecting((data) => {
      console.log('[VoiceConversation] Reconnecting:', data);
    });
    cleanupFunctionsRef.current.push(unsubReconnecting);

    const unsubTranscript = window.electronAPI.voice.onUserTranscript((data) => {
      console.log('[VoiceConversation] Transcript:', data.text, 'final:', data.isFinal);
      setState(s => ({ ...s, currentTranscript: data.text }));
      onTranscriptRef.current?.(data.text, data.isFinal);
    });
    cleanupFunctionsRef.current.push(unsubTranscript);

    const unsubAgentResponse = window.electronAPI.voice.onAgentResponse((text) => {
      console.log('[VoiceConversation] Agent response:', text);
      onClaudeResponseRef.current?.(text);
    });
    cleanupFunctionsRef.current.push(unsubAgentResponse);

    const unsubAudio = window.electronAPI.voice.onAudioChunk(async (data) => {
      // Queue audio for playback
      const audioData = new Uint8Array(data.data);
      await queueAudioForPlayback(audioData);
    });
    cleanupFunctionsRef.current.push(unsubAudio);

    const unsubInterruption = window.electronAPI.voice.onInterruption((reason) => {
      console.log('[VoiceConversation] Interruption:', reason);
      // Stop current playback on interruption
      stopPlayback();
    });
    cleanupFunctionsRef.current.push(unsubInterruption);

    const unsubError = window.electronAPI.voice.onError((error) => {
      console.error('[VoiceConversation] Error:', error);
      setState(s => ({ ...s, error }));
      onErrorRef.current?.(error);
    });
    cleanupFunctionsRef.current.push(unsubError);

    const unsubToolCall = window.electronAPI.voice.onToolCall(async (data) => {
      console.log('[VoiceConversation] Tool call received:', data.toolName, data.parameters);
      try {
        if (onToolCallRef.current) {
          const result = await onToolCallRef.current(data);
          // Send result back to ElevenLabs
          await window.electronAPI.voice.sendToolResult({
            toolCallId: data.toolCallId,
            result,
            isError: false,
          });
        } else {
          // No handler, send error back
          await window.electronAPI.voice.sendToolResult({
            toolCallId: data.toolCallId,
            result: 'Tool handler not configured',
            isError: true,
          });
        }
      } catch (error) {
        console.error('[VoiceConversation] Tool call error:', error);
        await window.electronAPI.voice.sendToolResult({
          toolCallId: data.toolCallId,
          result: error instanceof Error ? error.message : 'Unknown error',
          isError: true,
        });
      }
    });
    cleanupFunctionsRef.current.push(unsubToolCall);
  }, []);

  /**
   * Clean up listeners
   */
  const cleanupListeners = useCallback(() => {
    console.log('[VoiceConversation] Cleaning up listeners');
    cleanupFunctionsRef.current.forEach(fn => fn());
    cleanupFunctionsRef.current = [];
  }, []);

  /**
   * Queue audio data for playback
   * ElevenLabs sends raw PCM 16-bit audio at 16kHz
   */
  const queueAudioForPlayback = useCallback(async (audioData: Uint8Array) => {
    if (!playbackContextRef.current) {
      playbackContextRef.current = new AudioContext({ sampleRate: 16000 });
    }

    try {
      // ElevenLabs sends raw PCM 16-bit audio - convert to AudioBuffer
      // The data is Int16 samples, need to convert to Float32
      const int16Array = new Int16Array(audioData.buffer);
      const float32Array = new Float32Array(int16Array.length);

      for (let i = 0; i < int16Array.length; i++) {
        // Convert Int16 (-32768 to 32767) to Float32 (-1.0 to 1.0)
        float32Array[i] = int16Array[i] / 32768.0;
      }

      // Create AudioBuffer and copy samples
      const audioBuffer = playbackContextRef.current.createBuffer(1, float32Array.length, 16000);
      audioBuffer.copyToChannel(float32Array, 0);

      audioQueueRef.current.push(audioBuffer);
      setState(s => ({ ...s, isSpeaking: true }));
      playNextAudio();
    } catch (e) {
      console.error('[VoiceConversation] Failed to process audio:', e);
    }
  }, []);

  /**
   * Play next audio in queue
   */
  const playNextAudio = useCallback(() => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) {
      if (audioQueueRef.current.length === 0) {
        setState(s => ({ ...s, isSpeaking: false }));
      }
      return;
    }

    if (!playbackContextRef.current) return;

    isPlayingRef.current = true;
    const audioBuffer = audioQueueRef.current.shift()!;
    const source = playbackContextRef.current.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(playbackContextRef.current.destination);

    source.onended = () => {
      isPlayingRef.current = false;
      playNextAudio();
    };

    source.start();
  }, []);

  /**
   * Stop audio playback
   */
  const stopPlayback = useCallback(() => {
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    setState(s => ({ ...s, isSpeaking: false }));
  }, []);

  /**
   * Convert Float32 to Int16 for PCM audio
   */
  const float32ToInt16 = useCallback((float32: Float32Array): Int16Array => {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16;
  }, []);

  /**
   * Resample audio to target rate
   */
  const resample = useCallback((samples: Float32Array, sourceRate: number, targetRate: number): Float32Array => {
    if (sourceRate === targetRate) return samples;
    const ratio = sourceRate / targetRate;
    const newLength = Math.round(samples.length / ratio);
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const srcIdx = i * ratio;
      const low = Math.floor(srcIdx);
      const high = Math.min(low + 1, samples.length - 1);
      const frac = srcIdx - low;
      result[i] = samples[low] * (1 - frac) + samples[high] * frac;
    }
    return result;
  }, []);

  /**
   * Connect to ElevenLabs and start voice mode
   */
  const connect = useCallback(async () => {
    try {
      setState(s => ({ ...s, isConnecting: true, error: null }));

      // Set up listeners before connecting
      setupListeners();

      // Connect to ElevenLabs
      const result = await window.electronAPI.voice.connect({
        agentId,
        systemPrompt,
        sessionContext: { sessionId },
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to connect');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to connect';
      console.error('[VoiceConversation] Connect error:', error);
      setState(s => ({ ...s, isConnecting: false, error: errorMessage }));
      cleanupListeners();
      onErrorRef.current?.(errorMessage);
    }
  }, [agentId, systemPrompt, sessionId, setupListeners, cleanupListeners]);

  /**
   * Start recording microphone audio
   */
  const startRecording = useCallback(async () => {
    if (!isConnectedRef.current) {
      console.warn('[VoiceConversation] Not connected');
      return;
    }

    try {
      // Request microphone
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000, // ElevenLabs expects 16kHz
        },
      });
      streamRef.current = stream;

      // Create audio context at 16kHz
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      // Create source from microphone
      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      // Create processor for audio data
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = async (event) => {
        if (!isConnectedRef.current) return;

        const inputData = event.inputBuffer.getChannelData(0);
        const resampled = resample(inputData, audioContext.sampleRate, 16000);
        const int16Data = float32ToInt16(resampled);

        // Send to main process
        const audioArray = Array.from(int16Data);
        try {
          await window.electronAPI.voice.sendAudio(audioArray);
        } catch (e) {
          console.error('[VoiceConversation] Error sending audio:', e);
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      setState(s => ({ ...s, isRecording: true, currentTranscript: '' }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to start recording';
      console.error('[VoiceConversation] Recording error:', error);
      setState(s => ({ ...s, error: errorMessage }));
      onErrorRef.current?.(errorMessage);
    }
  }, [float32ToInt16, resample]);

  /**
   * Stop recording
   */
  const stopRecording = useCallback(async () => {
    // Stop audio processing
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // Signal end of user input
    await window.electronAPI.voice.endInput();

    setState(s => ({ ...s, isRecording: false }));
  }, []);

  /**
   * Disconnect from voice mode
   */
  const disconnect = useCallback(async () => {
    // Stop recording if active
    await stopRecording();

    // Stop playback
    stopPlayback();

    // Disconnect from ElevenLabs
    await window.electronAPI.voice.disconnect();

    // Clean up
    cleanupListeners();

    if (playbackContextRef.current) {
      await playbackContextRef.current.close();
      playbackContextRef.current = null;
    }

    setState({
      isConnected: false,
      isConnecting: false,
      isRecording: false,
      isSpeaking: false,
      currentTranscript: '',
      error: null,
    });
  }, [stopRecording, stopPlayback, cleanupListeners]);

  /**
   * Send text for TTS (to speak Claude's response)
   */
  const speak = useCallback(async (text: string) => {
    if (!isConnectedRef.current) {
      console.warn('[VoiceConversation] Not connected');
      return;
    }
    await window.electronAPI.voice.sendText(text);
  }, []);

  /**
   * Send context update (inform agent of state changes)
   */
  const updateContext = useCallback(async (context: string) => {
    console.log('[VoiceConversation] updateContext called, isConnectedRef:', isConnectedRef.current, 'context length:', context.length);
    if (!isConnectedRef.current) {
      console.warn('[VoiceConversation] Not connected, skipping context update');
      return;
    }
    console.log('[VoiceConversation] Sending context update via IPC');
    await window.electronAPI.voice.sendContextUpdate(context);
    console.log('[VoiceConversation] Context update IPC call completed');
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (processorRef.current) {
        processorRef.current.disconnect();
      }
      if (sourceRef.current) {
        sourceRef.current.disconnect();
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (playbackContextRef.current) {
        playbackContextRef.current.close();
      }
      cleanupListeners();
    };
  }, [cleanupListeners]);

  return {
    ...state,
    connect,
    disconnect,
    startRecording,
    stopRecording,
    speak,
    updateContext,
  };
};
