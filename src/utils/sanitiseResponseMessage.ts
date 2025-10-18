/**
 * Remove unwanted fields (like `signature`) from LLM response messages.
 */
export function sanitizeResponseMessage(message: Record<string, any>): Record<string, any> {
  if (!message) return message;

  // Clean thinking_blocks if present
  const thinkingBlocks = Array.isArray(message.thinking_blocks)
    ? message.thinking_blocks.map((block: Record<string, any>) => {
        const { signature, ...rest } = block;
        return rest;
      })
    : [];

  return {
    ...message,
    thinking_blocks: thinkingBlocks,
  };
}
