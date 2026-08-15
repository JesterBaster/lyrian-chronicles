import { LYRIAN } from "../config.mjs";
import { collectActorProficiencies } from "./proficiencies.mjs";

export const REQUIREMENT_STATUS = Object.freeze({
  PASS: "pass",
  FAIL: "fail",
  MANUAL: "manual"
});

const EMPTY_REQUIREMENTS = new Set(["", "-", "none", "none.", "n/a"]);

function key(value = "") {
  return String(value)
    .normalize("NFKD")
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLocaleLowerCase();
}

export function normalizeRequirement(value = "") {
  let text = String(value ?? "").trim();
  if (text === "LQ==") text = "-";
  return text
    .replace(/<br\s*\/?\s*>/gi, ". ")
    .replace(/<\/p\s*>/gi, ". ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .replace(/\.\s*\./g, ".")
    .trim();
}

function names(entries = []) {
  return entries.map((entry) => ({
    name: String(entry?.name ?? entry ?? "").trim(),
    key: key(entry?.name ?? entry),
    aliases: [...new Set([
      key(entry?.name ?? entry),
      key(String(entry?.name ?? entry ?? "").replace(/\s*\([^)]*\)/g, "")),
      key(String(entry?.name ?? entry ?? "").replace(/\s+I$/i, "")),
      key(String(entry?.name ?? entry ?? "").replace(/folk$/i, ""))
    ].filter(Boolean))],
    tier: Number(entry?.tier ?? entry?.system?.tier ?? 0),
    level: Number(entry?.level ?? entry?.system?.abilitiesUnlocked ?? 0),
    mastered: Boolean(entry?.mastered ?? Number(entry?.level ?? entry?.system?.abilitiesUnlocked) >= 8)
  })).filter((entry) => entry.key);
}

function mentioned(catalog, text) {
  const normalized = ` ${key(text)} `;
  const occurrences = [];
  for (const entry of catalog) {
    for (const alias of entry.aliases) {
      const needle = ` ${alias} `;
      let start = normalized.indexOf(needle);
      while (start >= 0) {
        occurrences.push({ entry, alias, start, end: start + needle.length });
        start = normalized.indexOf(needle, start + 1);
      }
    }
  }
  const surviving = occurrences.filter((current) => !occurrences.some((other) =>
    other !== current && other.start === current.start && other.end > current.end));
  return [...new Map(surviving.map(({ entry }) => [entry.key, entry])).values()];
}

function ownedByName(owned, candidate) {
  return owned.some((entry) =>
    entry.aliases.some((alias) => candidate.aliases.includes(alias)));
}

function addCheck(checks, id, label, passed) {
  if (checks.some((check) => check.id === id)) return;
  checks.push({ id, label, status: passed ? REQUIREMENT_STATUS.PASS : REQUIREMENT_STATUS.FAIL });
}

/**
 * Evaluate actor-state requirements without interpreting encounter facts that
 * Foundry cannot prove (for example, "an ally was hit" or "target is prone").
 * Unknown/contextual clauses are returned as manual instead of guessed.
 */
