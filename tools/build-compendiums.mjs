import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  raceAmbitionExp,
  raceAttributeBonuses,
  raceSkillGrant
} from "../module/rules/progression.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = process.argv[2] || path.join(ROOT, "content-source", "approved", "0.13.1");
const OUTPUT = process.argv[3] || path.join(ROOT, "content");
const SYSTEM_ID = "lyrian-chronicles";
const CONTENT_BUILD = "0.5.0";
const RACE_CONTENT_BUILD = "0.5.1";
let ENTRY_BY_STABLE_ID = new Map();
let STABLE_ID_BY_SOURCE_ID = new Map();

const PACKS = {
  "rules-setting-guide": { prefix: "rules-setting-guide", type: "JournalEntry" },
  keywords: { prefix: "keywords", type: "Item" },
  breakthroughs: { prefix: "breakthroughs", type: "Item" },
  "player-abilities": { prefix: "player-abilities", type: "Item" },
  races: { prefix: "races", type: "Item" },
  classes: { prefix: "classes", type: "Item" },
  weapons: { prefix: "weapons", type: "Item" },
  "armor-shields": { prefix: "armor-shields", type: "Item" },
  consumables: { prefix: "consumables", type: "Item" },
  "gear-kits": { prefix: "gear-kits", type: "Item" },
  artifices: { prefix: "artifices", type: "Item" },
  monsters: { prefix: "monsters", type: "Actor" },
  "monster-abilities": { prefix: "monster-abilities", type: "Item" },
};

const EXPECTED = {
  "rules-setting-guide": 2,
  keywords: 87,
  breakthroughs: 89,
  "player-abilities": 1112,
  races: 48,
  classes: 181,
  weapons: 45,
  "armor-shields": 9,
  consumables: 58,
  "gear-kits": 31,
  artifices: 47,
  monsters: 84,
  "monster-abilities": 307,
};

