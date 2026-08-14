/** Parse the compact basic-attack text used by official monster entries. */
export function parseMonsterAttackProfile(profile) {
  const text = String(profile ?? "").trim();
  if (!text || /^none$/i.test(text)) return null;

  const accuracyMatch = text.match(/[+-]?\d+/);
  const damageMatch = text.match(/\d+d\d+(?:\s*[+-]\s*\d+)?/i);
  if (!accuracyMatch || !damageMatch) return null;

  return {
    accuracy: Number(accuracyMatch[0]),
    damageFormula: damageMatch[0].replace(/\s+/g, "")
  };
}
