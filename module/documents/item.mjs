import { LYRIAN } from "../config.mjs";

/**
 * The Item document. Weapons and abilities know how to roll themselves.
 */
export class LyrianItem extends Item {
  /** @override */
  getRollData() {
    const data = { ...this.system };
    if (this.actor) Object.assign(data, this.actor.getRollData());
    return data;
  }

  /* -------------------------------------------- */
  /*  Weapon attacks                               */
  /* -------------------------------------------- */

  /**
   * Make a basic Light, Heavy or Precise attack with this weapon.
   * @param {string} attackType   "light" | "heavy" | "precise"
   * @param {object} [options]
   * @param {boolean} [options.free]  Skip the AP cost (opportunity attacks, dual wield).
   */
  async rollAttack(attackType = "light", options = {}) {
    if (this.type !== "weapon") return this.rollAbility(options);

    const actor = this.actor;
    if (!actor) return ui.notifications.warn(game.i18n.localize("LYRIAN.Warn.NoActor"));

    const profile = LYRIAN.attackTypes[attackType];
    if (!profile) return;

    // Pay AP unless the attack is free.
    if (!options.free) {
      const paid = await actor.spendResources({ ap: profile.ap });
      if (!paid) return;
    }

    const power = actor.system.stats.power.total;
    const accuracyBonus =
      (profile.accuracy === "doubleFocus"
        ? actor.system.accuracy.precise
        : actor.system.accuracy.standard) + (this.system.accuracyBonus ?? 0);

    // Accuracy check.
    const attackRoll = await new Roll(`1d20 + ${accuracyBonus}`).evaluate();
    const natural = attackRoll.dice[0]?.total ?? 0;
    const critThreshold = this.system.effectiveCrit ?? 20;
    const isCrit = natural >= critThreshold;

    // Damage. A critical hit deals maximum damage instead of rolling.
    const { formula, flat } = this.system.getDamageFormula(attackType, power);
    const damageFormula = flat ? `${formula} + ${flat}` : formula;
    const damageRoll = await new Roll(damageFormula).evaluate({ maximize: isCrit });

    // Precise attacks ignore Guard equal to the attacker's Focus.
    const pinpoint = profile.pinpoint ? actor.system.stats.focus.total : 0;

    await this._renderAttackCard({
      attackType,
      attackRoll,
      damageRoll,
      isCrit,
      pinpoint,
      halfPierce: isCrit,
      damageType: this.system.damageType
    });

    return { attackRoll, damageRoll, isCrit };
  }

  /* -------------------------------------------- */
  /*  Abilities                                    */
  /* -------------------------------------------- */

  /**
   * Use an ability: pay its costs, enforce the once-per-round rule,
   * and optionally roll an attached attack.
   */
  async rollAbility(options = {}) {
    if (this.type !== "ability" && this.type !== "monsterAbility") return this.postToChat();

    const actor = this.actor;
    if (!actor) return ui.notifications.warn(game.i18n.localize("LYRIAN.Warn.NoActor"));
    const sys = this.system;

    // Once per round, unless Rapid.
    const enforceOncePerRound = game.settings.get("lyrian-chronicles", "enforceOncePerRound");
    if (enforceOncePerRound && sys.usedThisRound && !sys.isRapid) {
      return ui.notifications.warn(
        game.i18n.format("LYRIAN.Warn.AlreadyUsed", { name: this.name })
      );
    }

    // One Secret Art per encounter.
    if (sys.isSecretArt && actor.type === "character" && actor.system.encounter.secretArtUsed) {
      return ui.notifications.warn(game.i18n.localize("LYRIAN.Warn.SecretArtSpent"));
    }

    if (!options.free) {
      const paid = await actor.spendResources({
        ap: sys.apCost,
        rp: sys.rpCost,
        mana: sys.manaCost
      });
      if (!paid) return;
    }

    const updates = {};
    if (enforceOncePerRound && !sys.isRapid) updates["system.usedThisRound"] = true;
    if (Object.keys(updates).length) await this.update(updates);

    if (sys.isSecretArt && actor.type === "character") {
      await actor.update({ "system.encounter.secretArtUsed": true });
    }

    // No attack payload: just describe the ability in chat.
    if (!sys.hasAttack) return this.postToChat();

    const profile = LYRIAN.attackTypes[sys.attackType];
    const accuracyBonus =
      profile.accuracy === "doubleFocus"
        ? actor.system.accuracy.precise
        : actor.system.accuracy.standard;

    const sureHit = sys.keywords?.has("sureHit");
    const attackRoll = sureHit ? null : await new Roll(`1d20 + ${accuracyBonus}`).evaluate();
    const natural = attackRoll?.dice[0]?.total ?? 0;
    const isCrit = !sureHit && natural >= 20;

    // Use the equipped weapon's damage if the ability rides on a weapon strike.
    let damageFormula = sys.damageFormula;
    if (sys.usesWeapon || !damageFormula) {
      const weapon = actor.system.equipment?.weapons?.[0];
      if (weapon) {
        const power = actor.system.stats.power.total;
        const { formula, flat } = weapon.system.getDamageFormula(sys.attackType, power);
        damageFormula = flat ? `${formula} + ${flat}` : formula;
      }
    }

    const damageRoll = damageFormula
      ? await new Roll(damageFormula, this.getRollData()).evaluate({ maximize: isCrit })
      : null;

    await this._renderAttackCard({
      attackType: sys.attackType,
      attackRoll,
      damageRoll,
      isCrit,
      pinpoint: profile.pinpoint ? actor.system.stats.focus.total : 0,
      halfPierce: isCrit || sys.keywords?.has("halfPierce"),
      fullPierce: sys.keywords?.has("fullPierce"),
      damageType: sys.damageType,
      sureHit
    });

    return { attackRoll, damageRoll, isCrit };
  }

