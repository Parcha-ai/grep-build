/**
 * Message Parser
 *
 * Parses assistant message text content to extract code blocks.
 * Tool calls are now handled separately via the structured ToolCall array
 * from the Agent SDK, not parsed from text.
 */

export type MessagePart =
  | { type: 'text'; content: string }
  | { type: 'code_block'; language: string; code: string };

// Pattern for fenced code blocks
const CODE_BLOCK_PATTERN = /```(\w*)\n?([\s\S]*?)```/g;

/**
 * Parse message content to extract code blocks and text segments.
 * Tool calls are NOT extracted here - they come from message.toolCalls.
 */
export function parseMessageContent(content: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let lastIndex = 0;

  // Reset regex state
  CODE_BLOCK_PATTERN.lastIndex = 0;

  let match;
  while ((match = CODE_BLOCK_PATTERN.exec(content)) !== null) {
    // Add text before this code block
    if (match.index > lastIndex) {
      const textContent = content.slice(lastIndex, match.index).trim();
      if (textContent) {
        parts.push({ type: 'text', content: textContent });
      }
    }

    // Add the code block
    const language = match[1] || '';
    const code = match[2] || '';

    parts.push({
      type: 'code_block',
      language,
      code: code.trim(),
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after the last code block
  if (lastIndex < content.length) {
    const textContent = content.slice(lastIndex).trim();
    if (textContent) {
      parts.push({ type: 'text', content: textContent });
    }
  }

  // If no code blocks were found, return the whole content as text
  if (parts.length === 0 && content.trim()) {
    parts.push({ type: 'text', content: content.trim() });
  }

  return parts;
}
