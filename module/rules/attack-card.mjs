import { LYRIAN } from "../config.mjs";

const SYSTEM_ID = "lyrian-chronicles";

/** Build the stable, serializable payload exposed to modules and chat actions. */
export function buildAttackPayload({
  actor,
  source,
  sourceKind = "item",
  sourceProfile = "",
  attackType,
  damageType = "physical",
  attackRoll = null,
  damageRoll = null,
  isCrit = false,
  sureHit = false,
  pinpoint = 0,
  halfPierce = false,
  fullPierce = false,
  weaponGroup = null,
  ranged = null,
  keywords = [],
  targets = []
} = {}) {
  return {
    actorUuid: actor?.uuid ?? null,
    // Existing integrations use these item-shaped fields. They remain present
    // for monster profiles, with itemUuid null and the monster as the display source.
    itemUuid: sourceKind === "item" ? source?.uuid ?? null : null,
    itemName: source?.name ?? "",
    itemImg: source?.img ?? "",
    sourceUuid: source?.uuid ?? null,
    sourceKind,
    sourceProfile,
    attackType,
    damageType,
    weaponGroup,
    ranged,
    accuracy: attackRoll
      ? {
          total: attackRoll.total,
          formula: attackRoll.formula,
          natural: attackRoll.dice?.[0]?.total ?? null,
          isCrit: !!isCrit
        }
      : null,
    sureHit: !!sureHit,
    damage: damageRoll
      ? {
          total: damageRoll.total,
          formula: damageRoll.formula,
          maximised: !!isCrit
        }
      : null,
    keywords: Array.from(keywords ?? []),
    pierce: {
      pinpoint: pinpoint ?? 0,
      half: !!halfPierce,
      full: !!fullPierce
    },
    targets: targets.map((target) => ({
      actorUuid: target.uuid,
      tokenUuid: target.tokenUuid,
      name: target.name,
      evasion: target.evasion,
      dodgeEvasion: target.dodgeEvasion,
      guard: target.guard,
      blockGuard: target.blockGuard,
      untargetable: target.untargetable,
      hit: target.hit
    }))
  };
}

/** Render one attack card for weapons, abilities, and official monster profiles. */
export async function renderAttackCard({
  actor,
  source,
  sourceKind = "item",
  sourceProfile = "",
  attackType,
  damageType = "physical",
  attackRoll = null,
  damageRoll = null,
  isCrit = false,
  sureHit = false,
  pinpoint = 0,
  halfPierce = false,
  fullPierce = false,
  weaponGroup = null,
  ranged = null,
  keywords = [],
  legacyMonsterAttack = null
} = {}) {
  const targets = Array.from(game.user.targets).map((token) => {
    const target = token.actor;
    const cover = token.document?.getFlag(SYSTEM_ID, "cover") ?? "none";
    const defence = target.getDefencesAgainst({ cover, attacker: actor });
    const hit = defence.untargetable
      ? false
      : sureHit || (attackRoll?.total ?? 0) >= defence.evasion;
    return {
      uuid: target.uuid,
      tokenUuid: token.document?.uuid ?? null,
      name: target.name,
      evasion: defence.evasion,
      dodgeEvasion: defence.dodgeEvasion,
      guard: defence.guard,
      blockGuard: defence.blockGuard,
      coverNotes: defence.notes.join(", "),
      untargetable: defence.untargetable,
      hit
    };
  });

  const templateData = {
    item: source,
    actor,
    attackTypeLabel: game.i18n.localize(LYRIAN.attackTypes[attackType].label),
    damageTypeLabel: game.i18n.localize(LYRIAN.damageTypes[damageType]?.label ?? ""),
    attackRoll,
    attackTotal: attackRoll?.total,
    damageRoll,
    damageTotal: damageRoll?.total ?? 0,
    isCrit,
    sureHit,
    pinpoint,
    halfPierce,
    fullPierce,
    targets,
    hasTargets: targets.length > 0
  };

  const content = await foundry.applications.handlebars.renderTemplate(
    `systems/${SYSTEM_ID}/templates/chat/attack-card.hbs`,
    templateData
  );
  const payload = buildAttackPayload({
    actor,
    source,
    sourceKind,
    sourceProfile,
    attackType,
    damageType,
    attackRoll,
    damageRoll,
    isCrit,
    sureHit,
    pinpoint,
    halfPierce,
    fullPierce,
    weaponGroup,
    ranged,
    keywords,
    targets
  });

  const systemFlags = {
    attack: payload,
    damage: templateData.damageTotal,
    pinpoint,
    fullPierce,
    halfPierce,
    damageType
  };
  if (legacyMonsterAttack) systemFlags.monsterAttack = legacyMonsterAttack;

  const message = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    rolls: [attackRoll, damageRoll].filter(Boolean),
    flags: { [SYSTEM_ID]: systemFlags }
  });

  Hooks.callAll("lyrianAttack", payload, message);
  return message;
}
