/**
 * Compose the title for a check whose name is just a thing being tested.
 *
 * A stat or defence button knows it is "Power" or "Guard", not that the result
 * is a check, so the word is added here rather than in a dozen labels. Rolls
 * that already read as a complete phrase — Crafting Check, Gathering Check,
 * Save — pass their own title through and must not come via this function, or
 * they end up saying "Check" twice.
 *
 * An expertise suffix stays on the outside: "Athletics Check (Climbing)" reads
 * correctly where "Athletics (Climbing) Check" does not.
 */
export function namedCheckTitle(label, suffix = "") {
  const name = String(label ?? "").trim();
  if (!name) return String(suffix ?? "").trim();
  const title = game.i18n.format("LYRIAN.Roll.NamedCheck", { name });
  return `${title}${suffix ?? ""}`;
}

/** Build the stable payload stored on check chat messages. */
export function buildCheckPayload({ actorUuid, title, roll, outcome }) {
  return {
    actorUuid: String(actorUuid ?? ""),
    title: String(title ?? ""),
    total: Number(roll?.total) || 0,
    formula: String(roll?.formula ?? ""),
    dc: outcome ? Number(outcome.dc) : null,
    success: outcome ? Boolean(outcome.success) : null
  };
}
