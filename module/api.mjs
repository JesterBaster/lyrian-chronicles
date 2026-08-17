import { LYRIAN } from "./config.mjs";
import { parseMonsterAttackProfile } from "./rules/monster-attack.mjs";
import { evaluateItemRequirements } from "./rules/requirements.mjs";
import { availableUniversalAttacks } from "./rules/universal-attack.mjs";

/**
 * Public API for modules such as Automated Animations, Token Action HUD,
 * Sequencer and Dice So Nice.
 *
 * Everything here is a stability promise: names and payload shapes will not
 * change without a major version bump and a deprecation warning. Internals are
 * free to move around underneath.
 *
 * Reachable as `game.lyrian.api`.
 */
export const LyrianAPI = {
  version: "1.0",

  /* -------------------------------------------- */
  /*  Vocabulary                                   */
  /* -------------------------------------------- */

  /** Attack types a module can key animations to. */
  get attackTypes() {
    return Object.keys(LYRIAN.attackTypes);   // light, heavy, precise
  },

  /** Defensive reactions a defender can take. */
  get defenceReactions() {
    return Object.keys(LYRIAN.defenceReactions);   // none, dodge, block
  },

  get damageTypes() { return Object.keys(LYRIAN.damageTypes); },
  get weaponGroups() { return Object.keys(LYRIAN.weaponGroups); },
  get abilityKeywords() { return Object.keys(LYRIAN.abilityKeywords); },

  /* -------------------------------------------- */
  /*  Querying actors                              */
  /* -------------------------------------------- */

  /**
   * Everything a HUD needs to build a button bar, in one call.
   * @param {Actor} actor
   */
  getActionSet(actor) {
    if (!actor) return null;
    const weapons = actor.items.filter((i) => i.type === "weapon");
    const abilities = actor.items.filter((i) => ["ability", "monsterAbility"].includes(i.type));
    const universalAttacks = availableUniversalAttacks({
      actorType: actor.type,
      hasEquippedWeapon: weapons.some((weapon) => weapon.system.equipped),
      attackTypes: LYRIAN.attackTypes,
      apTotal: actor.system.ap.total
    });
    const monsterAttacks = (actor.type === "npc" || actor.type === "monster")
      ? ["light", "heavy"].flatMap((type) => {
          const sourceProfile = actor.system.official?.[`${type}Attack`] ?? "";
          const profile = parseMonsterAttackProfile(sourceProfile);
          if (!profile) return [];
          const apCost = LYRIAN.attackTypes[type].ap;
          return [{
            type,
            sourceProfile,
            accuracy: profile.accuracy,
            damageFormula: profile.damageFormula,
            apCost,
            affordable: actor.system.ap.total >= apCost
          }];
        })
      : [];

    return {
      resources: {
        ap: { value: actor.system.ap.value, max: actor.system.ap.max, temp: actor.system.ap.temp },
        rp: { value: actor.system.rp.value, max: actor.system.rp.max, temp: actor.system.rp.temp },
        mana: { value: actor.system.mana.value, max: actor.system.mana.max, temp: actor.system.mana.temp },
        hp: { value: actor.system.hp.value, max: actor.system.hp.max, temp: actor.system.hp.temp }
      },
      attacks: weapons.map((w) => ({
        itemId: w.id,
        uuid: w.uuid,
        name: w.name,
        img: w.img,
        equipped: w.system.equipped,
        group: w.system.group,
        ranged: w.system.isRanged,
        range: w.system.range,
        types: Object.entries(LYRIAN.attackTypes).map(([key, profile]) => ({
          type: key,
          apCost: profile.ap,
          affordable: actor.system.ap.total >= profile.ap
        }))
      })),
      universalAttacks,
      monsterAttacks,
      abilities: abilities.map((a) => ({
        itemId: a.id,
        uuid: a.uuid,
        name: a.name,
        img: a.img,
        timing: a.system.timing,
        keywords: Array.from(a.system.keywords ?? []),
        cost: { ap: a.system.apCost, rp: a.system.rpCost, mana: a.system.manaCost },
        available: !a.system.usedThisRound || a.system.isRapid,
        affordable:
          actor.system.ap.total >= a.system.apCost &&
          actor.system.rp.total >= a.system.rpCost &&
          actor.system.mana.total >= a.system.manaCost
      })),
      skills: Object.keys(LYRIAN.skills).map((key) => ({
        key,
        label: game.i18n.localize(LYRIAN.skills[key].label),
        total: actor.system.skills?.[key]?.total ?? 0
      })),
      defences: {
        evasion: actor.system.evasion,
        dodgeEvasion: actor.system.dodgeEvasion,
        guard: actor.system.guard,
        blockGuard: actor.system.blockGuard,
        potency: actor.system.potency,
        save: actor.system.save
      }
    };
  },

  /* -------------------------------------------- */
  /*  Performing actions                           */
  /* -------------------------------------------- */

  /**
   * Roll an attack. Resolves to the same payload broadcast on `lyrianAttack`.
   * @param {Actor} actor
   * @param {string} itemId
   * @param {"light"|"heavy"|"precise"} attackType
   * @param {object} [options]
   * @param {boolean} [options.free]  Skip the AP cost.
   */
  async rollAttack(actor, itemId, attackType = "light", options = {}) {
    const item = actor?.items.get(itemId);
    if (!item) throw new Error(`Lyrian API: no item ${itemId} on ${actor?.name}`);
    return item.rollAttack(attackType, options);
  },

  async rollUniversalAttack(actor, attackType = "light", options = {}) {
    if (actor?.type !== "character" || !actor?.rollUniversalAttack) {
      throw new Error(`Lyrian API: ${actor?.name ?? "actor"} cannot make a universal attack`);
    }
    return actor.rollUniversalAttack(attackType, options);
  },

  async rollMonsterAttack(actor, attackType = "light", options = {}) {
    if (!["npc", "monster"].includes(actor?.type) || !actor?.rollMonsterAttack) {
      throw new Error(`Lyrian API: ${actor?.name ?? "actor"} has no monster attack profile`);
    }
    return actor.rollMonsterAttack(attackType, options);
  },

  async useAbility(actor, itemId, options = {}) {
    const item = actor?.items.get(itemId);
    if (!item) throw new Error(`Lyrian API: no item ${itemId} on ${actor?.name}`);
    return item.rollAbility(options);
  },

  async evaluateRequirements(actor, itemId, options = {}) {
    const item = actor?.items.get(itemId);
    if (!item) throw new Error(`Lyrian API: no item ${itemId} on ${actor?.name}`);
    return evaluateItemRequirements(actor, item, options);
  },

  async rollSkill(actor, skillKey, options = {}) {
    return actor.rollSkill(skillKey, options);
  },

  async applyDamage(actor, amount, options = {}) {
    return actor.applyDamage(amount, options);
  },

  async applyHealing(actor, amount) {
    return actor.applyHealing(amount);
  },

  /* -------------------------------------------- */
  /*  Reading a chat card                          */
  /* -------------------------------------------- */

  /**
   * Pull the structured attack payload back off a ChatMessage.
   * Returns null for messages this system did not create.
   * @param {ChatMessage} message
   */
  getAttackData(message) {
    return message?.flags?.["lyrian-chronicles"]?.attack ?? null;
  },

  /** Pull the stable crafting result payload off a ChatMessage. */
  getCraftData(message) {
    return message?.flags?.["lyrian-chronicles"]?.craft ?? null;
  },

  /** True if this message is a Lyrian attack card. */
  isAttackCard(message) {
    return !!this.getAttackData(message);
  }
};

/* -------------------------------------------- */

/**
 * Hooks fired for modules to listen on.
 *
 * `lyrianAttack`   (data)                  after an attack resolves
 * `lyrianDamage`   (actor, result, data)   after damage is applied
 * `lyrianHealing`  (actor, amount)         after healing is applied
 * `lyrianDowned`   (actor)                 when an actor drops to 0 HP
 * `lyrianTurnStart`(actor)                 when AP refreshes on a turn
 * `lyrianCraft`    (data)                  after a craft attempt resolves
 *
 * The attack payload shape, stable across releases:
 * {
 *   actorUuid, itemUuid, itemName, sourceUuid, sourceKind, attackType, damageType,
 *   accuracy: { total, formula, natural, isCrit } | null,
 *   damage:   { total, formula, maximised } | null,
 *   keywords: string[],
 *   pierce:   { pinpoint, half, full },
 *   targets:  [{ actorUuid, tokenUuid, name, evasion, guard, hit }]
 * }
 */
export const LYRIAN_HOOKS = {
  attack: "lyrianAttack",
  damage: "lyrianDamage",
  healing: "lyrianHealing",
  downed: "lyrianDowned",
  turnStart: "lyrianTurnStart",
  craft: "lyrianCraft"
};
