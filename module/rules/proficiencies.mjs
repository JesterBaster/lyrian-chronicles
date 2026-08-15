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
  "polearm": ["weapons", "Polearm"],
  "polearms": ["weapons", "Polearm"],
  "longsword": ["weapons", "Longsword"],
  "longswords": ["weapons", "Longsword"],
  "axe": ["weapons", "Axe"],
  "axes": ["weapons", "Axe"],
  "katana": ["weapons", "Katana"],
  "katanas": ["weapons", "Katana"],
  "heavy blade": ["weapons", "Heavy Blades"],
  "heavy blades": ["weapons", "Heavy Blades"],
  "twinblade": ["weapons", "Twinblade"],
  "twinblades": ["weapons", "Twinblade"],
  "thrown weapon": ["weapons", "Thrown Weapons"],
  "thrown weapons": ["weapons", "Thrown Weapons"],
  "set of missile": ["weapons", "Set of Missiles"],
  "set of missiles": ["weapons", "Set of Missiles"],
  "bow": ["weapons", "Bow"],
  "bows": ["weapons", "Bow"],
  "crossbow": ["weapons", "Crossbow"],
  "crossbows": ["weapons", "Crossbow"],
  "sling": ["weapons", "Sling"],
  "slings": ["weapons", "Sling"],
  "pistol": ["weapons", "Pistol"],
  "pistols": ["weapons", "Pistol"],
  "musket": ["weapons", "Musket"],
  "shotgun": ["weapons", "Shotgun"],
  "shotguns": ["weapons", "Shotgun"],
  "sniper rifle": ["weapons", "Sniper Rifle"],
  "sniper rifles": ["weapons", "Sniper Rifle"],
  "saboteur thread dagger": ["weapons", "Saboteur Thread Daggers"],
  "saboteur thread daggers": ["weapons", "Saboteur Thread Daggers"],
  "lance": ["weapons", "Lance"],
  "lances": ["weapons", "Lance"],
  "whip": ["weapons", "Whip"],
  "whips": ["weapons", "Whip"],
  "gauntlet": ["weapons", "Gauntlets"],
  "gauntlets": ["weapons", "Gauntlets"],
  "channeling weapon": ["weapons", "Channeling Weapons"],
  "channeling weapons": ["weapons", "Channeling Weapons"],
  "wand": ["weapons", "Channeling Weapons"],
  "wands": ["weapons", "Channeling Weapons"],
  "magic staff": ["weapons", "Channeling Weapons"],
  "magic staffs": ["weapons", "Channeling Weapons"],
  "scythe": ["weapons", "Scythe"],
  "scythes": ["weapons", "Scythe"],
  "giant scissors": ["weapons", "Giant Scissors"],
  "pickaxe": ["weapons", "Pickaxe"],
  "pickaxes": ["weapons", "Pickaxe"],
  "hori": ["weapons", "Hori"],
  "sickle": ["weapons", "Sickle"],
  "sickles": ["weapons", "Sickle"],
  "artificer's multitool": ["weapons", "Artificer's Multitool"],
  "smith's hammer": ["weapons", "Smith's Hammer"],
  "artifice chainsaw": ["weapons", "Artifice Chainsaws"],
  "artifice chainsaws": ["weapons", "Artifice Chainsaws"],
  "unarmed": ["weapons", "Unarmed"]
});

const FIXED_TERMS = Object.freeze(Object.keys(CANONICAL).sort((a, b) => b.length - a.length));

const LANGUAGES = Object.freeze(["Common", "Sorthen", "Sylvan", "Kiraran"]);

export const COMMON_WEAPON_PROFICIENCIES = Object.freeze([
  "Small Weapons", "Polearm", "Light Swords", "Longsword", "Dueling Weapons",
  "Axe", "Bludgeoning Weapons", "Katana", "Heavy Blades", "Twinblade",
  "Thrown Weapons", "Set of Missiles", "Bow", "Crossbow", "Musket", "Sling"
]);

export const SPECIALIZED_WEAPON_PROFICIENCIES = Object.freeze([
  "Pistol", "Shotgun", "Sniper Rifle", "Saboteur Thread Daggers", "Lance", "Whip", "Gauntlets"
]);

export const OTHER_WEAPON_PROFICIENCIES = Object.freeze([
  "Channeling Weapons", "Scythe", "Giant Scissors", "Pickaxe", "Hori", "Sickle", "Smith's Hammer"
]);

export const ARMOR_PROFICIENCIES = Object.freeze([
  "Light Armor", "Medium Armor", "Heavy Armor", "Shields", "Greatshields"
]);

