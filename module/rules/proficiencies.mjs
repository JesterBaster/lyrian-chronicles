const CANONICAL = Object.freeze({
  "light armor": ["armor", "Light Armor"],
  "medium armor": ["armor", "Medium Armor"],
  "heavy armor": ["armor", "Heavy Armor"],
  "shield": ["armor", "Shields"],
  "shields": ["armor", "Shields"],
  "normal shield": ["armor", "Shields"],
  "normal shields": ["armor", "Shields"],
  "greatshield": ["armor", "Greatshields"],
  "greatshields": ["armor", "Greatshields"],
  "small weapon": ["weapons", "Small Weapons"],
  "small weapons": ["weapons", "Small Weapons"],
  "bludgeoning weapon": ["weapons", "Bludgeoning Weapons"],
  "bludgeoning weapons": ["weapons", "Bludgeoning Weapons"],
  "dueling weapon": ["weapons", "Dueling Weapons"],
  "dueling weapons": ["weapons", "Dueling Weapons"],
  "light sword": ["weapons", "Light Swords"],
  "light swords": ["weapons", "Light Swords"],
  "set of missile": ["weapons", "Set of Missiles"],
  "set of missiles": ["weapons", "Set of Missiles"],
  "pistol": ["weapons", "Pistol"],
  "pistols": ["weapons", "Pistol"],
  "musket": ["weapons", "Musket"],
  "saboteur thread dagger": ["weapons", "Saboteur Thread Daggers"],
  "saboteur thread daggers": ["weapons", "Saboteur Thread Daggers"],
  "channeling weapon": ["weapons", "Channeling Weapons"],
  "channeling weapons": ["weapons", "Channeling Weapons"],
  "artificer's multitool": ["weapons", "Artificer's Multitool"],
  "smith's hammer": ["weapons", "Smith's Hammer"],
  "artifice chainsaw": ["weapons", "Artifice Chainsaws"],
  "artifice chainsaws": ["weapons", "Artifice Chainsaws"],
  "unarmed": ["weapons", "Unarmed"]
});

const FIXED_TERMS = Object.freeze([
  "saboteur thread daggers", "artificer's multitool", "channeling weapons",
  "bludgeoning weapons", "dueling weapons", "small weapons", "light swords",
  "set of missiles", "artifice chainsaws", "smith's hammer", "greatshields",
  "normal shields", "light armor", "medium armor", "heavy armor", "shields",
  "pistols", "pistol", "musket"
]);

const LANGUAGES = Object.freeze(["Common", "Sorthen", "Sylvan", "Kiraran"]);

function plainText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Case-insensitive duplicate key shared by automatic and manual entries. */
export function proficiencyKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9']+/g, " ")
    .replace(/\s+/g, " ");
}

/** Normalize common official spelling/plural variants while preserving homebrew names. */
export function canonicalProficiency(value, requestedKind = "weapons") {
  const key = proficiencyKey(value);
  const known = CANONICAL[key];
  if (known) return { kind: known[0], name: known[1], key: proficiencyKey(known[1]) };
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  return { kind: requestedKind, name, key };
}

function emptyGrant() {
  return { weapons: [], armor: [], languages: [], choices: [] };
}