export function evaluateRequirement(requirement, context = {}) {
  const text = normalizeRequirement(requirement);
  const normalized = key(text);
  if (EMPTY_REQUIREMENTS.has(normalized)) {
    return { status: REQUIREMENT_STATUS.PASS, text, checks: [], manual: [] };
  }

  const classCatalog = names(context.catalog?.classes);
  const breakthroughCatalog = names(context.catalog?.breakthroughs);
  const abilityCatalog = names(context.catalog?.abilities);
  const raceCatalog = names(context.catalog?.races);
  const ownedClasses = names(context.actor?.classes);
  const ownedBreakthroughs = names(context.actor?.breakthroughs);
  const ownedAbilities = names(context.actor?.abilities);
  const ownedRaces = names(context.actor?.races);
  const checks = [];
  const manual = [];
  let recognized = false;
  let classDomain = false;
  let breakthroughDomain = false;
  let abilityDomain = false;
  let raceDomain = false;

  const masteryLanguage = /\b(mastered|maxed|mastery)\b/i.test(text);
  const anyClass = /\b(?:any|at least (?:one|1)) class (?:mastered|maxed)\b/i.test(text);
  if (anyClass) {
    recognized = true;
    classDomain = true;
    addCheck(checks, "class:any-mastered", "At least one class is mastered", ownedClasses.some((entry) => entry.mastered));
  }

  const classCountMatch = text.match(/\b(?:two|2) classes? (?:mastered|maxed)\b/i);
  if (classCountMatch) {
    recognized = true;
    classDomain = true;
    addCheck(checks, "class:two-mastered", "At least two classes are mastered",
      ownedClasses.filter((entry) => entry.mastered).length >= 2);
  }

  for (const match of text.matchAll(/(?:any|one|1) tier\s*(\d+) class (?:mastered|maxed)/gi)) {
    recognized = true;
    classDomain = true;
    const tier = Number(match[1]);
    addCheck(checks, `class:tier:${tier}`, `A tier ${tier} class is mastered`,
      ownedClasses.some((entry) => entry.mastered && entry.tier === tier));
  }

  if (masteryLanguage) {
    for (const sentence of text.split(/[.;]/).map((part) => part.trim()).filter(Boolean)) {
      if (!/\b(mastered|maxed)\b/i.test(sentence)) continue;
      const candidates = mentioned(classCatalog, sentence);
      if (!candidates.length) continue;
      recognized = true;
      classDomain = true;
      const unique = [...new Map(candidates.map((entry) => [entry.key, entry])).values()];
      const mastered = unique.filter((candidate) =>
        ownedClasses.some((entry) => entry.key === candidate.key && entry.mastered));
      const alternative = /\bor\b/i.test(sentence) || (sentence.includes(",") && unique.length > 1);
      const passed = alternative ? mastered.length > 0 : mastered.length === unique.length;
      addCheck(
        checks,
        `class:named:${unique.map((entry) => entry.key).join("|")}`,
        `${unique.map((entry) => entry.name).join(alternative ? " or " : " and ")} mastered`,
        passed
      );
    }
  }

  const mentionedBreakthroughs = mentioned(breakthroughCatalog, text);
  if (/\b(?:breakthrough|purchased|must have|requires?)\b/i.test(text) && mentionedBreakthroughs.length) {
    recognized = true;
    breakthroughDomain = true;
    const passed = mentionedBreakthroughs.some((candidate) => ownedByName(ownedBreakthroughs, candidate));
    addCheck(checks, `breakthrough:${mentionedBreakthroughs.map((entry) => entry.key).join("|")}`,
      `Own ${mentionedBreakthroughs.map((entry) => entry.name).join(" or ")}`, passed);
  }

  const mentionedAbilities = mentioned(abilityCatalog, text);
  if (/\b(?:ability|learned|possess|must have|requires?)\b/i.test(text) && mentionedAbilities.length) {
    recognized = true;
    abilityDomain = true;
    const passed = mentionedAbilities.some((candidate) => ownedByName(ownedAbilities, candidate));
    addCheck(checks, `ability:${mentionedAbilities.map((entry) => entry.key).join("|")}`,
      `Know ${mentionedAbilities.map((entry) => entry.name).join(" or ")}`, passed);
  }

  const mentionedRaces = mentioned(raceCatalog, text);
  const exactRace = mentionedRaces.some((candidate) => candidate.aliases.includes(normalized));
  if ((/\b(?:race|only|must be|be a|be human|be fae|be chimera|be youkai)\b/i.test(text) || exactRace) && mentionedRaces.length) {
    recognized = true;
    raceDomain = true;
    const passed = mentionedRaces.some((candidate) => ownedByName(ownedRaces, candidate));
    addCheck(checks, `race:${mentionedRaces.map((entry) => entry.key).join("|")}`,
      `Be ${mentionedRaces.map((entry) => entry.name).join(" or ")}`, passed);
  }

  for (const match of text.matchAll(/(\d[\d,]*)\+?\s+spirit core/gi)) {
    recognized = true;
    const minimum = Number(match[1].replaceAll(",", ""));
    addCheck(checks, `spirit-core:${minimum}`, `Spirit Core ${minimum}+`, Number(context.actor?.spiritCore ?? 0) >= minimum);
  }

  if (/\b(?:at|chosen at|taken at) character creation\b/i.test(text)) {
    recognized = true;
    addCheck(checks, "character-creation", "Taken during character creation", Boolean(context.atCharacterCreation));
  }

  const proficiencyNames = names(context.actor?.proficiencies);
  if (/\bproficien(?:t|cy)\b/i.test(text)) {
    const proficiencyCatalog = names(context.catalog?.proficiencies);
    const requested = mentioned(proficiencyCatalog, text);
    if (requested.length) {
      recognized = true;
      const passed = /\b(?:one of|at least one|any)\b/i.test(text)
        ? requested.some((candidate) => ownedByName(proficiencyNames, candidate))
        : requested.every((candidate) => ownedByName(proficiencyNames, candidate));
      addCheck(checks, `proficiency:${requested.map((entry) => entry.key).join("|")}`,
        `Proficient with ${requested.map((entry) => entry.name).join(" or ")}`, passed);
    }
  }

  const equipped = names(context.actor?.equippedWeapons);
  const weaponOnly = mentioned(names(context.catalog?.weapons), text);
  if (/\b(?:only|must be using|attack with)\b/i.test(text) && weaponOnly.length) {
    recognized = true;
    addCheck(checks, `weapon:${weaponOnly.map((entry) => entry.key).join("|")}`,
      `Use ${weaponOnly.map((entry) => entry.name).join(" or ")}`,
      weaponOnly.some((candidate) => ownedByName(equipped, candidate)));
  }
  if (/\btwo[- ]handed weapons? only\b/i.test(text)) {
    recognized = true;
    addCheck(checks, "weapon:two-handed", "Use an equipped two-handed weapon",
      Boolean(context.actor?.hasTwoHandedWeapon));
  }
  if (/\b(?:using|use|with) (?:a )?(?:great)?shield\b/i.test(text)) {
    recognized = true;
    addCheck(checks, "equipment:shield", "Use an equipped shield", Boolean(context.actor?.hasShield));
  }

  if (/\bGM approval\b/i.test(text)) manual.push("GM approval is required");

  const contextual = /\b(?:target|ally|enemy|previous action|previous turn|this encounter|same encounter|within range|airborne|mounted|stance|active|affected by|took damage|dealt damage|failed a saving throw|crafting session|gathering session|GM(?:'s)? discretion)\b/i;
  if (contextual.test(text)) manual.push("Encounter or GM context must be confirmed");

  // Cross-domain alternatives are deliberately advisory unless one side is
  // already proven. This prevents a valid alternative from being blocked by a
  // parser that cannot safely reconstruct the rulebook's full expression.
  const domains = [raceDomain, breakthroughDomain, abilityDomain, classDomain].filter(Boolean).length;
  const crossDomainAlternative = /\bor\b/i.test(text) && domains > 1;
  const failed = checks.filter((check) => check.status === REQUIREMENT_STATUS.FAIL);
  const passed = checks.filter((check) => check.status === REQUIREMENT_STATUS.PASS);
  if (crossDomainAlternative && passed.length && !failed.length) {
    return { status: REQUIREMENT_STATUS.PASS, text, checks, manual };
  }
  if (crossDomainAlternative && failed.length) manual.push("An alternative requirement needs confirmation");

  if (failed.length && !crossDomainAlternative) {
    return { status: REQUIREMENT_STATUS.FAIL, text, checks, manual };
  }
  if (!recognized || manual.length || crossDomainAlternative) {
    return { status: REQUIREMENT_STATUS.MANUAL, text, checks, manual: [...new Set(manual.length ? manual : ["Requirement needs confirmation"])] };
  }
  return { status: REQUIREMENT_STATUS.PASS, text, checks, manual: [] };
}

async function packCatalog(packName, fields = []) {
  const pack = game.packs.get(`lyrian-chronicles.${packName}`);
  if (!pack) return [];
  const index = await pack.getIndex({ fields });
  return index.map((entry) => ({ name: entry.name, ...(entry.system ?? {}) }));
}

export async function actorRequirementContext(actor, options = {}) {
  const [classes, breakthroughs, abilities, races] = await Promise.all([
    packCatalog("classes", ["system.tier"]),
    packCatalog("breakthroughs"),
    packCatalog("player-abilities"),
    packCatalog("races")
  ]);
  const proficiencies = collectActorProficiencies(actor);
  const equipment = actor.system.equipment ?? {};
  const ownedRaces = actor.items.filter((item) => item.type === "race").flatMap((item) => [
    item.name, item.system.primaryRace, item.system.subrace, item.system.clan,
    item.system.selectedVariant
  ].filter(Boolean));
  return {
    atCharacterCreation: Boolean(options.atCharacterCreation),
    catalog: {
      classes,
      breakthroughs,
      abilities,
      races,
      proficiencies: [
        ...Object.entries(LYRIAN.weaponGroups).flatMap(([group, definition]) => [
          group, game.i18n.localize(definition.label)
        ]),
        ...Object.entries(LYRIAN.armorCategories).flatMap(([category, definition]) => [
          category, game.i18n.localize(definition.label),
          `${game.i18n.localize(definition.label)} armor`,
          `${game.i18n.localize(definition.label)} armour`
        ]),
        ...proficiencies.groups.weapons.map((entry) => entry.name),
        ...proficiencies.groups.armor.map((entry) => entry.name)
      ],
      weapons: Object.entries(LYRIAN.weaponGroups).flatMap(([group, definition]) => [
        group, game.i18n.localize(definition.label)
      ])
    },
    actor: {
      classes: actor.items.filter((item) => item.type === "class").map((item) => ({
        name: item.name,
        tier: item.system.tier,
        level: item.system.abilitiesUnlocked,
        mastered: item.system.mastered
      })),
      breakthroughs: actor.items.filter((item) => item.type === "breakthrough").map((item) => item.name),
      abilities: actor.items.filter((item) => ["ability", "monsterAbility"].includes(item.type)).map((item) => item.name),
      races: ownedRaces,
      proficiencies: [
        ...proficiencies.groups.weapons.map((entry) => entry.name),
        ...proficiencies.groups.armor.map((entry) => entry.name)
      ],
      spiritCore: actor.system.spiritCore,
      equippedWeapons: (equipment.weapons ?? []).flatMap((weapon) => [
        weapon.name,
        weapon.system?.group,
        weapon.system?.group ? game.i18n.localize(LYRIAN.weaponGroups[weapon.system.group]?.label ?? weapon.system.group) : ""
      ].filter(Boolean)),
      hasTwoHandedWeapon: (equipment.weapons ?? []).some((weapon) => weapon.system?.isTwoHanded),
      hasShield: Boolean(equipment.shield)
    }
  };
}

export async function evaluateItemRequirements(actor, item, options = {}) {
  const requirement = item?.system?.requirements ?? item?.system?.requirement ?? "";
  const context = await actorRequirementContext(actor, options);
  return evaluateRequirement(requirement, context);
}

export async function confirmItemRequirements(actor, item, options = {}) {
  const result = await evaluateItemRequirements(actor, item, options);
  if (result.status === REQUIREMENT_STATUS.PASS) return true;

  const failed = result.checks
    .filter((check) => check.status === REQUIREMENT_STATUS.FAIL)
    .map((check) => `<li>${check.label}</li>`)
    .join("");
  const content = [
    `<p><strong>${item.name}</strong></p>`,
    `<p>${result.text}</p>`,
    failed ? `<p>Not met:</p><ul>${failed}</ul>` : "",
    result.status === REQUIREMENT_STATUS.MANUAL
      ? "<p>This requirement needs player/GM confirmation.</p>"
      : "<p>The automatic requirement check failed.</p>"
  ].join("");

  if (result.status === REQUIREMENT_STATUS.FAIL && !game.user.isGM) {
    ui.notifications.warn(game.i18n.format("LYRIAN.Requirement.Failed", { name: item.name }));
    return false;
  }
  return foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.format("LYRIAN.Requirement.ConfirmTitle", { name: item.name }) },
    content
  });
}
