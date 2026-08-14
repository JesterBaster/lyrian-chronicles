export const CLASS_FEATURE_LEVELS = Object.freeze([1, 2, 4, 6, 8]);

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
