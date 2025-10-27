export function parseMessage(raw: string): {
  cleanText: string;
  sessionCommand?: string;
  agent_idOverride?: string;
} {
  let text = (raw ?? '').trim();
  let sessionCommand: string | undefined;
  let agent_idOverride: string | undefined;

  // find tags like [s:new], [a:weather], or [s:new;a:weather]
  const matches = text.match(/\[([^\]]+)\]/g) || [];

  for (const m of matches) {
    const inside = m.slice(1, -1); // drop brackets
    const parts = inside.split(';').map(p => p.trim());
    for (const part of parts) {
      const [kRaw, vRaw] = part.split(':').map(s => s?.trim());

      // Convert key and value (if they exist) to lowercase for case-insensitivity
      const k = kRaw?.toLowerCase();
      const v = vRaw?.toLowerCase();

      if (!k) continue;

      // Check against lowercase values
      if (k === 's' && (v === 'new' || v === 'n')) {
        sessionCommand = 'new';
      }
      // Note: Agent ID value is only lowercased for the internal check 'v', 
      // but we should probably keep the original casing for the override value 
      // since 'agent_id' might be case-sensitive.
      if (k === 'a' && v) {
        // Use the original casing for the agent_idOverride value
        agent_idOverride = vRaw;
      }
    }
    text = text.replace(m, '').trim();
  }

  return { cleanText: text, sessionCommand, agent_idOverride };
}