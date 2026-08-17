import { LYRIAN } from "../config.mjs";
import { renderAttackCard } from "../rules/attack-card.mjs";
import {
  actionLockWarningKey,
  runExclusiveActorAction
} from "../rules/action-transactions.mjs";
import { confirmItemRequirements } from "../rules/requirements.mjs";
import { schemaVersionForCreation } from "../rules/schema-versioning.mjs";
import { requireActorActionPermission } from "../rules/action-permissions.mjs";
import { isHybridBreakthrough } from "../rules/hybrid-race.mjs";
import {
  abilityWeaponAttackContext,
  isCriticalHit
} from "../rules/ability-attack.mjs";
import { abilityRefused, abilitySucceeded } from "../rules/ability-result.mjs";
import { prepareItemChatContent } from "../rules/chat-content.mjs";

/**
 * The Item document. Weapons and abilities know how to roll themselves.
 */
export class LyrianItem extends Item {
  /** @override Stamp newly created and imported Items with a monotonic schema revision. */
  async _preCreate(data, options, user) {
    const allowed = await super._preCreate(data, options, user);
    if (allowed === false) return false;
    options ??= {};
    this.updateSource({
      "system.schemaVersion": schemaVersionForCreation("Item", this.system?.schemaVersion)
    });
    if (this.actor && isHybridBreakthrough(this) && !options.lyrianCharacterCreation &&
        !options.lyrianAllowHybridOverride) {
      if (!user?.isGM) {
        ui.notifications.warn(game.i18n.localize("LYRIAN.Hybrid.CreationOnly"));
        return false;
      }
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("LYRIAN.Hybrid.OverrideTitle") },
        content: `<p>${game.i18n.localize("LYRIAN.Hybrid.OverridePrompt")}</p>`
      });
      if (!confirmed) return false;
      options.lyrianAllowHybridOverride = true;
    }
    return allowed;
  }

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
    if (!requireActorActionPermission(actor)) return null;

    const action = await runExclusiveActorAction(actor, () =>
      this._rollWeaponAttack(attackType, options)
    );
    if (!action.started) {
      ui.notifications.warn(game.i18n.localize(actionLockWarningKey(action.reason)));
    }
    return action.value;
  }

  async _rollWeaponAttack(attackType, options) {
    const actor = this.actor;

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
    const isCrit = isCriticalHit(natural, critThreshold);

    // Damage. A critical hit deals maximum damage instead of rolling.
    const { formula, flat } = this.system.getDamageFormula(attackType, power);
    const damageFormula = flat ? `${formula} + ${flat}` : formula;
    const damageRoll = await new Roll(damageFormula).evaluate({ maximize: isCrit });

    // Precise attacks ignore Guard equal to the attacker's Focus.
    const pinpoint = profile.pinpoint ? actor.system.stats.focus.total : 0;

    await renderAttackCard({
      actor,
      source: this,
      attackType,
      attackRoll,
      damageRoll,
      isCrit,
      pinpoint,
      halfPierce: isCrit,
      damageType: this.system.damageType,
      weaponGroup: this.system.group,
      ranged: !!this.system.isRanged,
      keywords: this.system.keywords
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
    if (!actor) {
      ui.notifications.warn(game.i18n.localize("LYRIAN.Warn.NoActor"));
      return abilityRefused("no-actor");
    }
    if (!requireActorActionPermission(actor)) return abilityRefused("forbidden");

    const action = await runExclusiveActorAction(actor, () => this._rollAbility(options));
    if (!action.started) {
      ui.notifications.warn(game.i18n.localize(actionLockWarningKey(action.reason)));
      return abilityRefused(action.reason ?? "busy");
    }
    return action.value;
  }

  async _rollAbility(options) {
    const actor = this.actor;
    const sys = this.system;

    if (!options.ignoreRequirements || !game.user.isGM) {
      const allowed = await confirmItemRequirements(actor, this, options);
      if (!allowed) return abilityRefused("requirements");
    }

    // Once per round, unless Rapid.
    const enforceOncePerRound = game.settings.get("lyrian-chronicles", "enforceOncePerRound");
    if (enforceOncePerRound && sys.usedThisRound && !sys.isRapid) {
      ui.notifications.warn(
        game.i18n.format("LYRIAN.Warn.AlreadyUsed", { name: this.name })
      );
      return abilityRefused("already-used");
    }

    // One Secret Art per encounter.
    if (sys.isSecretArt && actor.system.encounter?.secretArtUsed) {
      ui.notifications.warn(game.i18n.localize("LYRIAN.Warn.SecretArtSpent"));
      return abilityRefused("secret-art-spent");
    }

    if (!options.free) {
      const paid = await actor.spendResources({
        ap: sys.apCost,
        rp: sys.rpCost,
        mana: sys.manaCost
      });
      if (!paid) return abilityRefused("payment");
    }

    const updates = {};
    if (enforceOncePerRound && !sys.isRapid) updates["system.usedThisRound"] = true;
    if (Object.keys(updates).length) await this.update(updates);

    if (sys.isSecretArt) {
      await actor.update({ "system.encounter.secretArtUsed": true });
    }

    // No attack payload: just describe the ability in chat.
    if (!sys.hasAttack) {
      const message = await this.postToChat();
      return abilitySucceeded({ message });
    }

    const profile = LYRIAN.attackTypes[sys.attackType];
    const weaponContext = abilityWeaponAttackContext({
      ability: sys,
      weapon: actor.system.equipment?.weapons?.[0] ?? null,
      profile,
      accuracy: actor.system.accuracy
    });

    const sureHit = sys.keywords?.has("sureHit");
    const attackRoll = sureHit
      ? null
      : await new Roll(`1d20 + ${weaponContext.accuracyBonus}`).evaluate();
    const natural = attackRoll?.dice[0]?.total ?? 0;
    const isCrit = !sureHit && isCriticalHit(natural, weaponContext.critThreshold);

    // Use the equipped weapon's damage if the ability rides on a weapon strike.
    let damageFormula = sys.damageFormula;
    if (weaponContext.weapon) {
      const power = actor.system.stats.power.total;
      const { formula, flat } = weaponContext.weapon.system.getDamageFormula(sys.attackType, power);
      damageFormula = flat ? `${formula} + ${flat}` : formula;
    }

    const damageRoll = damageFormula
      ? await new Roll(damageFormula, this.getRollData()).evaluate({ maximize: isCrit })
      : null;

    const message = await renderAttackCard({
      actor,
      source: this,
      attackType: sys.attackType,
      attackRoll,
      damageRoll,
      isCrit,
      pinpoint: profile.pinpoint ? actor.system.stats.focus.total : 0,
      halfPierce: isCrit || sys.keywords?.has("halfPierce"),
      fullPierce: sys.keywords?.has("fullPierce"),
      damageType: sys.damageType,
      weaponGroup: weaponContext.weaponGroup,
      ranged: weaponContext.ranged,
      sureHit,
      keywords: sys.keywords
    });

    return abilitySucceeded({ attackRoll, damageRoll, isCrit, message });
  }

  /* -------------------------------------------- */
  /*  Chat output                                  */
  /* -------------------------------------------- */

  /** Post a plain description card for items with no roll. */
  async postToChat() {
    if (!requireActorActionPermission(this.actor)) return null;
    const enrichHTML = foundry.applications.ux.TextEditor.implementation.enrichHTML;
    const enrichOptions = { relativeTo: this, rollData: this.getRollData() };
    const { enrichedDescription, enrichedRequirement } = await prepareItemChatContent({
      description: this.system.description,
      requirement: this.system.requirements ?? this.system.requirement,
      enrichHTML,
      cleanHTML: foundry.utils.cleanHTML,
      enrichOptions
    });
    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/lyrian-chronicles/templates/chat/item-card.hbs",
      {
        item: this,
        actor: this.actor,
        system: this.system,
        enrichedDescription,
        enrichedRequirement
      }
    );

    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content
    });
  }
}
