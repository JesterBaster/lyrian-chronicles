/**
 * Approved Divine data used by the character sheet.
 *
 * Source: The Lyrian Chronicles v0.13.1, Divine's Chosen breakthrough.
 * Re-verified against the current official breakthroughs page on 2026-08-15.
 */
export const WORSHIP_RULE_SOURCE = Object.freeze({
  rulebookVersion: "0.13.1",
  sourceUrl: "https://rpg.angelssword.com/game/0.13.1/breakthroughs",
  sourceHash: "3fef449288e5c9a1c587cd068733b07c34734ba7ad3523ee533e86cb1ded1320",
  verifiedAt: "2026-08-15"
});

export const DIVINES = Object.freeze({
  kari: { name: "Kari", damageType: "Holy" },
  heira: { name: "Heira", damageType: "Astra" },
  pandora: { name: "Pandora", damageType: "Arcane" },
  makai: { name: "Makai", damageType: "Water" },
  "ayuzi-kirara": { name: "Ayuzi Kirara", damageType: "Fire" },
  eisen: { name: "Eisen", damageType: "Slashing" },
  athena: { name: "Athena", damageType: "Lightning" },
  clio: { name: "Clio", damageType: "Arcane" },
  yggdrasil: { name: "Yggdrasil", damageType: "Earth" }
});

function key(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Return the canonical Divine profile for a player-entered worship value. */
export function divineProfile(value) {
  const normalized = key(value);
  const profile = DIVINES[normalized];
  return profile ? { key: normalized, ...profile } : null;
}

function itemStableId(item) {
  return item?.flags?.["lyrian-chronicles"]?.stableId
    ?? item?.getFlag?.("lyrian-chronicles", "stableId")
    ?? "";
}

function itemText(item) {
  return [item?.system?.description, item?.system?.benefits, item?.system?.requirements]
    .filter(Boolean)
    .join(" ");
}

/**
 * Explain which worship mechanics are active for an actor.
 * Worship by itself is biographical. Divine's Chosen activates the damage conversion.
 */
export function collectWorshipBenefits(actor) {
  const entered = String(actor?.system?.details?.worship ?? "").trim();
  const profile = divineProfile(entered);
  const items = Array.from(actor?.items ?? []);
  const chosen = items.find((item) =>
    itemStableId(item) === "breakthrough--divine-s-chosen"
    || (item?.type === "breakthrough" && key(item?.name) === "divines-chosen")
  );

  const relatedBenefits = items
    .filter((item) => item !== chosen && /chosen divine|your religion/i.test(itemText(item)))
    .map((item) => item.name)
    .filter((name, index, names) => name && names.indexOf(name) === index)
    .sort((a, b) => a.localeCompare(b));

  return {
    entered,
    profile,
    hasDivinesChosen: Boolean(chosen),
    active: Boolean(profile && chosen),
    damageType: profile?.damageType ?? "",
    relatedBenefits,
    source: WORSHIP_RULE_SOURCE
  };
}
