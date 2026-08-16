export function resolvedAttackFlagUpdate({
  systemId,
  resolved = {},
  messageId,
  value,
  limit = 50
} = {}) {
  const entries = Object.entries(resolved)
    .filter(([id]) => id !== messageId)
    .sort(([, a], [, b]) => Number(a?.at ?? 0) - Number(b?.at ?? 0));
  const removeCount = Math.max(0, entries.length - Math.max(0, limit - 1));
  const update = {
    [`flags.${systemId}.resolvedAttacks.${messageId}`]: value
  };
  for (const [id] of entries.slice(0, removeCount)) {
    update[`flags.${systemId}.resolvedAttacks.-=${id}`] = null;
  }
  return update;
}
