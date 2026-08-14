export const CLASS_FEATURE_LEVELS = Object.freeze([1, 2, 4, 6, 8]);

const STANDARD_SKILLS = Object.freeze({
  athletics: "Athletics",
  riding: "Riding",
  deception: "Deception",
  roguecraft: "Roguecraft",
  stealth: "Stealth",
  artifice: "Artifice",
  appraise: "Appraise",
  commonKnowledge: "Common Knowledge",
  flight: "Flight",
  history: "History",
  linguistics: "Linguistics",
  magic: "Magic",
  medicine: "Medicine",
  religion: "Religion",
  animalHusbandry: "Animal Husbandry",
  insight: "Insight",
  perception: "Perception",
  survival: "Survival",
  art: "Art",
  intimidation: "Intimidation",
  negotiation: "Negotiation"
});

export function normalizeClassLevel(value) {
  return Math.max(1, Math.min(8, Number(value) || 1));
}

export function classFeatureGrants(classSystem, level = 1) {
  const relationships = classSystem?.relationships ?? {};
  const stableIds = [
    relationships.key_ability,
    ...(relationships.abilities ?? []),
    relationships.ultimate_ability
  ];

  return CLASS_FEATURE_LEVELS.map((requiredLevel, index) => ({
    stableId: stableIds[index],
    requiredLevel,
    role: index === 0 ? "Key Ability" : index === 4 ? "Ultimate" : `Ability ${index}`
  })).filter((grant) => grant.stableId && grant.requiredLevel <= normalizeClassLevel(level));
}

export function raceAttributeBonuses(attributes = "") {
  const text = String(attributes);
  const main = {};
  const sub = {};
  const mainKeys = ["power", "focus", "agility", "toughness"];
  const subKeys = ["fitness", "cunning", "reason", "awareness", "presence"];

  for (const key of mainKeys) {
    const match = text.match(new RegExp(`([+-]\\d+)\\s+in\\s+${key}`, "i"));
    if (match) main[key] = Number(match[1]);
  }
  for (const key of subKeys) {
    const match = text.match(new RegExp(`([+-]\\d+)\\s+in\\s+${key}`, "i"));
    if (match) sub[key] = Number(match[1]);
  }

  return {
    main,
    sub,
    chooseMain: /main stat of your choice/i.test(text) ? 1 : 0,
    chooseSub: /substat of your choice|sub stat of your choice/i.test(text) ? 1 : 0
  };
}

export function raceAmbitionExp(ambition = "") {
  const match = String(ambition).match(/additional\s+(\d+)\s+exp/i);
  return match ? Number(match[1]) : 0;
}

/** Convert official racial skill text into an allocatable restricted pool. */
export function raceSkillGrant(skills = "") {
  const text = String(skills);
  const pointsMatch = text.match(/(?:gain|additional)\s+\+?(\d+)\s+skill points?/i);
  const points = pointsMatch ? Number(pointsMatch[1]) : 0;
  if (!points) return { points: 0, allowedSkills: [] };

  const anyStandard = /any\s+non[- ]crafting\s+or\s+gathering\s+skill/i.test(text);
  const allowedSkills = anyStandard
    ? Object.keys(STANDARD_SKILLS)
    : Object.entries(STANDARD_SKILLS)
      .filter(([, label]) => new RegExp(`\\b${label.replace(" ", "\\s+")}\\b`, "i").test(text))
      .map(([key]) => key);
  return { points, allowedSkills };
}

/** Validate and cap a race item's chosen skill bonuses to its official pool. */
export function selectedRaceSkillBonuses(raceSystem = {}) {
  const grant = Number(raceSystem.skillGrant?.points)
    ? raceSystem.skillGrant
    : raceSkillGrant(raceSystem.grantedSkills);
  const allowed = new Set(grant.allowedSkills ?? []);
  const chosen = raceSystem.selectedSkillBonuses ?? {};
  const bonuses = {};
  let remaining = Math.max(0, Number(grant.points) || 0);

  for (const key of allowed) {
    if (!remaining) break;
    const value = Math.max(0, Math.floor(Number(chosen[key]) || 0));
    if (!value) continue;
    bonuses[key] = Math.min(value, remaining);
    remaining -= bonuses[key];
  }
  return {
    bonuses,
    granted: Math.max(0, Number(grant.points) || 0),
    allocated: Math.max(0, Number(grant.points) || 0) - remaining,
    unallocated: remaining
  };
}

export function selectedRaceBonuses(raceSystem = {}) {
  const automation = Object.keys(raceSystem.attributeBonuses ?? {}).length
    ? raceSystem.attributeBonuses
    : raceAttributeBonuses(raceSystem.attributes);
  const main = { ...(automation.main ?? {}) };
  const sub = { ...(automation.sub ?? {}) };
  if (automation.chooseMain && raceSystem.selectedMainStat) {
    main[raceSystem.selectedMainStat] = (main[raceSystem.selectedMainStat] ?? 0) + automation.chooseMain;
  }
  if (automation.chooseSub && raceSystem.selectedSubStat) {
    sub[raceSystem.selectedSubStat] = (sub[raceSystem.selectedSubStat] ?? 0) + automation.chooseSub;
  }
  return { main, sub };
}
