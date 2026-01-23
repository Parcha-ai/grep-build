import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Paperclip, X, Image, FileCode, Target, File, Folder, AtSign, Brain, Square, Code } from 'lucide-react';
import { useSessionStore, type PermissionMode, type ThinkingMode, type ModelInfo } from '../../stores/session.store';
import { useUIStore } from '../../stores/ui.store';
import { useAudioStore } from '../../stores/audio.store';
import MentionAutocomplete, { type Mention } from './MentionAutocomplete';
import CommandAutocomplete from './CommandAutocomplete';
import { MicrophoneButton, type VoiceModeHandle } from './MicrophoneButton';
import { MessageQueuePanel } from './MessageQueuePanel';

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
    label: 'ACCEPT EDITS',
    color: 'text-green-400',
    description: 'Auto-accept edits',
  },
  default: {
    prompt: '>',
    label: 'ASK',
    color: 'text-amber-400',
    description: 'Require approval',
  },
  bypassPermissions: {
    prompt: '>>>',
    label: 'GREP IT!',
    color: 'text-purple-400',
    description: 'Autonomous mode with Ralph Loop',
  },
  plan: {
    prompt: '?',
    label: 'PLAN',
    color: 'text-blue-400',
    description: 'Planning mode (no execution)',
  },
  dontAsk: {
    prompt: '#',
    label: 'DENY',
    color: 'text-gray-500',
    description: "Don't ask (deny if not pre-approved)",
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
  subType?: 'file' | 'folder' | 'symbol'; // For mentions: preserves the original type
}

