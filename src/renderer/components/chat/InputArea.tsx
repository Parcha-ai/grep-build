import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Paperclip, X, Image, FileCode, Target, File, Folder, AtSign } from 'lucide-react';
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
      className="px-4 py-2 relative font-mono border-t border-claude-border/30"
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
              <span className="truncate max-w-[180px] font-mono text-[10px] text-claude-text">
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
        {/* CLI prompt indicator */}
        <span className="text-claude-accent font-bold text-sm select-none -mt-0.5">&gt;</span>

        {/* Textarea - clean CLI look */}
        <div className="flex-1">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={disabled ? 'session inactive...' : 'type here... (@ to mention files)'}
            disabled={disabled || isSending}
            className="w-full py-0 resize-none focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed min-h-[24px] max-h-[200px] font-mono text-sm bg-transparent text-claude-text placeholder:text-claude-text-secondary leading-6 caret-claude-accent"
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
          <button
            disabled={disabled}
            className="p-1 transition-colors hover:bg-claude-bg disabled:opacity-40 disabled:cursor-not-allowed text-claude-text-secondary"
            style={{ borderRadius: 0 }}
            title="Attach"
          >
            <Paperclip size={14} />
          </button>
        </div>
      </div>

      {/* Minimal hints */}
      <div className="flex items-center gap-4 mt-1 text-[9px] text-claude-text-secondary font-mono" style={{ letterSpacing: '0.05em' }}>
        <span>@ FILE</span>
        <span>ENTER SEND</span>
        <span>SHIFT+↵ NEWLINE</span>
      </div>
    </div>
  );
}