const CHOICE_TITLES = Object.freeze({
  "language-choice": "Additional language or dialect",
  "common-weapons": "Common weapon group",
  "specialized-weapons": "Specialized weapon group",
  "common-or-specialized-weapons": "Common or specialized weapon group",
  "listed-weapons": "Weapon group",
  "listed-options": "Weapon proficiency",
  "heavy-armor-or-greatshield": "Heavy Armor or Greatshield",
  "armor-choice": "Armor or shield proficiency",
  "armor-or-shield": "Armor or shield proficiency",
  "weapon-choice": "Weapon proficiency"
});

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

function countFrom(value) {
  const number = Number.parseInt(value, 10);
  if (Number.isFinite(number)) return number;
  return /^(?:one|a|single)$/i.test(String(value ?? "")) ? 1 : 1;
}

function choice(key, kind, label, options, count = 1, allowCustom = false) {
  return { key, kind, label: label.trim(), options: [...new Set(options)], count, allowCustom };
}

function choiceTitle(rule) {
  const baseKey = String(rule.key ?? "").replace(/-\d+$/, "");
  return CHOICE_TITLES[baseKey] ?? `${rule.kind === "armor" ? "Armor" : rule.kind === "languages" ? "Language" : "Weapon"} proficiency`;
}

function explicitWeaponList(value) {
  return String(value ?? "")
    .split(/,|\band\b|\bor\b/i)
    .map((entry) => entry.replace(/[.;:]+$/g, "").trim())
    .filter(Boolean)
    .map((entry) => canonicalProficiency(entry, "weapons").name)
    .filter((entry) => entry && entry.toLowerCase() !== "weapons");
}

/** Convert official choice wording into enforceable, source-owned selection rules. */
function parseProficiencyChoices(text) {
  const choices = [];
  const add = (entry) => {
    let key = entry.key;
    let suffix = 2;
    while (choices.some((existing) => existing.key === key)) key = `${entry.key}-${suffix++}`;
    choices.push({ ...entry, key });
  };

  if (/language of your choice|special dialect of your sub-?race/i.test(text)) {
    add(choice(
      "language-choice", "languages", "Choose one additional language or subrace dialect.",
      LANGUAGES, 1, true
    ));
  }

  const sentences = text.split(/(?<=[.!?])\s+/);
  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index].trim();
    if (!/proficien/i.test(sentence)) continue;
    const alternative = /^Alternatively\b/i.test(sentences[index + 1] ?? "") ? ` ${sentences[index + 1]}` : "";
    const wording = `${sentence}${alternative}`.trim();

    let match = sentence.match(/\b(\d+|one|a|single)\s+common(?:\s+weapon)?(?:\s+groups?)?\s+and\s+(\d+|one|a|single)\s+specialized/i);
    if (match) {
      add(choice("common-weapons", "weapons", sentence, COMMON_WEAPON_PROFICIENCIES, countFrom(match[1])));
      add(choice("specialized-weapons", "weapons", sentence, SPECIALIZED_WEAPON_PROFICIENCIES, countFrom(match[2])));
      continue;
    }

    match = sentence.match(/\b(\d+|one|a|single)\s+(?:common|basic)(?:\s+weapon)?(?:\s+groups?|\s+proficiency)?\s+or\s+(?:one\s+)?(?:common\s+or\s+)?specialized/i)
      ?? sentence.match(/\b(\d+|one|a|single)\s+common\s+or\s+specialized/i);
    if (match) {
      add(choice(
        "common-or-specialized-weapons", "weapons", sentence,
        [...COMMON_WEAPON_PROFICIENCIES, ...SPECIALIZED_WEAPON_PROFICIENCIES], countFrom(match[1])
      ));
      continue;
    }

    match = sentence.match(/\b(\d+|one|a|single)\s+(?:other\s+)?common(?:\s+weapon)?(?:\s+groups?)?/i);
    if (match) {
      const options = /channeling weapons/i.test(text)
        ? [...COMMON_WEAPON_PROFICIENCIES, "Channeling Weapons"]
        : COMMON_WEAPON_PROFICIENCIES;
      add(choice("common-weapons", "weapons", sentence, options, countFrom(match[1])));
      continue;
    }

    match = sentence.match(/one of the following weapon groups:\s*(.+)$/i);
    if (match) {
      add(choice("listed-weapons", "weapons", sentence, explicitWeaponList(match[1])));
      continue;
    }

    match = sentence.match(/either\s+(.+?)\s+or\s+(.+?)(?:\.|$)/i)
      ?? sentence.match(/choice between\s+(.+?)\s+or\s+(.+?)(?:\.|$)/i);
    if (match) {
      add(choice("listed-options", "weapons", sentence, explicitWeaponList(`${match[1]} or ${match[2]}`)));
      continue;
    }

    if (/wielding proficiency in Heavy Armor or Greatshields/i.test(sentence)) {
      add(choice("heavy-armor-or-greatshield", "armor", sentence, ["Heavy Armor", "Greatshields"]));
      continue;
    }

    if (/\b(?:\d+|one|a|single)\s+armor category of your cho(?:ice|osing)/i.test(sentence)) {
      const options = /shield or greatshield/i.test(wording)
        ? ARMOR_PROFICIENCIES
        : ARMOR_PROFICIENCIES.slice(0, 3);
      add(choice("armor-choice", "armor", wording, options));
      continue;
    }

    if (/\b(?:\d+|one|a|single)\s+armor\s+or\s+(?:in\s+)?the shield/i.test(sentence)) {
      add(choice("armor-or-shield", "armor", sentence, ["Light Armor", "Medium Armor", "Heavy Armor", "Shields"]));
      continue;
    }

    if (/another weapon of your choice|weapon proficiency of your choice|smithing melee weapon of your choice|carpentry weapon of your choice/i.test(sentence)) {
      add(choice(
        "weapon-choice", "weapons", sentence,
        [...COMMON_WEAPON_PROFICIENCIES, ...SPECIALIZED_WEAPON_PROFICIENCIES, ...OTHER_WEAPON_PROFICIENCIES]
      ));
    }
  }
  return choices;
}