  /* -------------------------------------------- */
  /*  Chat output                                  */
  /* -------------------------------------------- */

  /**
   * Render the attack chat card, including per-target hit resolution
   * and buttons for the defender's chosen reaction.
   */
  async _renderAttackCard(data) {
    const actor = this.actor;
    const targets = Array.from(game.user.targets).map((t) => {
      const target = t.actor;
      // Cover is read from a flag the GM sets on the token, so a token behind
      // a wall stays behind it without re-selecting options every attack.
      const cover = t.document?.getFlag("lyrian-chronicles", "cover") ?? "none";
      const def = target.getDefencesAgainst({ cover, attacker: actor });
      const evasion = def.evasion;
      const hit = def.untargetable
        ? false
        : data.sureHit || (data.attackRoll?.total ?? 0) >= evasion;
      return {
        id: target.id,
        uuid: target.uuid,
        tokenId: t.id,
        tokenUuid: t.document?.uuid ?? null,
        name: target.name,
        evasion,
        dodgeEvasion: def.dodgeEvasion,
        guard: def.guard,
        blockGuard: def.blockGuard,
        cover,
        coverNotes: def.notes.join(", "),
        untargetable: def.untargetable,
        hit
      };
    });

    const templateData = {
      item: this,
      actor,
      attackTypeLabel: game.i18n.localize(LYRIAN.attackTypes[data.attackType].label),
      damageTypeLabel: game.i18n.localize(LYRIAN.damageTypes[data.damageType]?.label ?? ""),
      attackRoll: data.attackRoll,
      attackTotal: data.attackRoll?.total,
      damageRoll: data.damageRoll,
      damageTotal: data.damageRoll?.total ?? 0,
      isCrit: data.isCrit,
      sureHit: data.sureHit,
      pinpoint: data.pinpoint,
      halfPierce: data.halfPierce,
      fullPierce: data.fullPierce,
      targets,
      hasTargets: targets.length > 0
    };

    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/lyrian-chronicles/templates/chat/attack-card.hbs",
      templateData
    );

    const rolls = [data.attackRoll, data.damageRoll].filter(Boolean);

    // Structured payload for third-party modules. Documented in module/api.mjs
    // and treated as a stability promise — additive changes only.
    const payload = {
      actorUuid: actor?.uuid ?? null,
      itemUuid: this.uuid,
      itemName: this.name,
      itemImg: this.img,
      attackType: data.attackType,
      damageType: data.damageType,
      weaponGroup: this.type === "weapon" ? this.system.group : null,
      ranged: this.type === "weapon" ? !!this.system.isRanged : null,
      accuracy: data.attackRoll
        ? {
            total: data.attackRoll.total,
            formula: data.attackRoll.formula,
            natural: data.attackRoll.dice[0]?.total ?? null,
            isCrit: !!data.isCrit
          }
        : null,
      sureHit: !!data.sureHit,
      damage: data.damageRoll
        ? {
            total: data.damageRoll.total,
            formula: data.damageRoll.formula,
            maximised: !!data.isCrit
          }
        : null,
      keywords: Array.from(this.system.keywords ?? []),
      pierce: {
        pinpoint: data.pinpoint ?? 0,
        half: !!data.halfPierce,
        full: !!data.fullPierce
      },
      targets: targets.map((t) => ({
        actorUuid: t.uuid,
        tokenUuid: t.tokenUuid,
        name: t.name,
        evasion: t.evasion,
        dodgeEvasion: t.dodgeEvasion,
        guard: t.guard,
        blockGuard: t.blockGuard,
        untargetable: t.untargetable,
        hit: t.hit
      }))
    };

    const message = await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      rolls,
      flags: {
        "lyrian-chronicles": {
          attack: payload,
          // Kept flat as well: the damage-application buttons read these.
          damage: templateData.damageTotal,
          pinpoint: data.pinpoint,
          fullPierce: data.fullPierce,
          halfPierce: data.halfPierce,
          damageType: data.damageType
        }
      }
    });

    Hooks.callAll("lyrianAttack", payload, message);
    return message;
  }

  /* -------------------------------------------- */

  /** Post a plain description card for items with no roll. */
  async postToChat() {
    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/lyrian-chronicles/templates/chat/item-card.hbs",
      { item: this, actor: this.actor, system: this.system }
    );

    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content
    });
  }
}
