import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Paperclip, X, Image, FileCode, Target, File, Folder, AtSign, Brain } from 'lucide-react';
import { useSessionStore, type PermissionMode, type ThinkingMode } from '../../stores/session.store';
import { useUIStore } from '../../stores/ui.store';
import { useAudioStore } from '../../stores/audio.store';
import MentionAutocomplete, { type Mention } from './MentionAutocomplete';
import { MicrophoneButton } from './MicrophoneButton';

interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

// Circular progress component
function ProgressCircle({ completed, total }: { completed: number; total: number }) {
  const size = 14;
  const strokeWidth = 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = total > 0 ? completed / total : 0;
  const strokeDashoffset = circumference * (1 - progress);

  return (
    <svg width={size} height={size} className="flex-shrink-0">
      {/* Background circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-claude-border"
      />
      {/* Progress circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
        className={progress === 1 ? 'text-green-500' : 'text-claude-accent'}
        style={{ transform: 'rotate(-90deg)', transformOrigin: 'center' }}
      />
    </svg>
  );
}

// Permission mode config for UI - using terminal-style prompts
const PERMISSION_MODE_CONFIG: Record<PermissionMode, { prompt: string; label: string; color: string; description: string }> = {
  acceptEdits: {
    prompt: '>>',
    label: 'AUTO',
    color: 'text-green-400',
    description: 'Auto-accept edits',
  },
  default: {
    prompt: '>',
    label: 'ASK',
    color: 'text-amber-400',
    description: 'Require approval',
  },
  plan: {
    prompt: '?',
    label: 'PLAN',
    color: 'text-blue-400',
    description: 'Planning mode (no execution)',
  },
};

// Thinking mode config for UI
const THINKING_MODE_CONFIG: Record<ThinkingMode, { label: string; color: string; description: string }> = {
  off: {
    label: 'NO THINK',
    color: 'text-gray-500',
    description: 'No extended thinking',
  },
  thinking: {
    label: 'THINK',
    color: 'text-purple-400',
    description: 'Extended thinking (10k tokens)',
  },
  ultrathink: {
    label: 'ULTRA',
    color: 'text-pink-400',
    description: 'Ultra thinking (100k tokens)',
  },
};

interface SystemInfo {
  tools: string[];
  model: string;
}

interface InputAreaProps {
  sessionId: string;
  disabled?: boolean;
  systemInfo?: SystemInfo | null;
  isStreaming?: boolean;
}

interface Attachment {
  type: 'file' | 'image' | 'dom_element' | 'mention';
  name: string;
  content: string;
  path?: string;
}

export default function InputArea({ sessionId, disabled, systemInfo, isStreaming: isStreamingProp }: InputAreaProps) {
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionPosition, setMentionPosition] = useState({ top: 0, left: 0 });
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);
  const [showTodoList, setShowTodoList] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { sendMessage, isStreaming, permissionMode, cyclePermissionMode, thinkingMode, cycleThinkingMode, currentToolCalls, messages } = useSessionStore();
  const { selectedElement, setSelectedElement, setInspectorActive, toggleBrowserPanel } = useUIStore();
  const { settings: audioSettings, setAudioMode } = useAudioStore();

  // Get the configurable trigger word (default: "please")
  const triggerWord = audioSettings?.voiceTriggerWord || 'please';

  const currentMode = permissionMode[sessionId] || 'acceptEdits';
  const modeConfig = PERMISSION_MODE_CONFIG[currentMode];
  const currentThinkingMode = thinkingMode[sessionId] || 'thinking';
  const thinkingConfig = THINKING_MODE_CONFIG[currentThinkingMode];

  const isSending = isStreaming[sessionId] || false;

  // Extract current todos from the most recent TodoWrite tool call
  const currentTodos = useMemo((): TodoItem[] => {
    // First check current streaming tool calls
    const streamingToolCalls = currentToolCalls[sessionId] || [];
    const streamingTodoWrite = [...streamingToolCalls]
      .reverse()
      .find(tc => tc.name === 'TodoWrite');

    if (streamingTodoWrite?.input?.todos) {
      return streamingTodoWrite.input.todos as TodoItem[];
    }

    // If no streaming todos, check messages for previous TodoWrite calls
    const sessionMessages = messages[sessionId] || [];
    for (let i = sessionMessages.length - 1; i >= 0; i--) {
      const msg = sessionMessages[i];
      if (msg.toolCalls) {
        const todoWrite = [...msg.toolCalls]
          .reverse()
          .find(tc => tc.name === 'TodoWrite');
        if (todoWrite?.input?.todos) {
          return todoWrite.input.todos as TodoItem[];
        }
      }
    }

    return [];
  }, [sessionId, currentToolCalls, messages]);

  // Get the current in-progress task
  const activeTask = useMemo(() => {
    return currentTodos.find(t => t.status === 'in_progress');
  }, [currentTodos]);

  // Calculate todo stats
  const todoStats = useMemo(() => {
    if (currentTodos.length === 0) return null;
    const completed = currentTodos.filter(t => t.status === 'completed').length;
    const total = currentTodos.length;
    return { completed, total };
  }, [currentTodos]);

  // Handle selected element from browser inspector
  useEffect(() => {
    if (selectedElement) {
      const element = selectedElement as { selector: string; outerHTML: string };
      setAttachments((prev) => [
        ...prev,
        {
          type: 'dom_element',
          name: element.selector || 'DOM Element',
          content: element.outerHTML || '',
        },
      ]);
      setSelectedElement(null);
    }
  }, [selectedElement, setSelectedElement]);

  // Detect @ mentions in text
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    setMessage(value);

    // Find @ mention at cursor position
    const textBeforeCursor = value.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
      // Only trigger if @ is at start or after whitespace, and no spaces in query
      const charBeforeAt = value[lastAtIndex - 1];
      const isValidStart = lastAtIndex === 0 || /\s/.test(charBeforeAt);
      const hasNoSpaces = !/\s/.test(textAfterAt);

      if (isValidStart && hasNoSpaces) {
        setShowMentions(true);
        setMentionQuery(textAfterAt);
        setMentionStartIndex(lastAtIndex);

        // Calculate position for autocomplete
        if (textareaRef.current && containerRef.current) {
          // Position above the input
          setMentionPosition({
            top: -310, // Position above
            left: 0,
          });
        }
        return;
      }
    }

    setShowMentions(false);
    setMentionQuery('');
    setMentionStartIndex(-1);
  }, []);

  // Handle mention selection
  const handleMentionSelect = useCallback(
    (mention: Mention) => {
      // Replace @query with mention
      const beforeMention = message.slice(0, mentionStartIndex);
      const afterMention = message.slice(textareaRef.current?.selectionStart || mentionStartIndex);

      // Remove the @query text and add a placeholder marker
      setMessage(beforeMention + afterMention);

      // Add mention as attachment
      setAttachments((prev) => [
        ...prev,
        {
          type: 'mention',
          name: mention.displayName,
          content: mention.path,
          path: mention.path,
        },
      ]);

      setShowMentions(false);
      setMentionQuery('');
      setMentionStartIndex(-1);

      // Focus back on textarea
      textareaRef.current?.focus();
    },
    [message, mentionStartIndex]
  );

  const handleSubmit = async () => {
    if (!message.trim() && attachments.length === 0) return;
    if (disabled || isSending) return;

    // Deactivate audio mode when typing manually
    setAudioMode(sessionId, false);

    // Build message with file context
    let fullMessage = message.trim();

    // Add file mentions to the message
    const fileMentions = attachments.filter((a) => a.type === 'mention');
    if (fileMentions.length > 0) {
      const fileContext = fileMentions
        .map((m) => `@${m.name}`)
        .join(', ');
      if (fullMessage) {
        fullMessage = `[Files: ${fileContext}]\n\n${fullMessage}`;
      } else {
        fullMessage = `Looking at: ${fileContext}`;
      }
    }

    const otherAttachments = attachments.filter((a) => a.type !== 'mention');

    setMessage('');
    setAttachments([]);

    await sendMessage(sessionId, fullMessage, otherAttachments.length > 0 ? otherAttachments : undefined);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Don't submit if mention autocomplete is open
    if (showMentions && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter')) {
      return; // Let MentionAutocomplete handle these
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }

    if (e.key === 'Escape' && showMentions) {
      setShowMentions(false);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleInspectElement = () => {
    setInspectorActive(true);
    toggleBrowserPanel(); // Open browser panel if not already open
  };

  const handleAtButtonClick = () => {
    // Insert @ at cursor position
    if (textareaRef.current) {
      const start = textareaRef.current.selectionStart;
      const end = textareaRef.current.selectionEnd;
      const newValue = message.slice(0, start) + '@' + message.slice(end);
      setMessage(newValue);

      // Trigger the mention autocomplete
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = start + 1;
          textareaRef.current.selectionEnd = start + 1;
          textareaRef.current.focus();

          // Manually trigger the change detection
          setShowMentions(true);
          setMentionQuery('');
          setMentionStartIndex(start);
          setMentionPosition({ top: -310, left: 0 });
        }
      }, 0);
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [message]);

  const getAttachmentIcon = (attachment: Attachment) => {
    switch (attachment.type) {
      case 'dom_element':
        return <Target size={12} className="text-blue-400" />;
      case 'image':
        return <Image size={12} className="text-green-400" />;
      case 'mention':
        return attachment.name.includes('/') || attachment.name.includes('.') ? (
          <File size={12} className="text-cyan-400" />
        ) : (
          <Folder size={12} className="text-amber-400" />
        );
      default:
        return <FileCode size={12} className="text-purple-400" />;
    }
  };

  return (
    <div
      ref={containerRef}
      className="px-4 py-2 relative font-mono border-t border-claude-border"
    >
      {/* Mention Autocomplete */}
      {showMentions && (
        <MentionAutocomplete
          sessionId={sessionId}
          query={mentionQuery}
          position={mentionPosition}
          onSelect={handleMentionSelect}
          onClose={() => setShowMentions(false)}
        />
      )}

      {/* Attachments - brutalist badges */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {attachments.map((attachment, index) => (
            <div
              key={index}
              className={`flex items-center gap-1.5 px-2 py-1 text-xs ${
                attachment.type === 'mention'
                  ? 'bg-claude-accent/20 border border-claude-accent/30'
                  : 'bg-claude-bg border border-claude-border'
              }`}
              style={{ borderRadius: 0 }}
            >
              {getAttachmentIcon(attachment)}
              <span className="truncate max-w-[180px] font-mono text-xs text-claude-text">
                {attachment.name}
              </span>
              <button
                onClick={() => removeAttachment(index)}
                className="hover:bg-claude-bg p-0.5 text-claude-text-secondary"
                style={{ borderRadius: 0 }}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input row - CLI style */}
      <div className="flex items-center gap-2">
        {/* Permission mode selector - clickable prompt indicator */}
        <button
          onClick={() => cyclePermissionMode(sessionId)}
          disabled={disabled || isSending}
          className={`font-bold text-base select-none transition-colors hover:opacity-80 disabled:opacity-40 ${modeConfig.color}`}
          title={`${modeConfig.description} (click to change)`}
        >
          {modeConfig.prompt}
        </button>

        {/* Textarea - clean CLI look with recording indicator */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={disabled ? 'session inactive...' : 'type here... (@ to mention files)'}
            disabled={disabled || isSending}
            className={`w-full py-0 resize-none focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed min-h-[24px] max-h-[200px] font-mono bg-transparent text-base text-claude-text placeholder:text-claude-text-secondary leading-6 caret-claude-accent ${
              useAudioStore.getState().recordingStates[sessionId]?.isRecording ? 'border-l-2 border-red-500 pl-2' : ''
            }`}
            rows={1}
          />
        </div>

        {/* Compact attachment buttons */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleAtButtonClick}
            disabled={disabled}
            className="p-1 transition-colors hover:bg-claude-bg disabled:opacity-40 disabled:cursor-not-allowed text-claude-text-secondary hover:text-claude-accent"
            style={{ borderRadius: 0 }}
            title="@ mention file"
          >
            <AtSign size={14} />
          </button>
          <button
            onClick={handleInspectElement}
            disabled={disabled}
            className="p-1 transition-colors hover:bg-claude-bg disabled:opacity-40 disabled:cursor-not-allowed text-claude-text-secondary"
            style={{ borderRadius: 0 }}
            title="Inspect element"
          >
            <Target size={14} />
          </button>
          <MicrophoneButton
            sessionId={sessionId}
            onInterimTranscript={(text) => {
              // Stream real-time transcript into the input box
              setMessage(text);
            }}
            onTranscriptionComplete={async (text) => {
              console.log('[InputArea] onTranscriptionComplete called with:', text);

              // Check if the transcription ends with the trigger word (configurable in settings)
              // The trigger word is escaped for use in regex
              const escapedTrigger = triggerWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const triggerPattern = new RegExp(`\\b${escapedTrigger}\\s*[.!?]?\\s*$`, 'i');

              const hasTrigger = triggerPattern.test(text);
              console.log('[InputArea] Trigger detection:', {
                triggerWord,
                escapedTrigger,
                text,
                hasTrigger,
                disabled,
                isSending,
              });

              if (hasTrigger && !disabled && !isSending) {
                // Remove the trigger word from the message
                const cleanedText = text
                  .replace(triggerPattern, '')
                  .trim();

                if (!cleanedText) {
                  setMessage('');
                  return;
                }

                // Activate audio mode for auto-play TTS on response
                setAudioMode(sessionId, true);

                // Clear input and send
                setMessage('');

                // Build message with file context if there are attachments
                let messageToSend = cleanedText;
                const fileMentions = attachments.filter((a) => a.type === 'mention');
                if (fileMentions.length > 0) {
                  const fileContext = fileMentions.map((m) => `@${m.name}`).join(', ');
                  messageToSend = `[Files: ${fileContext}]\n\n${messageToSend}`;
                }

                const otherAttachments = attachments.filter((a) => a.type !== 'mention');
                setAttachments([]);

                await sendMessage(sessionId, messageToSend, otherAttachments.length > 0 ? otherAttachments : undefined);
              } else {
                // No trigger word - keep the text in input for editing/review
                // But still enable audio mode since user is using voice
                setAudioMode(sessionId, true);
                setMessage(text);
                textareaRef.current?.focus();
              }
            }}
            disabled={disabled}
          />
        </div>
      </div>

      {/* Minimal hints + system info */}
      <div className="flex items-center gap-4 mt-1 text-xs text-claude-text-secondary font-mono" style={{ letterSpacing: '0.05em' }}>
        <span className={modeConfig.color}>{modeConfig.label}</span>
        <button
          onClick={() => cycleThinkingMode(sessionId)}
          disabled={disabled || isSending}
          className={`flex items-center gap-1 hover:opacity-80 transition-opacity disabled:opacity-40 ${thinkingConfig.color}`}
          title={`${thinkingConfig.description} (click to change)`}
        >
          <Brain size={10} />
          <span>{thinkingConfig.label}</span>
        </button>
        {isStreamingProp && systemInfo ? (
          <>
            <span className="text-claude-text-secondary">{systemInfo.model || 'claude'}</span>
            {systemInfo.tools && systemInfo.tools.length > 0 && (
              <span className="text-claude-text-secondary">{systemInfo.tools.length} TOOLS</span>
            )}
          </>
        ) : (
          <>
            <span>@ FILE</span>
            <span>ENTER SEND</span>
          </>
        )}

        {/* Task progress */}
        {todoStats && (
          <button
            onClick={() => setShowTodoList(!showTodoList)}
            className="flex items-center gap-1.5 hover:text-claude-text transition-colors"
            title="Click to view all tasks"
          >
            <ProgressCircle completed={todoStats.completed} total={todoStats.total} />
            <span className={todoStats.completed === todoStats.total ? 'text-green-500' : 'text-claude-accent'}>
              {activeTask ? (activeTask.activeForm || activeTask.content) : `${todoStats.completed}/${todoStats.total}`}
            </span>
          </button>
        )}
      </div>

      {/* Expandable task list */}
      {showTodoList && todoStats && (
        <div className="mt-2 p-2 border border-claude-border bg-claude-bg text-xs font-mono" style={{ borderRadius: 0 }}>
          <div className="flex items-center justify-between mb-2 pb-1 border-b border-claude-border">
            <span className="text-claude-text-secondary" style={{ letterSpacing: '0.05em' }}>TASKS</span>
            <span className="text-claude-text-secondary">{todoStats.completed}/{todoStats.total}</span>
          </div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {currentTodos.map((todo, index) => (
              <div key={index} className="flex items-center gap-2">
                {todo.status === 'completed' ? (
                  <span className="text-green-500">✓</span>
                ) : todo.status === 'in_progress' ? (
                  <span className="text-claude-accent animate-pulse">●</span>
                ) : (
                  <span className="text-claude-text-secondary">○</span>
                )}
                <span className={
                  todo.status === 'completed'
                    ? 'text-claude-text-secondary line-through'
                    : todo.status === 'in_progress'
                    ? 'text-claude-text'
                    : 'text-claude-text-secondary'
                }>
                  {todo.content}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