/** Parse permanent fixed grants and retain choice text for the player. */
export function parseProficiencyGrants(value) {
  const text = plainText(value);
  const grant = emptyGrant();
  if (!text) return grant;
  grant.choices.push(...parseProficiencyChoices(text));

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
  }

  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    if (!/\bgain\b[^.!?]*\bproficien|\bwielding proficiency\b|weapon in which you are proficient/i.test(sentence)) continue;
    // "Considered proficient" is normally conditional on one attack or form,
    // not a permanent character proficiency.
    if (/considered proficient/i.test(sentence) && !/\bgain\b/i.test(sentence)) continue;

    const choiceMatch = sentence.match(/\b(?:one of|one common|a single common|single common|\d+ common|\d+ armor|of your cho(?:ice|osing)|either|choice between|one basic|one smithing|one carpentry)\b/i);
    let fixedPart = choiceMatch ? sentence.slice(0, choiceMatch.index) : sentence;
    if (/\bproficien(?:cy|t)\b[^.!?]*\bor\b/i.test(fixedPart)) {
      fixedPart = "";
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
  const selections = actor.system.proficiencyChoiceSelections ?? {};
  const addSource = (name, text, stableSource) => {
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
    const sourceChoices = grant.choices.map((rule, index) => {
      const id = `${proficiencyKey(stableSource).replace(/[^a-z0-9]+/g, "-")}--${rule.key ?? `choice-${index + 1}`}`;
      const selected = Array.isArray(selections[id]) ? selections[id].slice(0, rule.count) : [];
      for (const value of selected) {
        if (!value) continue;
        const canonical = canonicalProficiency(value, rule.kind);
        const allowed = rule.allowCustom || rule.options.some((option) => proficiencyKey(option) === canonical.key);
        if (!allowed) continue;
        const current = automatic[canonical.kind].get(canonical.key) ?? {
          name: canonical.name, kind: canonical.kind, key: canonical.key, granted: true, sources: []
        };
        if (!current.sources.includes(name)) current.sources.push(name);
        automatic[canonical.kind].set(canonical.key, current);
      }
      const slots = Array.from({ length: rule.count }, (_, slotIndex) => ({
        index: slotIndex,
        value: selected[slotIndex] ?? "",
        options: rule.options.map((option) => ({
          value: option,
          label: option,
          selected: proficiencyKey(option) === proficiencyKey(selected[slotIndex])
        }))
      }));
      return {
        ...rule,
        id,
        slots,
        title: choiceTitle(rule),
        complete: slots.every((slot) => Boolean(slot.value))
      };
    });
    if (entries.length || sourceChoices.length) {
      sourceRows.push({ name, entries: [...new Set(entries)], choices: sourceChoices });
    }
  };

  for (const item of actor.items ?? []) {
    if (item.type === "race") {
      addSource(item.name, item.system.grantedProficiencies, item.system.stableId || item.id || item.name);
      const variant = item.system.variants?.find((entry) => entry.key === item.system.selectedVariant);
      if (variant?.description) addSource(
        `${item.name} — ${variant.name}`,
        variant.description,
        `${item.system.stableId || item.id || item.name}--${variant.key}`
      );
      continue;
    }
    if (item.type !== "ability") continue;
    const source = item.getFlag?.("lyrian-chronicles", "featureSource");
    if (!source || !["race", "class"].includes(source.kind)) continue;
    const description = item.system.description ?? "";
    const benefits = item.system.benefits ?? "";
    const text = plainText(description) === plainText(benefits) ? description : `${description} ${benefits}`;
    addSource(
      `${source.sourceName} — ${item.name}`,
      text,
      item.system.stableId || source.stableId || item.id || item.name
    );
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
