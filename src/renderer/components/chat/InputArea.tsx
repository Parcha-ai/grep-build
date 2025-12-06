import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Paperclip, X, Image, FileCode, Target, File, Folder, AtSign } from 'lucide-react';
import { useSessionStore } from '../../stores/session.store';
import { useUIStore } from '../../stores/ui.store';
import MentionAutocomplete, { type Mention } from './MentionAutocomplete';

interface InputAreaProps {
  sessionId: string;
  disabled?: boolean;
}

interface Attachment {
  type: 'file' | 'image' | 'dom_element' | 'mention';
  name: string;
  content: string;
  path?: string;
}

export default function InputArea({ sessionId, disabled }: InputAreaProps) {
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionPosition, setMentionPosition] = useState({ top: 0, left: 0 });
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { sendMessage, isStreaming } = useSessionStore();
  const { selectedElement, setSelectedElement, setInspectorActive, toggleBrowserPanel } = useUIStore();

  const isSending = isStreaming[sessionId] || false;

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
          const containerRect = containerRef.current.getBoundingClientRect();
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
        return <Target size={14} className="text-blue-400" />;
      case 'image':
        return <Image size={14} className="text-green-400" />;
      case 'mention':
        return attachment.name.includes('/') || attachment.name.includes('.') ? (
          <File size={14} className="text-cyan-400" />
        ) : (
          <Folder size={14} className="text-amber-400" />
        );
      default:
        return <FileCode size={14} className="text-purple-400" />;
    }
  };

  return (
    <div ref={containerRef} className="border-t border-claude-border bg-claude-surface p-4 relative">
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

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {attachments.map((attachment, index) => (
            <div
              key={index}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${
                attachment.type === 'mention'
                  ? 'bg-claude-accent/20 border border-claude-accent/30'
                  : 'bg-claude-bg'
              }`}
            >
              {getAttachmentIcon(attachment)}
              <span className="truncate max-w-[200px] font-mono text-xs">{attachment.name}</span>
              <button
                onClick={() => removeAttachment(index)}
                className="text-claude-text-secondary hover:text-claude-text"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="flex items-end gap-2">
        {/* Attachment buttons */}
        <div className="flex items-center gap-1 pb-2">
          <button
            onClick={handleAtButtonClick}
            disabled={disabled}
            className="p-2 rounded-lg hover:bg-claude-bg transition-colors text-claude-text-secondary hover:text-claude-accent disabled:opacity-50 disabled:cursor-not-allowed"
            title="Mention file or folder (@)"
          >
            <AtSign size={18} />
          </button>
          <button
            onClick={handleInspectElement}
            disabled={disabled}
            className="p-2 rounded-lg hover:bg-claude-bg transition-colors text-claude-text-secondary hover:text-claude-text disabled:opacity-50 disabled:cursor-not-allowed"
            title="Select element from browser"
          >
            <Target size={18} />
          </button>
          <button
            disabled={disabled}
            className="p-2 rounded-lg hover:bg-claude-bg transition-colors text-claude-text-secondary hover:text-claude-text disabled:opacity-50 disabled:cursor-not-allowed"
            title="Attach file"
          >
            <Paperclip size={18} />
          </button>
        </div>

        {/* Textarea */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={disabled ? 'Start the session to chat...' : 'Ask Claude anything... (@ to mention files)'}
            disabled={disabled || isSending}
            className="w-full px-4 py-3 bg-claude-bg border border-claude-border rounded-xl resize-none focus:outline-none focus:border-claude-accent disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px] max-h-[200px]"
            rows={1}
          />
        </div>

        {/* Send button */}
        <button
          onClick={handleSubmit}
          disabled={(!message.trim() && attachments.length === 0) || disabled || isSending}
          className="p-3 bg-claude-accent rounded-xl hover:bg-claude-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
        >
          <Send size={18} className="text-white" />
        </button>
      </div>

      {/* Hints */}
      <div className="flex items-center gap-4 mt-2 text-xs text-claude-text-secondary">
        <span>
          <kbd className="px-1.5 py-0.5 bg-claude-bg rounded">@</kbd> mention file
        </span>
        <span>
          <kbd className="px-1.5 py-0.5 bg-claude-bg rounded">Enter</kbd> to send
        </span>
        <span>
          <kbd className="px-1.5 py-0.5 bg-claude-bg rounded">Shift + Enter</kbd> new line
        </span>
      </div>
    </div>
  );
}
