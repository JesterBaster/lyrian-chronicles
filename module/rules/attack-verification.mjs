import { LYRIAN } from "../config.mjs";
import { isUnarmedProficient } from "./proficiencies.mjs";
import { abilityWeaponAttackContext } from "./ability-attack.mjs";
import { parseMonsterAttackProfile } from "./monster-attack.mjs";
import { universalAttackProfile } from "./universal-attack.mjs";

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function keywordKeys(sourceKeywords = []) {
  if (sourceKeywords instanceof Set) return [...sourceKeywords];
  if (Array.isArray(sourceKeywords)) return sourceKeywords;
  if (sourceKeywords && typeof sourceKeywords[Symbol.iterator] === "function") {
    return [...sourceKeywords];
  }
  if (sourceKeywords && typeof sourceKeywords === "object") {
    return Object.entries(sourceKeywords).filter(([, enabled]) => enabled).map(([key]) => key);
  }
  return [];
}

function keywordSet(sourceKeywords = []) {
  return new Set(keywordKeys(sourceKeywords).map((key) =>
    String(key).replace(/[^a-z0-9]/gi, "").toLocaleLowerCase()
  ));
}

/** Clamp an untrusted chat-card damage claim to a legitimate maximum. */
export function boundedDamage({ claimed, ceiling } = {}) {
  const maximum = finiteNonNegative(ceiling);
  const rawClaim = Number(claimed);
  const validClaim = Number.isFinite(rawClaim) && rawClaim >= 0;
  const requested = validClaim ? rawClaim : 0;
  const amount = Math.min(requested, maximum);
  return { amount, clamped: !validClaim || amount !== requested };
}

/** Derive guard-piercing effects from the real source and real attack profile. */
export function verifiedPierce({
  sourceKeywords = [],
  attackType = "",
  focus = 0,
  attackTypes = LYRIAN.attackTypes,
  critical = false
} = {}) {
  const keywords = keywordSet(sourceKeywords);
  const profile = attackTypes?.[attackType];
  return {
    pinpoint: profile?.pinpoint ? finiteNonNegative(focus) : 0,
    halfPierce: !keywords.has("fullpierce") &&
      (keywords.has("halfpierce") || Boolean(critical)),
    fullPierce: keywords.has("fullpierce")
  };
}

function actorPower(actor) {
  return Number(actor?.system?.stats?.power?.total) || 0;
}

function actorFocus(actor) {
  return Number(actor?.system?.stats?.focus?.total) || 0;
}

function ownedBy(source, actor) {
  return source?.actor?.uuid === actor?.uuid || source?.parent?.uuid === actor?.uuid;
}

function actualCriticalClaim(attack = {}) {
  return Boolean(attack.damage?.maximised && attack.accuracy?.isCrit);
}

function weaponFormula(source, actor, attackType) {
  const damage = source?.system?.getDamageFormula?.(attackType, actorPower(actor));
  if (!damage?.formula) return null;
  return damage.flat ? `${damage.formula} + ${damage.flat}` : damage.formula;
}

function abilityFormula(source, actor) {
  const system = source?.system ?? {};
  const attackType = system.attackType;
  if (!LYRIAN.attackTypes[attackType]) return null;
  const weapon = actor?.system?.equipment?.weapons?.[0] ?? null;
  const context = abilityWeaponAttackContext({
    ability: system,
    weapon,
    profile: LYRIAN.attackTypes[attackType],
    accuracy: actor?.system?.accuracy ?? {}
  });
  if (context.weapon) {
    return {
      attackType,
      formula: weaponFormula(context.weapon, actor, attackType),
      keywords: system.keywords
    };
  }
  return { attackType, formula: system.damageFormula || null, keywords: system.keywords };
}

/**
 * Resolve a chat attack to real Foundry documents and calculate its maximum
 * legitimate damage. Returns null when the source is missing or inconsistent.
 */
export async function legitimateAttackProfile({
  attack = {},
  resolveUuid = globalThis.fromUuid,
  RollClass = globalThis.Roll
} = {}) {
  if (typeof resolveUuid !== "function" || typeof RollClass !== "function") return null;

  const actor = attack.actorUuid ? await resolveUuid(attack.actorUuid) : null;
  if (!actor) return null;

  let attackType = attack.attackType;
  let formula = null;
  let sourceKeywords = [];
  let rollData = actor.getRollData?.() ?? {};

  if (attack.sourceKind === "monsterProfile") {
    const source = attack.sourceUuid ? await resolveUuid(attack.sourceUuid) : null;
    if (!source || source.uuid !== actor.uuid || !["light", "heavy"].includes(attackType)) return null;
    const key = attackType === "heavy" ? "heavyAttack" : "lightAttack";
    const profile = parseMonsterAttackProfile(source.system?.official?.[key]);
    formula = profile?.damageFormula ?? null;
  } else if (attack.sourceKind === "universal") {
    const source = attack.sourceUuid ? await resolveUuid(attack.sourceUuid) : null;
    if (!source || source.uuid !== actor.uuid || attack.sourceProfile !== "unarmed") return null;
    const profile = universalAttackProfile({
      attackType,
      attackTypes: LYRIAN.attackTypes,
      power: actorPower(actor),
      focus: actorFocus(actor),
      standardAccuracy: actor.system?.accuracy?.standard,
      preciseAccuracy: actor.system?.accuracy?.precise,
      unarmedProficient: actor.type !== "character" || isUnarmedProficient(actor.system)
    });
    formula = profile?.damageFormula ?? null;
  } else if (attack.sourceKind === "item" || !attack.sourceKind) {
    const source = attack.sourceUuid ? await resolveUuid(attack.sourceUuid) : null;
    if (!source || !ownedBy(source, actor)) return null;
    rollData = source.getRollData?.() ?? rollData;

    if (source.type === "weapon") {
      if (!LYRIAN.attackTypes[attackType]) return null;
      formula = weaponFormula(source, actor, attackType);
      sourceKeywords = source.system?.keywords;
    } else if (source.type === "ability" || source.type === "monsterAbility") {
      const ability = abilityFormula(source, actor);
      attackType = ability?.attackType;
      formula = ability?.formula;
      sourceKeywords = ability?.keywords;
    } else {
      return null;
    }
  } else {
    return null;
  }

  if (!formula || !LYRIAN.attackTypes[attackType]) return null;
  const roll = await new RollClass(formula, rollData).evaluate({ maximize: true });
  const ceiling = finiteNonNegative(roll.total);
  return {
    formula,
    ceiling,
    rollData,
    pierce: verifiedPierce({
      sourceKeywords,
      attackType,
      focus: actorFocus(actor),
      critical: actualCriticalClaim(attack)
    })
  };
}