/** Parse permanent fixed grants and retain choice text for the player. */
export function parseProficiencyGrants(value) {
  const text = plainText(value);
  const grant = emptyGrant();
  if (!text) return grant;

  const add = (kind, name) => {
    const canonical = canonicalProficiency(name, kind);
    if (!grant[canonical.kind].some((entry) => proficiencyKey(entry) === canonical.key)) {
      grant[canonical.kind].push(canonical.name);
    }
  };

  if (/\b(?:speak|read|write)\b/i.test(text)) {
    for (const language of LANGUAGES) {
      if (new RegExp(`\\b${language}\\b`, "i").test(text)) add("languages", language);
    }
    if (/language of your choice|special dialect of your sub-?race/i.test(text)) {
      grant.choices.push("Choose one additional language or subrace dialect.");
    }
  }

  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    if (!/\bgain\b[^.!?]*\bproficien|\bwielding proficiency\b|weapon in which you are proficient/i.test(sentence)) continue;
    // "Considered proficient" is normally conditional on one attack or form,
    // not a permanent character proficiency.
    if (/considered proficient/i.test(sentence) && !/\bgain\b/i.test(sentence)) continue;

    const choiceMatch = sentence.match(/\b(?:one of|one common|a single common|single common|\d+ common|of your cho(?:ice|osing))\b/i);
    let fixedPart = choiceMatch ? sentence.slice(0, choiceMatch.index) : sentence;
    if (/\bproficien(?:cy|t)\b[^.!?]*\bor\b/i.test(fixedPart)) {
      grant.choices.push(sentence.trim());
      fixedPart = "";
    } else if (choiceMatch) {
      grant.choices.push(sentence.trim());
    }

    const lowered = fixedPart.toLowerCase();
    for (const term of FIXED_TERMS) {
      const pattern = new RegExp(`(?:^|[^a-z])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z])`, "i");
      if (pattern.test(lowered)) add(term.includes("armor") || term.includes("shield") ? "armor" : "weapons", term);
    }
    if (/smith['’]s hammer[^.!?]*\bproficient/i.test(sentence)) add("weapons", "Smith's Hammer");
  }

  return grant;
}

export function dedupeProficiencies(values, kind) {
  const seen = new Set();
  const result = [];
  for (const value of values ?? []) {
    const canonical = canonicalProficiency(value, kind);
    if (!canonical.name || seen.has(canonical.key)) continue;
    seen.add(canonical.key);
    result.push(canonical.name);
  }
  return result;
}

/** Build effective, deduplicated proficiencies with source attribution. */
export function collectActorProficiencies(actor) {
  const automatic = { weapons: new Map(), armor: new Map(), languages: new Map() };
  const sourceRows = [];
  const addSource = (name, text) => {
    const grant = parseProficiencyGrants(text);
    const entries = [];
    for (const kind of ["weapons", "armor", "languages"]) {
      for (const value of grant[kind]) {
        const canonical = canonicalProficiency(value, kind);
        const current = automatic[kind].get(canonical.key) ?? {
          name: canonical.name, kind, key: canonical.key, granted: true, sources: []
        };
        if (!current.sources.includes(name)) current.sources.push(name);
        automatic[kind].set(canonical.key, current);
        entries.push(canonical.name);
      }
    }
    if (entries.length || grant.choices.length) {
      sourceRows.push({ name, entries: [...new Set(entries)], choices: grant.choices });
    }
  };

  for (const item of actor.items ?? []) {
    if (item.type === "race") {
      addSource(item.name, item.system.grantedProficiencies);
      const variant = item.system.variants?.find((entry) => entry.key === item.system.selectedVariant);
      if (variant?.description) addSource(`${item.name} — ${variant.name}`, variant.description);
      continue;
    }
    if (item.type !== "ability") continue;
    const source = item.getFlag?.("lyrian-chronicles", "featureSource");
    if (!source || !["race", "class"].includes(source.kind)) continue;
    addSource(`${source.sourceName} — ${item.name}`, `${item.system.description ?? ""} ${item.system.benefits ?? ""}`);
  }

  const groups = {};
  for (const kind of ["weapons", "armor", "languages"]) {
    const rows = [...automatic[kind].values()];
    const effective = new Set(rows.map((entry) => entry.key));
    for (const value of dedupeProficiencies(actor.system.proficiencies?.[kind] ?? [], kind)) {
      const canonical = canonicalProficiency(value, kind);
      if (effective.has(canonical.key)) continue;
      effective.add(canonical.key);
      rows.push({ ...canonical, kind, granted: false, sources: [] });
    }
    groups[kind] = rows;
  }

  return { groups, sources: sourceRows };
}
