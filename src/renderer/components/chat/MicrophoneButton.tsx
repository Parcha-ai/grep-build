import React from 'react';
import { Mic, MicOff, Loader2 } from 'lucide-react';
import { useAudioRecorder } from '../../hooks/useAudioRecorder';

interface MicrophoneButtonProps {
  sessionId: string;
  onTranscriptionComplete: (text: string) => void;
  onInterimTranscript?: (text: string) => void;
  disabled?: boolean;
}

export const MicrophoneButton: React.FC<MicrophoneButtonProps> = ({
  sessionId,
  onTranscriptionComplete,
  onInterimTranscript,
  disabled = false,
}) => {
  const {
    isRecording,
    transcriptionStatus,
    error,
    start,
    stop,
  } = useAudioRecorder({
    sessionId,
    onTranscriptionComplete,
    onInterimTranscript,
    onError: (error) => {
      console.error('Recording error:', error);
    },
  });

  const handleClick = () => {
    if (isRecording) {
      stop();
    } else {
      start();
    }
  };

  const isTranscribing = transcriptionStatus === 'processing';

  return (
    <button
      onClick={handleClick}
      disabled={disabled || isTranscribing}
      className={`
        relative p-1 transition-all duration-200
        ${isRecording
          ? 'text-red-500 hover:text-red-400'
          : 'text-claude-text-secondary hover:text-claude-accent'
        }
        ${disabled || isTranscribing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${error ? 'text-red-500' : ''}
      `}
      style={{ borderRadius: 0 }}
      title={error ? `Error: ${error}` : isRecording ? 'Stop recording' : 'Start recording'}
    >
      {isTranscribing ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : isRecording ? (
        <div className="relative">
          <MicOff className="w-4 h-4" />
          {/* Simple pulsing red dot */}
          <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
          </span>
        </div>
      ) : (
        <Mic className="w-4 h-4" />
      )}
    </button>
  );
};