function idFor(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

async function loadSnapshot(source) {
  if ((await stat(source)).isFile()) return JSON.parse(await readFile(source, "utf8"));
  const manifest = JSON.parse(await readFile(path.join(source, "manifest.json"), "utf8"));
  const entries = [];
  for (const part of manifest.parts) {
    entries.push(...JSON.parse(await readFile(path.join(source, part.file), "utf8")));
  }
  const { parts, entry_count, ...metadata } = manifest;
  if (entries.length !== entry_count) {
    throw new Error(`Snapshot index expected ${entry_count} entries, found ${entries.length}`);
  }
  return { ...metadata, entries };
}

function chunkDocuments(documents, maximumBytes = 500_000) {
  const chunks = [];
  let chunk = [];
  for (const document of documents) {
    const candidate = [...chunk, document];
    if (chunk.length && Buffer.byteLength(JSON.stringify(candidate)) > maximumBytes) {
      chunks.push(chunk);
      chunk = [document];
    } else {
      chunk = candidate;
    }
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function rich(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return /<\/?[a-z][\s\S]*>/i.test(text) ? text : `<p>${escapeHtml(text)}</p>`;
}

function number(value, fallback = 0) {
  const match = String(value ?? "").match(/-?\d+/);
  return match ? Number.parseInt(match[0], 10) : fallback;
}

function terms(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const AUTOMATED_KEYWORDS = new Map([
  ["rapid", "rapid"],
  ["lockon", "lockOn"],
  ["surehit", "sureHit"],
  ["fullpierce", "fullPierce"],
  ["halfpierce", "halfPierce"],
  ["pinpoint", "pinpoint"],
  ["trickattack", "trickAttack"],
  ["stealth", "stealth"],
  ["upkeep", "upkeep"],
  ["secretart", "secretArt"],
  ["downed", "downed"],
]);

function keywords(value) {
  return terms(value).map((term) => {
    const normalized = term.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return AUTOMATED_KEYWORDS.get(normalized) ?? term;
  });
}

function timingFor(data, kind = "ability") {
  const lowered = terms(data.keywords).map((item) => item.toLowerCase());
  if (kind === "passive" || lowered.includes("passive")) return "passive";
  if (lowered.some((item) => item.includes("encounter start"))) return "encounterStart";
  if (lowered.some((item) => item.includes("encounter conclusion"))) return "encounterConclusion";
  if (number(data.rpCost) > 0 && number(data.apCost) === 0) return "reaction";
  return "action";
}

function provenance(entry, description = "") {
  const relationshipLinks = relationshipMetadata(entry.relationships);
  return {
    description,
    source: "The Lyrian Chronicles v0.13.1",
    sourceUrl: entry.source_url,
    sourceHash: entry.source_hash,
    rulebookVersion: entry.rulebook_version,
    stableId: entry.stable_id,
    relationships: { ...(entry.relationships ?? {}), _links: relationshipLinks },
  };
}

function itemPack(entry) {
  const category = String(entry?.data?.type ?? "");
  const subType = String(entry?.data?.subType ?? "");
  const name = String(entry?.name ?? "");
  if (category === "Artifice") return "artifices";
  if (category === "Alchemy") return "consumables";
  if (/armor/i.test(subType) || /^(Armor|Shield)/i.test(name)) return "armor-shields";
  if (/weapon/i.test(subType) || ["Divine Arms", "Astra Relic"].includes(category)) return "weapons";
  if (category !== "Crafting" && !/Materials|Mods/i.test(subType)) return "gear-kits";
  return null;
}

function packForStableId(stableId) {
  if (/^(ability|key-ability)--/.test(stableId)) return ["player-abilities", "player-abilities"];
  if (stableId.startsWith("class--")) return ["classes", "classes"];
  if (stableId.startsWith("breakthrough--")) return ["breakthroughs", "breakthroughs"];
  if (/^(primary-race|ancestry)--/.test(stableId)) return ["races", "races"];
  if (/^(monster-ability|monster-action)--/.test(stableId)) return ["monster-abilities", "monster-abilities"];
  if (stableId.startsWith("item--")) {
    const pack = itemPack(ENTRY_BY_STABLE_ID.get(stableId));
    return pack ? [pack, "items"] : null;
  }
  return null;
}

function relationshipMetadata(relationships) {
  const stableIds = new Set();
  const visit = (value) => {
    if (typeof value === "string" && packForStableId(value)) stableIds.add(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(relationships);
  return Array.from(stableIds, (stableId) => {
    const [pack, category] = packForStableId(stableId);
    const target = ENTRY_BY_STABLE_ID.get(stableId);
    const documentId = idFor(`${category}:${stableId}`);
    return {
      stableId,
      name: target?.name ?? stableId,
      pack,
      documentId,
      uuid: `Compendium.${SYSTEM_ID}.${pack}.Item.${documentId}`,
    };
  });
}

function flags(entry, remoteImage = "") {
  return {
    [SYSTEM_ID]: {
      seedKey: `official:${entry.stable_id}`,
      stableId: entry.stable_id,
      sourceUrl: entry.source_url,
      sourceHash: entry.source_hash,
      rulebookVersion: entry.rulebook_version,
      contentBuild: entry.category === "races" ? RACE_CONTENT_BUILD : CONTENT_BUILD,
      ...(remoteImage ? { remoteImage } : {}),
    },
  };
}

function baseDocument(entry, type, img, system, remoteImage = "") {
  return {
    _id: idFor(`${entry.category}:${entry.stable_id}`),
    name: entry.name,
    type,
    img,
    system,
    flags: flags(entry, remoteImage),
  };
}

/**
 * Choose the artwork a document ships with.
 *
 * The official art is hosted on a CDN that sends no Access-Control-Allow-Origin
 * header. A plain <img> does not need one, so sheet portraits looked fine — but
 * canvas textures do, so every monster token using that art failed to draw with
 * a CORS error and the token rendered as nothing at all.
 *
 * So the bundled icon wins, and the remote URL is kept in a flag rather than
 * thrown away: nothing is lost, a GM can still paste it onto a token by hand,
 * and if the CDN ever sends the header this becomes a one-line change back.
 */
function artwork(data, fallback) {
  const remote = data?.imageSmUrl || data?.imageLgUrl || "";
  return { img: fallback, remoteImage: String(remote) };
}

const fallbackIcons = {
  keyword: "icons/svg/aura.svg",
  breakthrough: "icons/svg/upgrade.svg",
  ability: "icons/svg/lightning.svg",
  race: "icons/svg/mystery-man.svg",
  class: "icons/svg/book.svg",
  equipment: "icons/svg/item-bag.svg",
  monsterAbility: "icons/svg/explosion.svg",
  monster: "icons/svg/mystery-man.svg",
};

function buildJournal(entry) {
  const content = `${entry.data.content ?? ""}<hr><p><small>Official game content © Angel's Sword Studios, used with permission. <a href="${escapeHtml(entry.source_url)}">Official source</a> · Rulebook v${escapeHtml(entry.rulebook_version)}</small></p>`;
  return {
    _id: idFor(`${entry.category}:${entry.stable_id}`),
    name: entry.name,
    pages: [{
      _id: idFor(`${entry.category}:${entry.stable_id}:page`),
      name: entry.name,
      type: "text",
      title: { show: true, level: 1 },
      text: { format: 1, content },
      flags: flags(entry),
    }],
    ownership: { default: 0 },
    flags: flags(entry),
  };
}

function buildKeyword(entry) {
  return baseDocument(entry, "keyword", fallbackIcons.keyword, {
    ...provenance(entry, entry.data.description),
    keyword: entry.name,
  });
}

function buildBreakthrough(entry) {
  return baseDocument(entry, "breakthrough", fallbackIcons.breakthrough, {
    ...provenance(entry, entry.data.description),
    expCost: number(entry.data.cost, 0),
    rawCost: String(entry.data.cost ?? ""),
    level: 1,
    requirements: String(entry.data.requirements ?? ""),
    repeatable: /repeat/i.test(`${entry.data.description ?? ""} ${entry.data.requirements ?? ""}`),
  });
}

function keyAbilityDescription(data) {
  const sections = [1, 2, 3, 4]
    .map((index) => data[`benefit${index}`])
    .filter(Boolean)
    .map((benefit, index) => `<section><h3>Benefit ${index + 1}</h3>${rich(benefit)}</section>`);
  return sections.join("");
}

function buildAbility(entry) {
  const data = entry.data;
  const isKeyAbility = entry.stable_id.startsWith("key-ability--");
  const description = isKeyAbility ? keyAbilityDescription(data) : data.description;
  return baseDocument(entry, "ability", fallbackIcons.ability, {
    ...provenance(entry, description),
    apCost: number(data.apCost),
    rpCost: number(data.rpCost),
    manaCost: number(data.manaCost),
    upkeep: 0,
    timing: timingFor(data),
    keywords: keywords(data.keywords),
    rawKeywords: String(data.keywords ?? ""),
    rawCost: [
      data.apCost ? `${data.apCost} AP` : "",
      data.rpCost ? `${data.rpCost} RP` : "",
      data.manaCost ? `${data.manaCost} Mana` : "",
    ].filter(Boolean).join(", "),
    otherCosts: String(data.otherCosts ?? ""),
    benefits: isKeyAbility ? description : "",
    isKeyAbility,
    patchVersion: entry.rulebook_version,
    range: String(data.range ?? ""),
    requirement: String(data.requirement ?? ""),
    hasAttack: false,
    attackType: "light",
    damageFormula: "",
    damageType: "physical",
    usesWeapon: false,
    classSource: (entry.relationships.classes ?? []).map((item) => item.class).join(", "),
    classStep: 0,
    usedThisRound: false,
  });
}

function buildRace(entry) {
  const data = entry.data;
  const isPrimary = entry.stable_id.startsWith("primary-race--");
  const variants = ["wi", "lir", "d", "ar", "lu", "ni", "un", "vi", "none"]
    .map((key) => {
      const choice = data[key] ?? {};
      const abilityStableId = STABLE_ID_BY_SOURCE_ID.get(choice.ability) ?? "";
      return {
        key,
        name: key === "none" ? "No House" : `House ${key.toUpperCase()}`,
        description: String(choice.text ?? ""),
        abilityStableId
      };
    })
    .filter((choice) => choice.description || choice.abilityStableId);
  const relationships = {
    ...(entry.relationships ?? {}),
    variant_traits: variants.map((choice) => choice.abilityStableId).filter(Boolean)
  };
  const art = artwork(data, fallbackIcons.race);
  return baseDocument(entry, "race", art.img, {
    ...provenance({ ...entry, relationships }, data.description),
    raceKind: isPrimary ? "primary" : "ancestry",
    primaryRace: isPrimary ? entry.name : String(data.primaryRace ?? ""),
    subrace: isPrimary ? "" : entry.name,
    clan: "",
    attributes: String(data.attributes ?? ""),
    ambition: String(data.ambition ?? ""),
    ambitionExp: raceAmbitionExp(data.ambition),
    attributeBonuses: raceAttributeBonuses(data.attributes),
    selectedMainStat: "",
    selectedSubStat: "",
    selectedVariant: "",
    variants,
    grantedProficiencies: String(data.proficiencies ?? ""),
    grantedSkills: String(data.skills ?? ""),
    skillGrant: raceSkillGrant(data.skills),
    selectedSkillBonuses: {},
    size: "medium",
    speed: 20,
  }, art.remoteImage);
}

function buildClass(entry) {
  const data = entry.data;
  const relations = entry.relationships;
  const art = artwork(data, fallbackIcons.class);
  return baseDocument(entry, "class", art.img, {
    ...provenance(entry, data.description),
    tier: number(data.tier, 1),
    difficulty: number(data.difficulty, 0),
    role1: String(data.role1 ?? ""),
    role2: String(data.role2 ?? ""),
    guide: data.guide ?? "",
    skills: String(data.skills ?? ""),
    heart: String(data.heart ?? ""),
    soul: String(data.soul ?? ""),
    abilitiesUnlocked: 1,
    keyAbilities: String(relations.key_ability ?? ""),
    requirements: String(data.requirements ?? ""),
    artisan: /artisan/i.test(`${data.role1 ?? ""} ${data.role2 ?? ""}`),
    gathering: /gather/i.test(`${data.role1 ?? ""} ${data.role2 ?? ""}`),
  }, art.remoteImage);
}

function buildEquipment(entry) {
  const data = entry.data;
  const art = artwork(data, fallbackIcons.equipment);
  return baseDocument(entry, "equipment", art.img, {
    ...provenance(entry, data.description),
    category: String(data.type ?? ""),
    subType: String(data.subType ?? ""),
    cost: String(data.cost ?? ""),
    burden: String(data.burden ?? ""),
    activationCost: String(data.activationCost ?? ""),
    shellSize: String(data.shellSize ?? ""),
    fuelUsage: String(data.fuelUsage ?? ""),
    craftingPoints: number(data.craftingPoints),
    craftingType: String(data.craftingType ?? ""),
    quantity: 1,
    equipped: false,
  }, art.remoteImage);
}

function buildMonsterAbility(entry) {
  const data = entry.data;
  const kind = entry.relationships.kind ?? "passive";
  const description = data.description ?? data.descriptions ?? "";
  return baseDocument(entry, "monsterAbility", fallbackIcons.monsterAbility, {
    ...provenance(entry, description),
    kind,
    apCost: number(data.apCost),
    rpCost: number(data.rpCost),
    manaCost: number(data.manaCost),
    timing: timingFor(data, kind),
    keywords: keywords(data.keywords),
    rawKeywords: String(data.keywords ?? ""),
    range: String(data.range ?? ""),
    requirement: String(data.requirements ?? ""),
    usedThisRound: false,
  });
}

function parsePair(value) {
  const values = String(value ?? "").match(/-?\d+/g)?.map(Number) ?? [];
  return [values[0] ?? 0, values[1] ?? values[0] ?? 0];
}

function monsterRank(value) {
  const lower = String(value ?? "").toLowerCase();
  if (lower.includes("boss")) return "boss";
  if (lower.includes("heroic")) return "heroic";
  return "grunt";
}

function embeddedAbility(monsterId, document) {
  return {
    ...structuredClone(document),
    _id: idFor(`${monsterId}:${document.system.stableId}`),
    flags: {
      ...document.flags,
      [SYSTEM_ID]: {
        ...document.flags[SYSTEM_ID],
        compendiumSource: `Compendium.${SYSTEM_ID}.monster-abilities.Item.${document._id}`,
      },
    },
  };
}

function buildMonster(entry, monsterAbilityByStableId) {
  const data = entry.data;
  const [evasion, dodgeEvasion] = parsePair(data.evasion);
  const [guard, blockGuard] = parsePair(data.guard);
  const hp = number(data.hp, 1);
  const mana = number(data.mana, 0);
  const ap = number(data.ap, 0);
  const rp = number(data.rp, 0);
  const related = [
    ...(entry.relationships.passive_abilities ?? []),
    ...(entry.relationships.active_actions ?? []),
  ];
  const embedded = related
    .map((stableId) => monsterAbilityByStableId.get(stableId))
    .filter(Boolean)
    .map((document) => embeddedAbility(entry.stable_id, document));
  const art = artwork(data, fallbackIcons.monster);

  return {
    ...baseDocument(entry, "monster", art.img, {
      hp: { value: hp, max: hp, temp: 0, maxBonus: 0 },
      mana: { value: mana, max: mana, temp: 0, maxBonus: 0 },
      ap: { value: ap, max: ap, temp: 0, bonus: 0 },
      rp: { value: rp, max: rp, temp: 0, bonus: 0 },
      stats: {
        power: { value: number(data.power), bonus: 0 },
        focus: { value: number(data.focus), bonus: 0 },
        agility: { value: number(data.agility), bonus: 0 },
        toughness: { value: number(data.toughness), bonus: 0 },
      },
      subStats: {
        fitness: { value: number(data.fitness), bonus: 0 },
        cunning: { value: number(data.cunning), bonus: 0 },
        reason: { value: number(data.reason), bonus: 0 },
        awareness: { value: number(data.awareness), bonus: 0 },
        presence: { value: number(data.presence), bonus: 0 },
      },
      defences: {
        guardBonus: 0, evasionBonus: 0, blockBonus: 0,
        potencyBonus: 0, saveBonus: 0, accuracyBonus: 0,
      },
      movement: { speed: number(data.movementSpeed, 20), bonus: 0, fly: 0, swim: 0 },
      initiative: { bonus: 0 },
      size: "medium",
      biography: data.lore ?? "",
      rank: monsterRank(data.type),
      details: {
        creatureType: String(data.type ?? ""),
        powerLevel: 0,
        expReward: 0,
        astraCorruption: 0,
        dangerLevel: String(data.dangerLevel ?? ""),
        recommended: String(data.recommended ?? ""),
        appearance: String(data.appearance ?? ""),
        habitat: String(data.habitat ?? ""),
        strongAgainst: String(data.strongAgainst ?? ""),
        weakAgainst: String(data.weakAgainst ?? ""),
      },
      gatherables: "",
      tactics: data.strategy ?? "",
      runningMonster: data.runningMonster ?? "",
      official: {
        enabled: true,
        hp, mana, ap, rp,
        initiative: number(data.initiative),
        evasion, dodgeEvasion, guard, blockGuard,
        movement: number(data.movementSpeed, 20),
        lightAttack: String(data.lightAttack ?? ""),
        heavyAttack: String(data.heavyAttack ?? ""),
        notableSkills: String(data.notableSkills ?? ""),
      },
      source: {
        stableId: entry.stable_id,
        url: entry.source_url,
        hash: entry.source_hash,
        rulebookVersion: entry.rulebook_version,
        relationships: entry.relationships,
      },
    }, art.remoteImage),
    items: embedded,
    prototypeToken: {
      name: entry.name,
      displayName: 20,
      disposition: -1,
      texture: { src: art.img },
      actorLink: false,
    },
  };
}

function validateSnapshot(snapshot) {
  if (snapshot.rulebook_version !== "0.13.1") throw new Error("Expected rulebook v0.13.1");
  if (snapshot.unresolved_relationships?.length) {
    throw new Error(`Snapshot has ${snapshot.unresolved_relationships.length} unresolved relationships`);
  }
  const seen = new Set();
  for (const entry of snapshot.entries) {
    const key = `${entry.category}:${entry.stable_id}`;
    if (seen.has(key)) throw new Error(`Duplicate entry ${key}`);
    seen.add(key);
    if (!PACKS[entry.category] && entry.category !== "items") throw new Error(`Unknown category ${entry.category}`);
    if (!entry.source_url || !entry.source_hash) throw new Error(`Missing provenance for ${key}`);
  }
}

const snapshot = await loadSnapshot(SOURCE);
validateSnapshot(snapshot);
ENTRY_BY_STABLE_ID = new Map(snapshot.entries.map((entry) => [entry.stable_id, entry]));
STABLE_ID_BY_SOURCE_ID = new Map(snapshot.entries.flatMap((entry) =>
  Object.values(entry.source_ids ?? {}).filter(Boolean).map((sourceId) => [sourceId, entry.stable_id])
));
const grouped = Object.fromEntries(Object.keys(PACKS).map((key) => [key, []]));

const monsterAbilityEntries = snapshot.entries.filter((entry) => entry.category === "monster-abilities");
const monsterAbilityDocuments = monsterAbilityEntries.map(buildMonsterAbility);
const monsterAbilityByStableId = new Map(monsterAbilityDocuments.map((item) => [item.system.stableId, item]));

for (const entry of snapshot.entries) {
  let document;
  switch (entry.category) {
    case "rules-setting-guide": document = buildJournal(entry); break;
    case "keywords": document = buildKeyword(entry); break;
    case "breakthroughs": document = buildBreakthrough(entry); break;
    case "player-abilities": document = buildAbility(entry); break;
    case "races": document = buildRace(entry); break;
    case "classes": document = buildClass(entry); break;
    case "items": document = buildEquipment(entry); break;
    case "monsters": document = buildMonster(entry, monsterAbilityByStableId); break;
    case "monster-abilities": document = monsterAbilityByStableId.get(entry.stable_id); break;
    default: throw new Error(`Unsupported category ${entry.category}`);
  }
  const outputPack = entry.category === "items" ? itemPack(entry) : entry.category;
  if (outputPack) grouped[outputPack].push(document);
}

await mkdir(OUTPUT, { recursive: true });
for (const file of await readdir(OUTPUT)) {
  if (/^items-\d{2}\.json$/.test(file)) await rm(path.join(OUTPUT, file));
}
for (const file of await readdir(OUTPUT)) {
  if (Object.values(PACKS).some(({ prefix }) => new RegExp(`^${prefix}-\\d{2}\\.json$`).test(file))) {
    await rm(path.join(OUTPUT, file));
  }
}
// Packs this build does not own are carried over rather than dropped.
//
// Three packs — materials, mods and the crafting guide — are not produced by
// this tool at all. Rebuilding used to write a fresh index containing only
// what it had just generated, so running the documented command silently
// removed them from the index and the runtime stopped seeding 551 documents.
let previousIndex = {};
try {
  previousIndex = JSON.parse(await readFile(path.join(OUTPUT, "compendium-index.json"), "utf8"));
} catch {
  previousIndex = {};   // A first build has nothing to preserve.
}

const contentIndex = {
  schema_version: 1,
  rulebook_version: snapshot.rulebook_version,
  generated_from: path.relative(ROOT, SOURCE),
  packs: { ...(previousIndex.packs ?? {}) },
};
for (const [category, config] of Object.entries(PACKS)) {
  const documents = grouped[category].sort((a, b) => a.name.localeCompare(b.name));
  if (documents.length !== EXPECTED[category]) {
    throw new Error(`${category}: expected ${EXPECTED[category]}, got ${documents.length}`);
  }
  const chunks = chunkDocuments(documents);
  const files = [];
  for (const [index, chunk] of chunks.entries()) {
    const file = `${config.prefix}-${String(index + 1).padStart(2, "0")}.json`;
    await writeFile(path.join(OUTPUT, file), `${JSON.stringify(chunk, null, 2)}\n`);
    files.push(file);
  }
  contentIndex.packs[category] = { type: config.type, count: documents.length, files };
  console.log(`${category}: ${documents.length}`);
}
await writeFile(path.join(OUTPUT, "compendium-index.json"), `${JSON.stringify(contentIndex, null, 2)}\n`);