export default function InputArea({ sessionId, disabled, systemInfo, isStreaming: isStreamingProp }: InputAreaProps) {
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionPosition, setMentionPosition] = useState({ top: 0, left: 0 });
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);
  const [showTodoList, setShowTodoList] = useState(false);
  const [escapeKeyCount, setEscapeKeyCount] = useState(0);
  const [escapeTimeout, setEscapeTimeout] = useState<NodeJS.Timeout | null>(null);
  const [showEscapeWarning, setShowEscapeWarning] = useState(false);

  // Message history state
  const [messageHistory, setMessageHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyDropdownRef = useRef<HTMLDivElement>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const voiceModeRef = useRef<VoiceModeHandle>(null);

  // Voice mode state (CMD shortcuts disabled - users click microphone button)
  const { sendMessage, interruptAndSend, isStreaming, permissionMode, cyclePermissionMode, thinkingMode, cycleThinkingMode, currentToolCalls, messages, sessions, messageQueue, selectedModel, setSelectedModel, availableModels, loadAvailableModels } = useSessionStore();
  const { selectedElement, setSelectedElement, sessionInspectorActive, setSessionInspectorActive, toggleBrowserPanel } = useUIStore();
  const { settings: audioSettings, setAudioMode, voiceModeStates } = useAudioStore();

  // Voice mode state for this session
  const voiceState = voiceModeStates[sessionId];
  const isVoiceModeActive = voiceState?.isConnected || false;

  // Animation time for wave visualization
  const [waveTime, setWaveTime] = useState(0);
  useEffect(() => {
    if (!isVoiceModeActive) return;
    const interval = setInterval(() => {
      setWaveTime(Date.now() / 200);  // Update ~60fps worth of animation time
    }, 50);  // 20fps is enough for smooth wave animation
    return () => clearInterval(interval);
  }, [isVoiceModeActive]);

  // Command/Skill/Agent autocomplete state
  const [showCommands, setShowCommands] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [commandType, setCommandType] = useState<'command' | 'skill' | 'agent'>('command');
  const [commandPosition, setCommandPosition] = useState({ top: 0, left: 0 });
  const [commandStartIndex, setCommandStartIndex] = useState(-1);
  const [commands, setCommands] = useState<any[]>([]);
  const [skills, setSkills] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);

  // Get the configurable trigger word (default: "please")
  const triggerWord = audioSettings?.voiceTriggerWord || 'please';

  const currentMode = permissionMode[sessionId] || 'acceptEdits';
  const modeConfig = PERMISSION_MODE_CONFIG[currentMode];
  const currentThinkingMode = thinkingMode[sessionId] || 'thinking';
  const thinkingConfig = THINKING_MODE_CONFIG[currentThinkingMode];

  const isSending = isStreaming[sessionId] || false;
  const queuedMessages = messageQueue[sessionId] || [];
  const hasQueuedMessages = queuedMessages.length > 0;

  // Model selector state
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const currentModel = selectedModel[sessionId] || 'claude-opus-4-5-20251101';

  // Get current model display name
  const currentModelInfo = useMemo(() => {
    const model = availableModels.find(m => m.id === currentModel);
    return model || { id: currentModel, name: currentModel.split('-').slice(1, 3).join(' ').toUpperCase(), description: '' };
  }, [availableModels, currentModel]);

  // Load available models on mount
  useEffect(() => {
    if (availableModels.length === 0) {
      loadAvailableModels();
    }
  }, []);

  // Load message history from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`grep-history-${sessionId}`);
      if (stored) {
        setMessageHistory(JSON.parse(stored));
      }
    } catch {
      // Ignore parse errors
    }
  }, [sessionId]);

  // Close history dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (historyDropdownRef.current && !historyDropdownRef.current.contains(event.target as Node)) {
        setShowHistory(false);
        setHistoryIndex(-1);
      }
    };
    if (showHistory) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showHistory]);

  // Close model dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setShowModelDropdown(false);
      }
    };
    if (showModelDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showModelDropdown]);

  // Listen for insert-chat events from browser preview - adds element context as attachments (chips)
  useEffect(() => {
    interface InsertChatDetail {
      sessionId: string;
      content: string;
      screenshot?: string;
      elementContext?: {
        selector: string;
        outerHTML: string;
        tagName: string;
        reactComponent?: string;
      };
    }
    const handleInsertChat = (event: CustomEvent<InsertChatDetail>) => {
      const { sessionId: targetSessionId, content, screenshot, elementContext } = event.detail;
      if (targetSessionId !== sessionId) return;

      console.log('[InputArea] Received grep-insert-chat event');

      const newAttachments: Attachment[] = [];

      // Add element context as a dom_element attachment (shows as chip, sent as context)
      if (elementContext) {
        const displayName = elementContext.reactComponent
          ? `<${elementContext.reactComponent}>`
          : elementContext.selector || `<${elementContext.tagName.toLowerCase()}>`;

        newAttachments.push({
          type: 'dom_element',
          name: displayName,
          content: elementContext.outerHTML,
        });
      }

      // Add screenshot as an image attachment
      if (screenshot) {
        newAttachments.push({
          type: 'image',
          name: 'element-screenshot.png',
          content: screenshot,
        });
      }

      // Add attachments (context shown as chips, no visible text)
      if (newAttachments.length > 0) {
        setAttachments(prev => [...prev, ...newAttachments]);
      }

      // Only set message if there's explicit content (not element metadata)
      if (content && content.trim()) {
        setMessage(prev => {
          if (prev.trim()) {
            return prev + '\n\n' + content;
          }
          return content;
        });
      }

      // Focus the textarea
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
    };

    window.addEventListener('grep-insert-chat', handleInsertChat as EventListener);
    return () => window.removeEventListener('grep-insert-chat', handleInsertChat as EventListener);
  }, [sessionId]);

  // Listen for send-annotation events - sends IMMEDIATELY AND populates input for editing option
  useEffect(() => {
    const handleSendAnnotation = (event: CustomEvent<{ sessionId: string; content: string; screenshot?: string; alsoPopulateInput?: boolean }>) => {
      const { sessionId: targetSessionId, content, screenshot, alsoPopulateInput } = event.detail;
      if (targetSessionId !== sessionId) return;

      console.log('[InputArea] Received grep-send-annotation event - sending immediately');

      // Build attachments array if there's a screenshot
      const annotationAttachments: Attachment[] = [];
      if (screenshot) {
        annotationAttachments.push({
          type: 'image',
          name: 'element-screenshot.png',
          content: screenshot,
        });
      }

      // Send the message immediately
      sendMessage(sessionId, content, annotationAttachments.length > 0 ? annotationAttachments : undefined);

      // Also populate the input and attachments so user can see/edit for next annotation
      if (alsoPopulateInput) {
        setMessage(content);
        if (screenshot) {
          setAttachments([{
            type: 'image',
            name: 'element-screenshot.png',
            content: screenshot,
          }]);
        }
      }
    };

    window.addEventListener('grep-send-annotation', handleSendAnnotation as EventListener);
    return () => window.removeEventListener('grep-send-annotation', handleSendAnnotation as EventListener);
  }, [sessionId, sendMessage]);

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

  // Helper function to extract subagent type from Task tool input
  const getSubagentType = (input: Record<string, unknown>): string | null => {
    const description = (input.description as string) || '';
    const prompt = (input.prompt as string) || '';
    const combined = `${description} ${prompt}`.toLowerCase();

    if (combined.includes('explore') || combined.includes('search')) return 'EXPLORE';
    if (combined.includes('plan')) return 'PLAN';
    if (combined.includes('implement') || combined.includes('code') || combined.includes('bond')) return 'IMPLEMENT';
    if (combined.includes('document') || combined.includes('moneypenny')) return 'DOCUMENT';
    if (combined.includes('test') || combined.includes('verify') || combined.includes('scaramanga')) return 'TEST';
    if (combined.includes('q') || combined.includes('briefing')) return 'BRIEF';

    if (input.subagent_type) {
      return (input.subagent_type as string).toUpperCase();
    }

    return null;
  };

  // Detect active subagent (Task tool)
  const activeSubagent = useMemo(() => {
    const streamingToolCalls = currentToolCalls[sessionId] || [];
    const activeTask = streamingToolCalls.find(tc =>
      tc.name === 'Task' && (tc.status === 'running' || tc.status === 'pending')
    );
    if (activeTask) {
      const type = getSubagentType(activeTask.input);
      const description = (activeTask.input.description as string) || (activeTask.input.prompt as string) || '';
      return { type, description };
    }
    return null;
  }, [sessionId, currentToolCalls]);

  // Handle selected element from browser inspector
  useEffect(() => {
    console.log('[InputArea] selectedElement changed:', selectedElement);
    if (selectedElement) {
      const element = selectedElement as {
        selector: string;
        outerHTML: string;
        screenshot?: string;
        tagName?: string;
        reactComponent?: string;
      };
      console.log('[InputArea] Adding DOM element attachment:', element.selector);

      setAttachments((prev) => {
        const newAttachments = [...prev];

        // Add the DOM element info
        const displayName = element.reactComponent
          ? `${element.reactComponent} (${element.tagName})`
          : element.selector || 'DOM Element';

        newAttachments.push({
          type: 'dom_element' as const,
          name: displayName,
          content: element.outerHTML || '',
        });

        // Add screenshot if available
        if (element.screenshot && element.screenshot.length > 0) {
          console.log('[InputArea] Adding element screenshot, size:', element.screenshot.length);
          newAttachments.push({
            type: 'image' as const,
            name: `element-screenshot-${Date.now()}.png`,
            content: element.screenshot,
          });
        }

        console.log('[InputArea] New attachments count:', newAttachments.length);
        return newAttachments;
      });
      setSelectedElement(null);
    }
  }, [selectedElement, setSelectedElement]);

  // Load commands, skills, and agents when session changes
  useEffect(() => {
    const currentSession = sessions.find(s => s.id === sessionId);
    if (!currentSession) return;

    const projectPath = currentSession.worktreePath;

    // Load all extensions
    Promise.all([
      window.electronAPI.extensions.scanCommands(projectPath),
      window.electronAPI.extensions.scanSkills(projectPath),
      window.electronAPI.extensions.scanAgents(projectPath),
    ]).then(([cmds, skls, agts]) => {
      setCommands(cmds);
      setSkills(skls);
      setAgents(agts);
    }).catch(err => {
      console.error('[InputArea] Error loading extensions:', err);
    });
  }, [sessionId, sessions]);

  // Detect @ mentions, slash commands, and @agent mentions in text
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    setMessage(value);

    const textBeforeCursor = value.slice(0, cursorPos);

    // Check for slash commands at the start of input
    if (value.startsWith('/') && cursorPos > 0) {
      const commandText = textBeforeCursor.slice(1);
      if (!/\s/.test(commandText)) {
        // Position autocomplete above the input container
        if (containerRef.current) {
          const containerRect = containerRef.current.getBoundingClientRect();

          // Position above the input area (dropdown height ~250px, add margin)
          setCommandPosition({
            top: Math.max(10, containerRect.top - 270), // Ensure at least 10px from top
            left: containerRect.left
          });
        }

        setShowCommands(true);
        setCommandType('command');
        setCommandQuery(commandText);
        setCommandStartIndex(0);
        setShowMentions(false);
        return;
      }
    }

    // Check for @agent- mentions
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
      const charBeforeAt = value[lastAtIndex - 1];
      const isValidStart = lastAtIndex === 0 || /\s/.test(charBeforeAt);
      const hasNoSpaces = !/\s/.test(textAfterAt);

      if (isValidStart && hasNoSpaces) {
        // Check if it's @agent- pattern (for subagents)
        if (textAfterAt.startsWith('agent-')) {
          // Position autocomplete above the input container
          if (containerRef.current) {
            const containerRect = containerRef.current.getBoundingClientRect();

            // Position above the input area (dropdown height ~250px, add margin)
            setCommandPosition({
              top: Math.max(10, containerRect.top - 270), // Ensure at least 10px from top
              left: containerRect.left
            });
          }

          setShowCommands(true);
          setCommandType('agent');
          setCommandQuery(textAfterAt.replace('agent-', ''));
          setCommandStartIndex(lastAtIndex);
          setShowMentions(false);
          return;
        }

        // Regular file @mention
        setShowMentions(true);
        setMentionQuery(textAfterAt);
        setMentionStartIndex(lastAtIndex);
        setMentionPosition({ top: -310, left: 0 });
        setShowCommands(false);
        return;
      }
    }

    // No autocomplete triggers found
    setShowMentions(false);
    setMentionQuery('');
    setMentionStartIndex(-1);
    setShowCommands(false);
    setCommandQuery('');
    setCommandStartIndex(-1);
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
          subType: mention.type, // Preserve whether it's a file, folder, or symbol
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

  // Handle command/skill/agent selection
  const handleCommandSelect = useCallback(
    async (item: any) => {
      const currentSession = sessions.find(s => s.id === sessionId);
      const projectPath = currentSession?.worktreePath;
      const itemType = item.itemType || commandType;

      if (itemType === 'command') {
        // Load command content and replace the /command with it
        try {
          const content = await window.electronAPI.extensions.getCommand(item.name, projectPath);
          if (content) {
            // Remove leading comment if present
            const lines = content.split('\n');
            const cleanContent = lines.filter((l: string) => !l.trim().startsWith('<!--')).join('\n').trim();

            // Replace /command with the command content
            const afterCommand = message.slice(commandStartIndex + item.name.length + 1);
            setMessage(cleanContent + (afterCommand ? ' ' + afterCommand : ''));
          }
        } catch (err) {
          console.error('[InputArea] Error loading command:', err);
        }
      } else if (itemType === 'skill') {
        // Skills are invoked via Skill tool - just insert /skill-name as is
        const before = message.slice(0, commandStartIndex);
        const after = message.slice(textareaRef.current?.selectionStart || commandStartIndex);
        setMessage(before + `/${item.name}` + after);
      } else if (itemType === 'agent') {
        // Replace @agent-name with just the agent mention
        const before = message.slice(0, commandStartIndex);
        const after = message.slice(textareaRef.current?.selectionStart || commandStartIndex);
        setMessage(before + `@agent-${item.name}` + after);
      }

      setShowCommands(false);
      setCommandQuery('');
      setCommandStartIndex(-1);
      textareaRef.current?.focus();
    },
    [message, commandStartIndex, commandType, sessionId, sessions]
  );

  // Save message to history
  const saveToHistory = useCallback((msg: string) => {
    if (!msg.trim()) return;

    setMessageHistory(prev => {
      // Don't add duplicates of the last entry
      if (prev.length > 0 && prev[0] === msg) return prev;

      // Add to front, limit to 50 entries
      const newHistory = [msg, ...prev.filter(h => h !== msg)].slice(0, 50);

      // Persist to localStorage
      try {
        localStorage.setItem(`grep-history-${sessionId}`, JSON.stringify(newHistory));
      } catch {
        // Ignore storage errors
      }

      return newHistory;
    });
  }, [sessionId]);

  // Select a history item
  const selectHistoryItem = useCallback((item: string) => {
    setMessage(item);
    setShowHistory(false);
    setHistoryIndex(-1);
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    if (!message.trim() && attachments.length === 0) return;
    if (disabled) return;
    // Note: We don't block on isSending - the store handles queueing if already streaming

    // Save to history before sending
    saveToHistory(message.trim());

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
    console.log('[InputArea] Submitting with attachments:', otherAttachments.length);
    otherAttachments.forEach((a, i) => {
      console.log(`[InputArea] Attachment ${i}: type=${a.type}, name=${a.name}, content length=${a.content?.length || 0}`);
    });

    // Capture attachments before clearing state
    const attachmentsToSend = otherAttachments.length > 0 ? [...otherAttachments] : undefined;

    setMessage('');
    setAttachments([]);

    await sendMessage(sessionId, fullMessage, attachmentsToSend);
  };

  const handleStopStreaming = useCallback(() => {
    if (isSending) {
      // Use store's cancelStream to preserve partial content
      useSessionStore.getState().cancelStream(sessionId);
    }
  }, [isSending, sessionId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Don't submit if any autocomplete is open
    if ((showMentions || showCommands) && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter')) {
      return; // Let autocomplete components handle these
    }

    // Handle history navigation
    if (showHistory && messageHistory.length > 0) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHistoryIndex(prev => Math.min(prev + 1, messageHistory.length - 1));
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHistoryIndex(prev => {
          if (prev <= 0) {
            setShowHistory(false);
            return -1;
          }
          return prev - 1;
        });
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (historyIndex >= 0 && historyIndex < messageHistory.length) {
          selectHistoryItem(messageHistory[historyIndex]);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowHistory(false);
        setHistoryIndex(-1);
        return;
      }
    }

    // ArrowUp at start of input or empty input shows history
    if (e.key === 'ArrowUp' && messageHistory.length > 0) {
      const textarea = textareaRef.current;
      const cursorAtStart = !textarea || textarea.selectionStart === 0;
      const inputEmpty = !message.trim();

      if (cursorAtStart || inputEmpty) {
        e.preventDefault();
        setShowHistory(true);
        setHistoryIndex(0);
        return;
      }
    }

    // Shift+Tab to cycle permission modes
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      cyclePermissionMode(sessionId);
      return;
    }

    // CMD+Enter: Force send - interrupt agent if streaming and send immediately
    if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault();
      if (!message.trim() && attachments.length === 0) return;
      if (disabled) return;

      // Save to history before sending
      saveToHistory(message.trim());

      // Deactivate audio mode when typing manually
      setAudioMode(sessionId, false);

      // Build message with file context
      let fullMessage = message.trim();
      const fileMentions = attachments.filter((a) => a.type === 'mention');
      if (fileMentions.length > 0) {
        const fileContext = fileMentions.map((m) => `@${m.name}`).join(', ');
        if (fullMessage) {
          fullMessage = `[Files: ${fileContext}]\n\n${fullMessage}`;
        } else {
          fullMessage = `Looking at: ${fileContext}`;
        }
      }

      const otherAttachments = attachments.filter((a) => a.type !== 'mention');
      const attachmentsToSend = otherAttachments.length > 0 ? [...otherAttachments] : undefined;

      // Clear input immediately
      setMessage('');
      setAttachments([]);

      // Use interruptAndSend which properly cancels stream then sends
      interruptAndSend(sessionId, fullMessage, attachmentsToSend);
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }

    if (e.key === 'Escape') {
      // Close autocompletes first
      if (showMentions) {
        setShowMentions(false);
        return;
      }
      if (showCommands) {
        setShowCommands(false);
        return;
      }

      // Double-escape to stop streaming
      if (isSending) {
        // Clear any existing timeout
        if (escapeTimeout) {
          clearTimeout(escapeTimeout);
        }

        const newCount = escapeKeyCount + 1;
        setEscapeKeyCount(newCount);

        if (newCount >= 2) {
          // Stop streaming
          handleStopStreaming();
          setEscapeKeyCount(0);
          setEscapeTimeout(null);
          setShowEscapeWarning(false);
        } else {
          // Show warning on first press
          setShowEscapeWarning(true);

          // Set timeout to reset counter and hide warning
          const timeout = setTimeout(() => {
            setEscapeKeyCount(0);
            setEscapeTimeout(null);
            setShowEscapeWarning(false);
          }, 500); // 500ms window for double-escape
          setEscapeTimeout(timeout);
        }
      }
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // Handle paste event for images
  const handlePaste = async (e: React.ClipboardEvent) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) {
      console.log('[InputArea] No clipboardData available');
      return;
    }

    const items = clipboardData.items;
    const files = clipboardData.files;

    console.log('[InputArea] Paste event - items:', items?.length || 0, 'files:', files?.length || 0);
    console.log('[InputArea] Available types:', clipboardData.types.join(', '));

    // Try files first (more reliable for some browsers)
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        console.log('[InputArea] File from clipboardData.files:', file.name, file.type, file.size);
        if (file.type.startsWith('image/')) {
          e.preventDefault();
          await processImageFile(file);
        }
      }
    }

    // Also check items (DataTransferItemList)
    if (items) {
      const itemsArray = Array.from(items);
      for (const item of itemsArray) {
        console.log('[InputArea] Clipboard item - type:', item.type, 'kind:', item.kind);

        // Check for image types (including variations)
        const isImage = item.type.startsWith('image/') ||
                       item.type === 'image' ||
                       (item.kind === 'file' && item.type.includes('image'));

        if (isImage && item.kind === 'file') {
          e.preventDefault();

          const file = item.getAsFile();
          if (!file) {
            console.log('[InputArea] Could not get file from clipboard item');
            continue;
          }

          // Check if we already processed this file from clipboardData.files
          // (some browsers provide the same file in both places)
          const alreadyProcessed = attachments.some(a =>
            a.type === 'image' && a.name.includes(`${file.size}`)
          );
          if (!alreadyProcessed) {
            await processImageFile(file);
          }
        }
      }
    }

    async function processImageFile(file: File) {
      console.log('[InputArea] Processing image file:', file.name, file.type, file.size);

      return new Promise<void>((resolve) => {
        const reader = new FileReader();

        reader.onload = () => {
          const base64 = reader.result as string;
          console.log('[InputArea] FileReader completed, result length:', base64?.length || 0);

          // Extract just the base64 data (remove data:image/xxx;base64, prefix)
          const base64Data = base64.split(',')[1] || base64;
          console.log('[InputArea] Base64 data extracted, length:', base64Data.length);

          const imageAttachment: Attachment = {
            type: 'image',
            name: `pasted-image-${Date.now()}.${file.type.split('/')[1] || 'png'}`,
            content: base64Data,
          };

          setAttachments(prev => {
            console.log('[InputArea] Adding attachment to state. Current count:', prev.length);
            return [...prev, imageAttachment];
          });
          console.log('[InputArea] Image pasted and attached:', imageAttachment.name, 'content length:', base64Data.length);
          resolve();
        };

        reader.onerror = (error) => {
          console.error('[InputArea] FileReader error:', error);
          resolve();
        };

        reader.readAsDataURL(file);
      });
    }
  };

  // Get inspector state for this session
  const inspectorActive = sessionInspectorActive[sessionId] || false;

  const handleInspectElement = () => {
    // Toggle inspector - if already active, turn it off
    if (inspectorActive) {
      setSessionInspectorActive(sessionId, false);
    } else {
      setSessionInspectorActive(sessionId, true);
      toggleBrowserPanel(); // Open browser panel if not already open
    }
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

  // Voice mode hotkeys: DISABLED
  // CMD shortcuts were causing accidental voice mode triggers
  // Users should click the microphone button to toggle voice mode

  const getAttachmentIcon = (attachment: Attachment) => {
    switch (attachment.type) {
      case 'dom_element':
        return <Target size={12} className="text-blue-400" />;
      case 'image':
        return <Image size={12} className="text-green-400" />;
      case 'mention':
        // Use the actual subType instead of guessing from the name
        if (attachment.subType === 'folder') {
          return <Folder size={12} className="text-amber-400" />;
        } else if (attachment.subType === 'symbol') {
          return <Code size={12} className="text-purple-400" />;
        } else {
          return <File size={12} className="text-cyan-400" />;
        }
      default:
        return <FileCode size={12} className="text-purple-400" />;
    }
  };

  return (
    <>
      {/* Message Queue Panel */}
      <MessageQueuePanel sessionId={sessionId} />

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

      {/* Command/Skill/Agent Autocomplete */}
      {showCommands && (
        <CommandAutocomplete
          query={commandQuery}
          type={commandType}
          commands={commands}
          skills={skills}
          agents={agents}
          position={commandPosition}
          onSelect={handleCommandSelect}
          onClose={() => setShowCommands(false)}
        />
      )}

      {/* Message History Dropdown */}
      {showHistory && messageHistory.length > 0 && (
        <div
          ref={historyDropdownRef}
          className="absolute bottom-full left-0 right-0 mb-1 max-h-64 overflow-y-auto bg-claude-surface border border-claude-border shadow-lg z-50"
          style={{ borderRadius: 0 }}
        >
          <div className="px-3 py-1.5 text-xs text-claude-text-secondary font-mono border-b border-claude-border flex items-center justify-between">
            <span>HISTORY</span>
            <span className="text-[10px]">↑↓ navigate • Enter select • Esc close</span>
          </div>
          {messageHistory.map((item, index) => (
            <button
              key={index}
              onClick={() => selectHistoryItem(item)}
              className={`w-full text-left px-3 py-2 font-mono text-sm transition-colors ${
                index === historyIndex
                  ? 'bg-claude-accent/20 text-claude-text'
                  : 'text-claude-text-secondary hover:bg-claude-bg hover:text-claude-text'
              }`}
            >
              <div className="truncate">{item}</div>
            </button>
          ))}
        </div>
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

      {/* Escape warning message */}
      {showEscapeWarning && (
        <div className="mb-2 px-3 py-2 bg-amber-500/20 border border-amber-500/50 flex items-center gap-2 animate-fade-in">
          <span className="text-amber-200 text-xs font-mono uppercase" style={{ letterSpacing: '0.05em' }}>
            Press ESC again to stop Claudette
          </span>
        </div>
      )}

      {/* Input row - CLI style */}
      <div className="flex items-center gap-2">
        {/* Permission mode selector - clickable prompt indicator */}
        {!isVoiceModeActive && (
          <button
            onClick={() => cyclePermissionMode(sessionId)}
            disabled={disabled || isSending}
            className={`font-bold text-base select-none transition-colors hover:opacity-80 disabled:opacity-40 ${modeConfig.color}`}
            title={`${modeConfig.description} (click to change)`}
          >
            {modeConfig.prompt}
          </button>
        )}

        {/* Voice Mode UI or Textarea */}
        <div className="flex-1 relative min-w-0">
          {isVoiceModeActive ? (
            /* Voice Mode Active - Clean display with animated audio visualization */
            <div className="flex items-start gap-3 py-1 min-h-[24px] min-w-0">
              {/* Audio wave visualization - reacts to voice input */}
              <div className="flex items-center gap-[2px] h-6">
                {[...Array(12)].map((_, i) => {
                  const isAgentTalking = voiceState?.isSpeaking;
                  const audioLevel = voiceState?.audioLevel || 0;
                  // Create wave pattern - each bar has slightly different phase
                  const phase = Math.sin(waveTime + i * 0.5);
                  // When user is speaking (audioLevel > 0), use audio level to scale
                  // When idle, use a gentle wave animation
                  const dynamicScale = isAgentTalking
                    ? 0.6 + phase * 0.4  // Agent speaking: moderate animated wave
                    : audioLevel > 0.05
                      ? 0.3 + audioLevel * 0.7 * (0.8 + Math.abs(phase) * 0.2)  // User speaking: audio-reactive
                      : 0.25 + Math.abs(phase) * 0.15;  // Idle: gentle pulse
                  return (
                    <div
                      key={i}
                      className={`w-[2px] rounded-full transition-all duration-75 ${
                        isAgentTalking ? 'bg-claude-accent' : 'bg-green-400'
                      }`}
                      style={{
                        height: '16px',
                        transform: `scaleY(${dynamicScale})`,
                        opacity: isAgentTalking ? 1 : (audioLevel > 0.05 ? 0.8 + audioLevel * 0.2 : 0.5 + Math.abs(phase) * 0.2),
                      }}
                    />
                  );
                })}
              </div>

              {/* Status text - wraps to multiple lines */}
              <div className="flex-1 min-w-0">
                {voiceState?.agentResponse ? (
                  <span className={`font-mono text-sm block ${
                    voiceState?.isSpeaking ? 'grep-speaking-shimmer' : 'text-claude-text'
                  }`}>
                    {voiceState.agentResponse}
                  </span>
                ) : voiceState?.isSpeaking ? (
                  <span className="font-mono text-sm text-claude-accent grep-speaking-shimmer block">
                    Speaking...
                  </span>
                ) : voiceState?.transcript ? (
                  <span className="font-mono text-sm text-green-400 block">
                    {voiceState.transcript}
                  </span>
                ) : (
                  <span className="font-mono text-sm text-green-400/70 block">
                    Listening...
                  </span>
                )}
              </div>
              {/* Shimmer effect for Grep speaking */}
              <style>{`
                @keyframes grepShimmer {
                  0% {
                    background-position: -200% center;
                  }
                  100% {
                    background-position: 200% center;
                  }
                }
                .grep-speaking-shimmer {
                  background: linear-gradient(
                    90deg,
                    #8B5CF6 0%,
                    #A78BFA 25%,
                    #C4B5FD 50%,
                    #A78BFA 75%,
                    #8B5CF6 100%
                  );
                  background-size: 200% auto;
                  background-clip: text;
                  -webkit-background-clip: text;
                  color: transparent;
                  animation: grepShimmer 2s linear infinite;
                }
              `}</style>

              {/* Simple status indicator */}
              <div className="flex items-center gap-1.5 text-xs font-mono">
                <span className={`h-2 w-2 rounded-full ${
                  voiceState?.isSpeaking ? 'bg-claude-accent' : 'bg-green-400'
                }`} />
                <span className={voiceState?.isSpeaking ? 'text-claude-accent' : 'text-green-400'}>
                  {voiceState?.isSpeaking ? 'SPEAKING' : 'LISTENING'}
                </span>
              </div>
            </div>
          ) : (
            /* Regular Textarea */
            <textarea
              ref={textareaRef}
              value={message}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={disabled ? 'session inactive...' : isSending ? `type to queue message${hasQueuedMessages ? ` (${queuedMessages.length} queued)` : ''}...` : 'type here... (@ to mention, paste images)'}
              disabled={disabled}
              className={`w-full py-0 resize-none focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed min-h-[24px] max-h-[200px] font-mono bg-transparent text-base text-claude-text placeholder:text-claude-text-secondary leading-6 caret-claude-accent ${
                useAudioStore.getState().recordingStates[sessionId]?.isRecording ? 'border-l-2 border-red-500 pl-2' : ''
              } ${isSending ? 'opacity-60' : ''}`}
              rows={1}
            />
          )}
        </div>

        {/* Compact attachment buttons */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleAtButtonClick}
            disabled={disabled || isSending}
            className="p-1 transition-colors hover:bg-claude-bg disabled:opacity-40 disabled:cursor-not-allowed text-claude-text-secondary hover:text-claude-accent"
            style={{ borderRadius: 0 }}
            title="@ mention file"
          >
            <AtSign size={14} />
          </button>
          <button
            onClick={handleInspectElement}
            disabled={disabled}
            className={`p-1 transition-colors hover:bg-claude-bg disabled:opacity-40 disabled:cursor-not-allowed ${
              inspectorActive ? 'text-claude-accent' : 'text-claude-text-secondary'
            }`}
            style={{ borderRadius: 0 }}
            title={inspectorActive ? 'Cancel inspector (click again)' : 'Inspect element'}
          >
            <Target size={14} />
          </button>
          {isSending && (
            <button
              onClick={handleStopStreaming}
              className="p-1 transition-colors hover:bg-claude-bg text-red-400 hover:text-red-300 animate-pulse"
              style={{ borderRadius: 0 }}
              title="Stop (ESC ESC)"
            >
              <Square size={14} fill="currentColor" />
            </button>
          )}
          <MicrophoneButton
            ref={voiceModeRef}
            sessionId={sessionId}
            onInterimTranscript={(text) => {
              // Stream real-time transcript into the input box
              setMessage(text);
            }}
            onTranscriptionComplete={async (text) => {
              console.log('[InputArea] onTranscriptionComplete called with:', text, 'voiceModeActive:', isVoiceModeActive);

              // In voice mode (ElevenLabs), send directly without trigger word
              // This enables the hybrid flow where transcripts go straight to Grep
              if (isVoiceModeActive && !disabled && !isSending && text.trim()) {
                console.log('[InputArea] Voice mode active - sending directly to Grep');

                // Activate audio mode for auto-play TTS on response
                setAudioMode(sessionId, true);

                // Clear input and send
                setMessage('');

                // Build message with file context if there are attachments
                let messageToSend = text.trim();
                const fileMentions = attachments.filter((a) => a.type === 'mention');
                if (fileMentions.length > 0) {
                  const fileContext = fileMentions.map((m) => `@${m.name}`).join(', ');
                  messageToSend = `[Files: ${fileContext}]\n\n${messageToSend}`;
                }

                const otherAttachments = attachments.filter((a) => a.type !== 'mention');
                setAttachments([]);

                await sendMessage(sessionId, messageToSend, otherAttachments.length > 0 ? otherAttachments : undefined);
                return;
              }

              // Not in voice mode - use trigger word detection
              // Check if the transcription ends with the trigger word (configurable in settings)
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
        {/* Model selector - always visible */}
        <div className="relative" ref={modelDropdownRef}>
          <button
            onClick={() => setShowModelDropdown(!showModelDropdown)}
            disabled={disabled || isSending}
            className="text-claude-text-secondary hover:text-claude-text transition-colors disabled:opacity-40"
            title={`${currentModelInfo.description} (click to change)`}
          >
            {isStreamingProp && systemInfo ? (systemInfo.model || currentModelInfo.name) : currentModelInfo.name}
          </button>
          {showModelDropdown && (
            <div className="absolute bottom-full left-0 mb-1 bg-claude-surface border border-claude-border shadow-lg z-50 min-w-48">
              {availableModels.map((model) => (
                <button
                  key={model.id}
                  onClick={() => {
                    setSelectedModel(sessionId, model.id);
                    setShowModelDropdown(false);
                  }}
                  className={`w-full text-left px-3 py-2 hover:bg-claude-bg transition-colors ${
                    model.id === currentModel ? 'bg-claude-bg text-claude-accent' : 'text-claude-text'
                  }`}
                >
                  <div className="font-mono text-xs">{model.name}</div>
                  <div className="text-[10px] text-claude-text-secondary">{model.description}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        {isStreamingProp && systemInfo?.tools && systemInfo.tools.length > 0 && (
          <span className="text-claude-text-secondary">{systemInfo.tools.length} TOOLS</span>
        )}
        {!isStreamingProp && (
          <>
            <span>@ FILE</span>
            <span>ENTER SEND</span>
            <span>⌘↵ FORCE</span>
          </>
        )}
        {isStreamingProp && (
          <span className="text-amber-400">⌘↵ INTERRUPT</span>
        )}

        {/* Subagent status or Task progress */}
        {activeSubagent ? (
          <div className="flex items-center gap-1.5 text-purple-400">
            <div className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
            <span>
              {activeSubagent.type ? `[${activeSubagent.type}]` : 'AGENT'}
              {activeSubagent.description && ` ${activeSubagent.description.slice(0, 40)}${activeSubagent.description.length > 40 ? '...' : ''}`}
            </span>
          </div>
        ) : todoStats ? (
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
        ) : null}
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
    </>
  );
}
