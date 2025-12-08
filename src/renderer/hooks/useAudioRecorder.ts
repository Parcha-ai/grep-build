import { useEffect, useRef, useCallback, useState } from 'react';
import { useAudioStore } from '../stores/audio.store';

interface UseAudioRecorderOptions {
  sessionId: string;
  onTranscriptionComplete?: (text: string) => void;
  onInterimTranscript?: (text: string) => void;
  onError?: (error: string) => void;
}

export const useAudioRecorder = ({
  sessionId,
  onTranscriptionComplete,
  onInterimTranscript,
  onError,
}: UseAudioRecorderOptions) => {
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const transcriptRef = useRef<string>('');
  const finalizedSegmentsRef = useRef<string[]>([]); // Completed transcript segments
  const cleanupFunctionsRef = useRef<Array<() => void>>([]);
  const isConnectedRef = useRef<boolean>(false);
  const [currentTranscript, setCurrentTranscript] = useState('');

  // Use refs for callbacks to avoid stale closure issues
  const onInterimTranscriptRef = useRef(onInterimTranscript);
  const onTranscriptionCompleteRef = useRef(onTranscriptionComplete);
  const onErrorRef = useRef(onError);

  // Keep refs updated
  onInterimTranscriptRef.current = onInterimTranscript;
  onTranscriptionCompleteRef.current = onTranscriptionComplete;
  onErrorRef.current = onError;

  const {
    recordingStates,
    startRecording,
    stopRecording,
    setRecordingDuration,
    setTranscriptionStatus,
    setRecordingError,
    clearRecording,
  } = useAudioStore();

  const recordingState = recordingStates[sessionId];

  // Set up Realtime API event listeners
  const setupRealtimeListeners = useCallback(() => {
    console.log('[AudioRecorder] Setting up Realtime API listeners');

    // Handle transcription deltas (streaming text)
    console.log('[AudioRecorder] Setting up transcription_delta listener');
    const unsubDelta = window.electronAPI.realtime.onTranscriptionDelta((delta: string) => {
      console.log('[AudioRecorder] Received transcription delta:', delta.slice(0, 50));
      // Combine finalized segments with current delta
      // This accumulates text across multiple speech turns (VAD segments)
      const previousText = finalizedSegmentsRef.current.join(' ');
      const fullText = previousText ? `${previousText} ${delta}` : delta;
      transcriptRef.current = fullText;
      setCurrentTranscript(fullText);
      console.log('[AudioRecorder] Full transcript so far:', fullText.slice(0, 80));
      // Use ref to get the latest callback
      onInterimTranscriptRef.current?.(fullText);
    });
    cleanupFunctionsRef.current.push(unsubDelta);

    // Handle completed transcription (finalize a speech segment)
    const unsubCompleted = window.electronAPI.realtime.onTranscriptionCompleted((transcript: string) => {
      console.log('[AudioRecorder] Transcription segment completed:', transcript);
      // Add this completed segment to finalized segments
      if (transcript.trim()) {
        finalizedSegmentsRef.current.push(transcript.trim());
      }
      // Update the full transcript
      const fullText = finalizedSegmentsRef.current.join(' ');
      transcriptRef.current = fullText;
      setCurrentTranscript(fullText);
      console.log('[AudioRecorder] Finalized transcript:', fullText);
    });
    cleanupFunctionsRef.current.push(unsubCompleted);

    // Handle speech started (VAD detected speech)
    const unsubSpeechStarted = window.electronAPI.realtime.onSpeechStarted(() => {
      console.log('[AudioRecorder] Speech started (VAD detected)');
    });
    cleanupFunctionsRef.current.push(unsubSpeechStarted);

    // Handle speech stopped (VAD detected silence)
    const unsubSpeechStopped = window.electronAPI.realtime.onSpeechStopped(() => {
      console.log('[AudioRecorder] Speech stopped (VAD detected)');
    });
    cleanupFunctionsRef.current.push(unsubSpeechStopped);

    // Handle connection established
    const unsubConnected = window.electronAPI.realtime.onConnected(() => {
      console.log('[AudioRecorder] Realtime API connected');
      isConnectedRef.current = true;
    });
    cleanupFunctionsRef.current.push(unsubConnected);

    // Handle disconnection
    const unsubDisconnected = window.electronAPI.realtime.onDisconnected(() => {
      console.log('[AudioRecorder] Realtime API disconnected');
      isConnectedRef.current = false;
    });
    cleanupFunctionsRef.current.push(unsubDisconnected);

    // Handle errors
    const unsubError = window.electronAPI.realtime.onError((error: string) => {
      console.error('[AudioRecorder] Realtime API error:', error);
      setRecordingError(sessionId, error);
      onError?.(error);
    });
    cleanupFunctionsRef.current.push(unsubError);
  }, [sessionId, onInterimTranscript, onError, setRecordingError]);

  // Clean up event listeners
  const cleanupListeners = useCallback(() => {
    console.log('[AudioRecorder] Cleaning up listeners');
    cleanupFunctionsRef.current.forEach(fn => fn());
    cleanupFunctionsRef.current = [];
  }, []);

  // Update duration while recording
  const startDurationTimer = useCallback(() => {
    startTimeRef.current = Date.now();
    durationIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      setRecordingDuration(sessionId, elapsed);
    }, 100);
  }, [sessionId, setRecordingDuration]);

  const stopDurationTimer = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  }, []);

  // Convert Float32Array to Int16Array for PCM16 format
  const float32ToInt16 = useCallback((float32: Float32Array): Int16Array => {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      // Clamp and convert to 16-bit integer
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16;
  }, []);

  // Resample audio from source rate to 24kHz
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

  // Start recording with Realtime API
  const start = useCallback(async () => {
    try {
      console.log('[AudioRecorder] Starting recording with Realtime API');

      // Reset transcript and finalized segments
      transcriptRef.current = '';
      finalizedSegmentsRef.current = [];
      setCurrentTranscript('');

      // Set up event listeners before connecting
      setupRealtimeListeners();

      // Connect to Realtime API
      console.log('[AudioRecorder] Connecting to Realtime API...');
      const connectResult = await window.electronAPI.realtime.connect();
      if (!connectResult.success) {
        throw new Error(connectResult.error || 'Failed to connect to Realtime API');
      }
      console.log('[AudioRecorder] Connected to Realtime API');

      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 24000, // Request 24kHz to match Realtime API
        }
      });
      streamRef.current = stream;

      // Create audio context at 24kHz (Realtime API sample rate)
      const audioContext = new AudioContext({ sampleRate: 24000 });
      audioContextRef.current = audioContext;

      // Create source from microphone
      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      // Create script processor for audio processing
      // Buffer size of 4096 samples at 24kHz = ~170ms chunks
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = async (event) => {
        if (!isConnectedRef.current) return;

        const inputData = event.inputBuffer.getChannelData(0);

        // Resample to 24kHz if needed
        const resampled = resample(inputData, audioContext.sampleRate, 24000);

        // Convert to Int16
        const int16Data = float32ToInt16(resampled);

        // Send to main process as number array
        const audioArray = Array.from(int16Data);
        await window.electronAPI.realtime.sendAudio(audioArray);
      };

      // Connect the audio graph
      source.connect(processor);
      processor.connect(audioContext.destination);

      // Update recording state
      startRecording(sessionId);
      startDurationTimer();
      setRecordingError(sessionId, null);
      // Don't set processing during recording - keep button enabled to allow stopping

      console.log('[AudioRecorder] Recording started');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to start recording';
      console.error('[AudioRecorder] Start error:', error);
      setRecordingError(sessionId, errorMessage);
      onError?.(errorMessage);
      cleanupListeners();
    }
  }, [
    sessionId,
    startRecording,
    startDurationTimer,
    setRecordingError,
    setTranscriptionStatus,
    onError,
    setupRealtimeListeners,
    cleanupListeners,
    float32ToInt16,
    resample,
  ]);

  // Stop recording
  const stop = useCallback(async () => {
    console.log('[AudioRecorder] Stopping recording');
    stopDurationTimer();

    // IMPORTANT: Save the current transcript BEFORE any cleanup
    // VAD may have already delivered the transcript, and we don't want to lose it
    const savedTranscript = transcriptRef.current.trim();
    console.log('[AudioRecorder] Saved transcript before cleanup:', savedTranscript || '(empty)');

    // Disconnect audio processing
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

    // Stop all media tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // Only commit if we don't have a transcript yet (VAD may have already handled it)
    if (isConnectedRef.current && !savedTranscript) {
      try {
        await window.electronAPI.realtime.commitAudio();
        console.log('[AudioRecorder] Audio buffer committed (no prior transcript)');
        // Wait a moment for transcription to arrive
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (e) {
        console.error('[AudioRecorder] Failed to commit audio:', e);
      }
    }

    // Disconnect from Realtime API
    try {
      await window.electronAPI.realtime.disconnect();
      console.log('[AudioRecorder] Disconnected from Realtime API');
    } catch (e) {
      console.error('[AudioRecorder] Disconnect error:', e);
    }
    isConnectedRef.current = false;

    // Clean up event listeners
    cleanupListeners();

    // Update recording state
    stopRecording(sessionId);

    // Use the saved transcript (prefer it over any new one that might have arrived)
    const finalTranscript = savedTranscript || transcriptRef.current.trim();
    console.log('[AudioRecorder] Final transcript:', finalTranscript || '(empty)');

    if (finalTranscript) {
      setTranscriptionStatus(sessionId, 'complete');
      // Use ref to get the latest callback and avoid stale closure
      console.log('[AudioRecorder] Calling onTranscriptionComplete with:', finalTranscript);
      onTranscriptionCompleteRef.current?.(finalTranscript);
      setTimeout(() => clearRecording(sessionId), 1000);
    } else {
      // No transcript - might have been too short
      setTranscriptionStatus(sessionId, 'idle');
      clearRecording(sessionId);
    }
  }, [
    sessionId,
    stopRecording,
    stopDurationTimer,
    setTranscriptionStatus,
    clearRecording,
    cleanupListeners,
  ]);

  // Cancel recording
  const cancel = useCallback(async () => {
    console.log('[AudioRecorder] Cancelling recording');
    stopDurationTimer();

    // Disconnect audio processing
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

    // Stop all media tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // Clear and disconnect from Realtime API
    if (isConnectedRef.current) {
      try {
        await window.electronAPI.realtime.clearAudio();
        await window.electronAPI.realtime.disconnect();
      } catch (e) {
        console.error('[AudioRecorder] Cancel cleanup error:', e);
      }
    }
    isConnectedRef.current = false;

    // Clean up
    cleanupListeners();
    clearRecording(sessionId);
    transcriptRef.current = '';
    finalizedSegmentsRef.current = [];
    setCurrentTranscript('');
  }, [sessionId, stopDurationTimer, clearRecording, cleanupListeners]);

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
      stopDurationTimer();
      cleanupListeners();

      // Disconnect from Realtime API if still connected
      if (isConnectedRef.current) {
        window.electronAPI.realtime.disconnect().catch(console.error);
      }
    };
  }, [stopDurationTimer, cleanupListeners]);

  return {
    isRecording: recordingState?.isRecording || false,
    isPaused: recordingState?.isPaused || false,
    duration: recordingState?.duration || 0,
    transcriptionStatus: recordingState?.transcriptionStatus || 'idle',
    error: recordingState?.error || null,
    currentTranscript,
    start,
    stop,
    cancel,
  };
};
