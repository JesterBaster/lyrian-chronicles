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

/**
 * A statblock monster's accuracy, read from the attacks it prints.
 *
 * Its own Light and Heavy attacks parse their accuracy straight from the
 * profile, but anything else it attacks with — an ability given an attack —
 * rolls the actor's derived accuracy, which is Focus plus bonuses. For 80 of
 * the 83 monsters that print one, that is the same number. For Alpha Wolf,
 * Faewolf and Troll it is not (Troll prints +8 against a Focus of 4), and the
 * statblock is what the table is playing from.
 *
 * Precise doubles Focus, so it is the printed figure plus Focus once more.
 *
 * @returns {{standard: number, precise: number}|null}  null when none is printed.
 */
export function statblockAccuracy(official = {}, focus = 0) {
  const profile = parseMonsterAttackProfile(official?.lightAttack)
    ?? parseMonsterAttackProfile(official?.heavyAttack);
  if (!profile) return null;
  return { standard: profile.accuracy, precise: profile.accuracy + (Number(focus) || 0) };
}
