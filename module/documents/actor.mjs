import { LYRIAN } from "../config.mjs";
import { parseMonsterAttackProfile } from "../rules/monster-attack.mjs";
import { isCriticalHit } from "../rules/ability-attack.mjs";
import { universalAttackProfile } from "../rules/universal-attack.mjs";
import { renderAttackCard } from "../rules/attack-card.mjs";
import {
  actionLockWarningKey,
  queueActorTransaction,
  runExclusiveActorAction
} from "../rules/action-transactions.mjs";
import {
  nonNegativeInteger,
  normalizeResourceCosts,
  positiveInteger
} from "../rules/numeric-input.mjs";
import {
  classFeatureGrants,
  featureSourceKey,
  indexGeneratedFeatures
} from "../rules/progression.mjs";
import {
  formatSkillCapViolation,
  skillCapViolations
} from "../rules/skill-caps.mjs";
import { schemaVersionForCreation } from "../rules/schema-versioning.mjs";
import { requireActorActionPermission } from "../rules/action-permissions.mjs";
import { guardForDamage } from "../rules/damage.mjs";
import {
  buildCraftPayload,
  normalizeCraftProject,
  planCraftMaterials,
  planCraftMods,
  resolveCraftOutput
} from "../rules/crafting.mjs";
import { installedModFlag } from "../rules/mod-installation.mjs";

/**
 * The Actor document for Lyrian Chronicles.
 * Rolls live here so macros can call them: actor.rollSkill("stealth")
 */
export class LyrianActor extends Actor {
  /** @type {Promise<void>|null} Prevent concurrent feature synchronization. */
  #progressionSync = null;

  /** @override */
  prepareData() {
    super.prepareData();
  }

  /** @override Stamp newly created and imported Actors with a monotonic schema revision. */
  async _preCreate(data, options, user) {
    const allowed = await super._preCreate(data, options, user);
    if (allowed === false) return false;
    this.updateSource({
      "system.schemaVersion": schemaVersionForCreation("Actor", this.system?.schemaVersion)
    });
    return allowed;
  }

  /** @override Enforce character skill and expertise caps for every update source. */
  async _preUpdate(changes, options, user) {
    const allowed = await super._preUpdate(changes, options, user);
    if (allowed === false || this.type !== "character") return allowed;

    const violations = skillCapViolations(this.system, changes);
    if (!violations.length) return allowed;

    const gmOverride = Boolean(user?.isGM && options?.lyrianAllowSkillCapOverride);
    if (gmOverride) return allowed;

    const labels = {
      expertise: game.i18n.localize("LYRIAN.SkillCap.Expertise"),
      groups: {
        skills: game.i18n.localize("LYRIAN.SkillCap.Main"),
        artisan: game.i18n.localize("LYRIAN.SkillCap.Artisan"),
        gathering: game.i18n.localize("LYRIAN.SkillCap.Gathering")
      },
      skills: {
        skills: Object.fromEntries(Object.entries(LYRIAN.skills).map(([key, definition]) => [
          key, game.i18n.localize(definition.label)
        ])),
        artisan: Object.fromEntries(Object.entries(LYRIAN.artisanSkills).map(([key, label]) => [
          key, game.i18n.localize(label)
        ])),
        gathering: Object.fromEntries(Object.entries(LYRIAN.gatheringSkills).map(([key, label]) => [
          key, game.i18n.localize(label)
        ]))
      }
    };
    const rows = violations.map((violation) =>
      `<li>${formatSkillCapViolation(violation, labels)}</li>`).join("");

    if (!user?.isGM) {
      ui.notifications.warn(game.i18n.localize("LYRIAN.SkillCap.Blocked"));
      return false;
    }

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("LYRIAN.SkillCap.OverrideTitle") },
      content: `<p>${game.i18n.localize("LYRIAN.SkillCap.OverridePrompt")}</p><ul>${rows}</ul>`
    });
    if (!confirmed) return false;
    options.lyrianAllowSkillCapOverride = true;
    return allowed;
  }

  /* -------------------------------------------- */
  /*  Roll data for formulas                       */
  /* -------------------------------------------- */

  /** @override */
  getRollData() {
    const data = { ...this.system };

    // Shorthands so a GM can write @power or @focus in a formula field.
    for (const [key, stat] of Object.entries(this.system.stats ?? {})) {
      data[key] = stat.total ?? stat.value;
    }
    for (const [key, stat] of Object.entries(this.system.subStats ?? {})) {
      data[key] = stat.total ?? stat.value;
    }

    data.guard = this.system.guard;
    data.evasion = this.system.evasion;
    data.potency = this.system.potency;
    data.spiritCore = this.system.spiritCore ?? 0;

    return data;
  }

  /* -------------------------------------------- */
  /*  Compendium progression                      */
  /* -------------------------------------------- */

  /** Synchronize race traits and unlocked class abilities from compendium links. */
  async syncProgressionFeatures() {
    if (this.#progressionSync) return this.#progressionSync;
    this.#progressionSync = this.#syncProgressionFeatures();
    try {
      return await this.#progressionSync;
    } finally {
      this.#progressionSync = null;
    }
  }

  /** Execute one serialized synchronization pass. */
  async #syncProgressionFeatures() {
    if (this.type !== "character") return;

    const expected = new Map();
    const addExpected = (sourceItem, grant, kind) => {
      const link = sourceItem.system.relationships?._links?.find(
        (entry) => entry.stableId === grant.stableId
      );
      if (!link?.uuid) return;
      expected.set(featureSourceKey({ sourceItemId: sourceItem.id, stableId: grant.stableId }), {
        ...grant,
        kind,
        sourceItemId: sourceItem.id,
        sourceName: sourceItem.name,
        uuid: link.uuid
      });
    };

    const races = this.items.filter((item) => item.type === "race");
    for (const race of races) {
      const relationships = race.system.relationships ?? {};
      for (const stableId of [...(relationships.abilities ?? []), ...(relationships.traits ?? [])]) {
        addExpected(race, { stableId, role: "Racial Trait", requiredLevel: 0 }, "race");
      }
      const variant = race.system.variants?.find(
        (choice) => choice.key === race.system.selectedVariant
      );
      if (variant?.abilityStableId) {
        addExpected(race, {
          stableId: variant.abilityStableId,
          role: variant.name || "House Trait",
          requiredLevel: 0
        }, "race");
      }
    }

    for (const classItem of this.items.filter((item) => item.type === "class")) {
      for (const grant of classFeatureGrants(classItem.system, classItem.system.abilitiesUnlocked)) {
        addExpected(classItem, grant, "class");
      }
    }

    const generated = this.items.filter(
      (item) => item.type === "ability" && item.getFlag("lyrian-chronicles", "featureSource")
    );
    const { byKey: generatedByKey, duplicates } = indexGeneratedFeatures(generated);
    const duplicateIds = new Set(duplicates.map((item) => item.id));

    const create = [];
    const update = [];
    for (const [key, grant] of expected) {
      if (generatedByKey.has(key)) continue;

      const owned = this.items.find(
        (item) => item.type === "ability" && item.system.stableId === grant.stableId &&
          !item.getFlag("lyrian-chronicles", "featureSource")
      );
      const featureSource = {
        kind: grant.kind,
        sourceItemId: grant.sourceItemId,
        sourceName: grant.sourceName,
        stableId: grant.stableId,
        requiredLevel: grant.requiredLevel,
        role: grant.role
      };
      if (owned) {
        update.push({
          _id: owned.id,
          "flags.lyrian-chronicles.featureSource": featureSource,
          "system.classStep": grant.requiredLevel
        });
        continue;
      }

      const source = await fromUuid(grant.uuid);
      if (!source) continue;
      const data = source.toObject();
      delete data._id;
      foundry.utils.setProperty(data, "flags.lyrian-chronicles.featureSource", featureSource);
      data.system.classStep = grant.requiredLevel;
      create.push(data);
    }

    const remove = generated.filter((item) => {
      const source = item.getFlag("lyrian-chronicles", "featureSource");
      return duplicateIds.has(item.id) || !expected.has(featureSourceKey(source));
    });
    if (remove.length) await this.deleteEmbeddedDocuments("Item", remove.map((item) => item.id));
    if (update.length) await this.updateEmbeddedDocuments("Item", update);
    if (create.length) await this.createEmbeddedDocuments("Item", create);

    const primary = races.find((item) => item.system.raceKind === "primary");
    const ancestry = races.find((item) => item.system.raceKind === "ancestry");
    const hybrid = primary?.getFlag("lyrian-chronicles", "hybridRace");
    const variant = primary?.system.variants?.find(
      (choice) => choice.key === primary.system.selectedVariant
    );
    const details = {
      race: hybrid?.displayName ?? primary?.name ?? "",
      subrace: ancestry?.name ?? variant?.name ?? ""
    };
    if (this.system.details.race !== details.race || this.system.details.subrace !== details.subrace) {
      await this.update({
        "system.details.race": details.race,
        "system.details.subrace": details.subrace
      });
    }
  }

  /* -------------------------------------------- */
  /*  Skills                                       */
  /* -------------------------------------------- */

  /**
   * Roll a main skill: d20 + sub stat + ranks + expertise (if applied).
   * @param {string} skillKey
   * @param {object} [options]
   * @param {boolean} [options.useExpertise]
   * @param {number}  [options.dc]
   */
  async rollSkill(skillKey, options = {}) {
    const skill = this.system.skills?.[skillKey];
    if (!skill) return ui.notifications.warn(game.i18n.format("LYRIAN.Warn.UnknownSkill", { skill: skillKey }));

    const { bonus, suffix } = this._resolveExpertise(skill, options);
    const label = game.i18n.localize(LYRIAN.skills[skillKey].label);

    return this._rollCheck({
      formula: `1d20 + ${bonus}`,
      flavour: label + suffix,
      dc: options.dc
    });
  }

  /** Roll an artisan crafting check: d10 + skill + expertise. */
  async rollArtisan(skillKey, options = {}) {
    const skill = this.system.artisan?.[skillKey];
    if (!skill) return ui.notifications.warn(game.i18n.format("LYRIAN.Warn.UnknownArtisan", { skill: skillKey }));

    const { bonus, suffix } = this._resolveExpertise(skill, options);
    return this._rollCheck({
      formula: `1d10 + ${bonus}`,
      flavour: game.i18n.format("LYRIAN.Roll.CraftingCheck", {
        skill: `${game.i18n.localize(LYRIAN.artisanSkills[skillKey])}${suffix}`
      }),
      dc: options.dc,
      createMessage: options.createMessage
    });
  }

  /**
   * Work out which expertise, if any, applies to this roll.
   *
   * A skill can hold several expertises, and only the character knows which
   * one covers the situation — so the sheet offers each as its own button and
   * passes an index. Nothing is applied unless one is chosen.
   *
   * @param {object} skill
   * @param {object} options
   * @param {number} [options.expertiseIndex]  Which expertise to apply.
   * @param {boolean} [options.useBest]        Apply the highest instead.
   */
  _resolveExpertise(skill, options = {}) {
    const list = skill.expertises ?? [];
    let chosen = null;

    if (Number.isInteger(options.expertiseIndex)) chosen = list[options.expertiseIndex];
    else if (options.useBest) chosen = skill.bestExpertise;

    if (!chosen) return { bonus: skill.total, suffix: "" };

    const name = chosen.name?.trim();
    return {
      bonus: chosen.total ?? skill.total + chosen.rank,
      suffix: name ? ` (${name})` : ""
    };
  }

  /** Roll a gathering strike: d10 + gathering skill. */
  async rollGathering(skillKey, options = {}) {
    const skill = this.system.gathering?.[skillKey];
    if (!skill) return ui.notifications.warn(game.i18n.format("LYRIAN.Warn.UnknownGathering", { skill: skillKey }));
    return this._rollCheck({
      formula: `1d10 + ${skill.total + (options.bonus ?? 0)}`,
      flavour: game.i18n.format("LYRIAN.Roll.GatheringCheck", {
        skill: game.i18n.localize(LYRIAN.gatheringSkills[skillKey])
      })
    });
  }

  /**
   * Attempt one free-form crafting project under the shared actor action lock.
   * Materials are consumed before the check and are never restored on failure.
   */
  async attemptCraft(projectIndex) {
    if (this.type !== "character" || !requireActorActionPermission(this)) return null;
    const action = await runExclusiveActorAction(this, () => this._attemptCraft(projectIndex));
    if (!action.started) {
      ui.notifications.warn(game.i18n.localize(actionLockWarningKey(action.reason)));
    }
    return action.value;
  }

  async _attemptCraft(projectIndex) {
    const index = Number(projectIndex);
    const projects = Array.from(
      this.system.crafting?.projects ?? [],
      (project) => normalizeCraftProject(project)
    );
    const project = projects[index];
    if (!project) {
      ui.notifications.warn(game.i18n.localize("LYRIAN.Warn.CraftProjectMissing"));
      return null;
    }
    if (project.completed) {
      ui.notifications.warn(game.i18n.format("LYRIAN.Warn.CraftCompleted", {
        name: project.name
      }));
      return null;
    }
    if (!LYRIAN.artisanSkills[project.skill]) {
      ui.notifications.warn(game.i18n.format("LYRIAN.Warn.UnknownArtisan", {
        skill: project.skill
      }));
      return null;
    }

    // A linked output that no longer resolves is a broken project, not a custom
    // one. Falling through to a forged item would quietly swap the result.
    const base = project.outputUuid ? await fromUuid(project.outputUuid) : null;
    const outputPlan = (project.outputUuid && !base?.toObject)
      ? { ok: false }
      : resolveCraftOutput({
          project,
          base,
          fallbackName: game.i18n.localize("LYRIAN.Craft.UnnamedOutput")
        });
    if (!outputPlan.ok) {
      ui.notifications.warn(game.i18n.format("LYRIAN.Warn.CraftOutputMissing", {
        name: project.outputName || project.name
      }));
      return null;
    }
    const outputData = outputPlan.data;

    const modPlan = planCraftMods({ mods: project.mods, items: this.items });
    if (!modPlan.ok) {
      ui.notifications.warn(game.i18n.format("LYRIAN.Warn.CraftModMissing", {
        name: modPlan.missing[0].name
      }));
      return null;
    }

    const consumesMaterials = game.settings.get(
      "lyrian-chronicles",
      "craftingConsumesMaterials"
    );
    const materialPlan = planCraftMaterials({
      materials: project.materials,
      items: this.items,
      consume: consumesMaterials
    });
    if (!materialPlan.ok) {
      const shortage = materialPlan.shortages[0];
      ui.notifications.warn(game.i18n.format("LYRIAN.Warn.CraftMaterialShort", {
        name: shortage.name,
        required: shortage.required,
        available: shortage.available
      }));
      return null;
    }

    if (materialPlan.updates.length) {
      await this.updateEmbeddedDocuments("Item", materialPlan.updates);
    }

    const roll = await this.rollArtisan(project.skill, {
      dc: project.dc,
      useBest: true,
      createMessage: false
    });
    if (!roll) return null;

    const success = roll.total >= project.dc;
    project.attempts += 1;
    if (success) {
      const [created] = await this.createEmbeddedDocuments("Item", [outputData]);
      // Mods are installed as flagged copies pointing at the new item, matching
      // how a Mod dropped onto owned gear is installed from the inventory tab.
      if (created && modPlan.mods.length) {
        await this.createEmbeddedDocuments("Item", modPlan.mods.map((mod) => {
          const modData = mod.toObject();
          delete modData._id;
          foundry.utils.setProperty(
            modData,
            "flags.lyrian-chronicles.installedMod",
            installedModFlag(mod, created)
          );
          return modData;
        }));
      }
      project.completed = true;
    }
    projects[index] = project;
    await this.update({ "system.crafting.projects": projects });

    const skillLabel = game.i18n.localize(LYRIAN.artisanSkills[project.skill]);
    const craftData = buildCraftPayload({
      actorUuid: this.uuid,
      projectIndex: index,
      project,
      skillLabel,
      roll,
      success,
      materials: materialPlan.spent,
      consumed: consumesMaterials,
      mods: modPlan.mods,
      custom: outputPlan.custom,
      outputType: outputData.type ?? ""
    });
    const tooltip = await roll.getTooltip();
    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/lyrian-chronicles/templates/chat/craft-card.hbs",
      {
        actor: this,
        project,
        skillLabel,
        roll,
        dc: project.dc,
        success,
        materials: materialPlan.spent,
        consumed: consumesMaterials,
        outputName: outputData.name,
        custom: outputPlan.custom,
        mods: modPlan.mods,
        tooltip
      }
    );
    const message = await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content,
      rolls: [roll],
      flags: { "lyrian-chronicles": { craft: craftData } }
    });
    Hooks.callAll("lyrianCraft", craftData);
    return { roll, success, message, craft: craftData };
  }

  /** Resist an effect: 2d10 + Toughness against the caster's Potency. */
  async rollSave(options = {}) {
    return this._rollCheck({
      formula: `2d10 + ${this.system.save}`,
      flavour: game.i18n.localize("LYRIAN.Roll.Save"),
      dc: options.potency
    });
  }

  /**
   * Roll d20 + an arbitrary value. Used for raw stat checks and for
   * contesting a defence number directly when the GM calls for it.
   * @param {string} label   Shown as the chat flavour.
   * @param {number} value   The bonus to add.
   * @param {object} [options]
   * @param {number} [options.dc]
   */
  async rollAttribute(label, value, options = {}) {
    return this._rollCheck({
      formula: `1d20 + ${Number(value) || 0}`,
      flavour: label,
      dc: options.dc
    });
  }

  /** Roll a main stat check: d20 + the stat's total. */
  async rollStat(statKey, options = {}) {
    const stat = this.system.stats?.[statKey] ?? this.system.subStats?.[statKey];
    if (!stat) return ui.notifications.warn(game.i18n.format("LYRIAN.Warn.UnknownStat", { stat: statKey }));
    const table = this.system.stats?.[statKey] ? "mainStats" : "subStats";
    const label = game.i18n.localize(LYRIAN[table][statKey]);
    return this.rollAttribute(label, stat.total, options);
  }

  /** Roll initiative outside of the tracker: 1d4 + Agility. */
  async rollInitiativeCheck() {
    return this._rollCheck({
      formula: `1d4 + ${this.system.initiative.value}`,
      flavour: game.i18n.localize("LYRIAN.Roll.Initiative")
    });
  }

  /** Roll a basic Light, Heavy, or Precise attack without an equipped weapon. */
  async rollUniversalAttack(attackType = "light", options = {}) {
    if (this.type !== "character") return null;
    if (!requireActorActionPermission(this)) return null;
    if (!["light", "heavy", "precise"].includes(attackType)) return null;

    const action = await runExclusiveActorAction(this, () =>
      this._rollUniversalAttack(attackType, options)
    );
    if (!action.started) {
      ui.notifications.warn(game.i18n.localize(actionLockWarningKey(action.reason)));
    }
    return action.value;
  }

  async _rollUniversalAttack(attackType, options) {
    const profile = universalAttackProfile({
      attackType,
      attackTypes: LYRIAN.attackTypes,
      power: this.system.stats.power.total,
      focus: this.system.stats.focus.total,
      standardAccuracy: this.system.accuracy.standard,
      preciseAccuracy: this.system.accuracy.precise,
      unarmedProficient: this.type !== "character" || !!this.system.proficiencies?.unarmed
    });
    if (!profile) return null;

    if (!options.free) {
      const paid = await this.spendResources({ ap: profile.ap });
      if (!paid) return null;
    }

    const attackRoll = await new Roll(`1d20 + ${profile.accuracyBonus}`).evaluate();
    const natural = attackRoll.dice[0]?.total ?? 0;
    const isCrit = isCriticalHit(natural);
    const damageRoll = await new Roll(profile.damageFormula, this.getRollData())
      .evaluate({ maximize: isCrit });
    const source = {
      name: game.i18n.localize("LYRIAN.Attack.Universal"),
      img: this.img,
      uuid: this.uuid
    };
    const message = await renderAttackCard({
      actor: this,
      source,
      sourceKind: "universal",
      sourceProfile: "unarmed",
      attackType,
      damageType: "physical",
      attackRoll,
      damageRoll,
      isCrit,
      pinpoint: profile.pinpoint,
      halfPierce: isCrit,
      weaponGroup: "unarmed",
      ranged: false
    });
    return { attackRoll, damageRoll, isCrit, message };
  }

  /** Roll a basic attack from an official compendium monster stat block. */
  async rollMonsterAttack(attackType = "light", options = {}) {
    if (!requireActorActionPermission(this)) return null;
    if (this.type !== "npc" && this.type !== "monster") return null;
    if (!["light", "heavy"].includes(attackType)) return null;

    const action = await runExclusiveActorAction(this, () =>
      this._rollMonsterAttack(attackType, options)
    );
    if (!action.started) {
      ui.notifications.warn(game.i18n.localize(actionLockWarningKey(action.reason)));
    }
    return action.value;
  }

  async _rollMonsterAttack(attackType, options) {
    const key = attackType === "heavy" ? "heavyAttack" : "lightAttack";
    const profileText = this.system.official?.[key] ?? "";
    const profile = parseMonsterAttackProfile(profileText);
    if (!profile) {
      return ui.notifications.warn(game.i18n.format("LYRIAN.Warn.NoAttackProfile", {
        name: this.name,
        attack: game.i18n.localize(`LYRIAN.Attack.${attackType}`)
      }));
    }

    if (!options.free) {
      const paid = await this.spendResources({ ap: LYRIAN.attackTypes[attackType].ap });
      if (!paid) return null;
    }

    const attackRoll = await new Roll(`1d20 + ${profile.accuracy}`).evaluate();
    const damageRoll = await new Roll(profile.damageFormula).evaluate();
    const legacyMonsterAttack = {
      actorUuid: this.uuid,
      attackType,
      accuracy: attackRoll.total,
      damage: damageRoll.total,
      damageFormula: profile.damageFormula,
      sourceProfile: profileText
    };
    const message = await renderAttackCard({
      actor: this,
      source: this,
      sourceKind: "monsterProfile",
      sourceProfile: profileText,
      attackType,
      damageType: "physical",
      attackRoll,
      damageRoll,
      legacyMonsterAttack
    });
    return { attackRoll, damageRoll, message };
  }

  /* -------------------------------------------- */

  async _rollCheck({ formula, flavour, dc, createMessage = true }) {
    if (!requireActorActionPermission(this)) return null;
    const roll = await new Roll(formula, this.getRollData()).evaluate();
    let flavorText = flavour;

    if (Number.isNumeric(dc)) {
      const success = roll.total >= dc;
      const tag = success
        ? game.i18n.localize("LYRIAN.Roll.Success")
        : game.i18n.localize("LYRIAN.Roll.Failure");
      flavorText += ` — DC ${dc}: <strong>${tag}</strong>`;
    }

    if (createMessage) {
      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: this }),
        flavor: flavorText
      });
    }
    return roll;
  }

  /* -------------------------------------------- */
  /*  Resources                                    */
  /* -------------------------------------------- */

  /**
   * Attempt to pay AP, RP and mana. Returns false and warns if you cannot.
   */
  async spendResources({ ap = 0, rp = 0, mana = 0 } = {}) {
    return queueActorTransaction(this, async () => {
      const s = this.system;
      const costs = normalizeResourceCosts({ ap, rp, mana });
      if (!costs) {
        ui.notifications.warn(game.i18n.localize("LYRIAN.Warn.InvalidAmount"));
        return false;
      }

      const shortfalls = [];
      if (costs.ap > s.ap.total) shortfalls.push(`${costs.ap} AP`);
      if (costs.rp > s.rp.total) shortfalls.push(`${costs.rp} RP`);
      if (costs.mana > s.mana.total) shortfalls.push(`${costs.mana} Mana`);

      if (shortfalls.length) {
        ui.notifications.warn(
          game.i18n.format("LYRIAN.Warn.NotEnoughResources", {
            name: this.name,
            cost: shortfalls.join(", ")
          })
        );
        return false;
      }

      const update = {};
      for (const [key, cost] of Object.entries(costs)) {
        if (!cost) continue;
        // Temporary points are spent first — they expire, so burning them last wastes them.
        const pool = s[key];
        const fromTemp = Math.min(pool.temp ?? 0, cost);
        update[`system.${key}.temp`] = (pool.temp ?? 0) - fromTemp;
        update[`system.${key}.value`] = pool.value - (cost - fromTemp);
      }

      await this.update(update);
      return true;
    });
  }

  /**
   * Refill AP to max at the start of the actor's turn.
   * Temporary AP is left alone — it was granted on top of the normal pool
   * and should survive the refresh until it is spent or cleared by hand.
   */
  async refreshTurn() {
    await this.update({ "system.ap.value": this.system.ap.max });
    Hooks.callAll("lyrianTurnStart", this);
    // Once-per-round ability locks reset when your turn comes round again.
    const locked = this.items.filter(
      (i) => ["ability", "monsterAbility"].includes(i.type) && i.system.usedThisRound
    );
    if (locked.length) {
      await this.updateEmbeddedDocuments(
        "Item",
        locked.map((i) => ({ _id: i.id, "system.usedThisRound": false }))
      );
    }
  }

  /**
   * Full refresh at the start of an encounter: AP, RP, and per-encounter flags.
   * Temporary AP, RP and mana are preserved. Anything granted before the fight
   * (a Rest interlude, a pre-battle buff) is meant to be available during it.
   */
  async startEncounter() {
    const update = {
      "system.ap.value": this.system.ap.max,
      "system.rp.value": this.system.rp.max,
      "system.encounter.secretArtUsed": false
    };
    if (this.type === "character") {
      update["system.encounter.encounterStartUsed"] = false;
      update["system.encounter.conclusionUsed"] = false;
      update["system.encounter.downedThisEncounter"] = 0;
    }
    await this.update(update);
    const locked = this.items.filter(
      (i) => ["ability", "monsterAbility"].includes(i.type) && i.system.usedThisRound
    );
    if (locked.length) {
      await this.updateEmbeddedDocuments(
        "Item",
        locked.map((i) => ({ _id: i.id, "system.usedThisRound": false }))
      );
    }
  }

  /* -------------------------------------------- */
  /*  Damage                                       */
  /* -------------------------------------------- */

  /**
   * Apply damage using the rulebook order: temp HP, then Guard, then HP.
   * @param {number} amount        Rolled damage.
   * @param {object} [options]
   * @param {string} [options.defence]  "none" | "dodge" | "block"
   * @param {boolean} [options.trueDamage]   Ignores Guard and temp HP entirely.
   * @param {boolean} [options.fullPierce]   Ignores Guard but not temp HP.
   * @param {boolean} [options.halfPierce]   Ignores Guard unless the target Dodges or Blocks.
   * @param {number}  [options.pinpoint]     Ignore this many points of Guard.
   */
  async applyDamage(amount, options = {}) {
    // Serialized for the same reason spendResources is: this reads hp and temp,
    // then writes values derived from them. Two cards resolving against one
    // target at once would otherwise both read the pre-damage total and the
    // second write would silently discard the first hit.
    return queueActorTransaction(this, () => this.#applyDamage(amount, options));
  }

  async #applyDamage(amount, options = {}) {
    const {
      defence = "none",
      trueDamage = false,
      fullPierce = false,
      halfPierce = false,
      pinpoint = 0
    } = options;
    const s = this.system;
    const normalizedAmount = positiveInteger(amount);
    if (!normalizedAmount) {
      return { applied: 0, guardUsed: 0, hp: s.hp.value };
    }
    const normalizedPinpoint = nonNegativeInteger(pinpoint) ?? 0;

    let final = normalizedAmount;
    let guardUsed = 0;

    if (!trueDamage) {
      guardUsed = guardForDamage({
        defence,
        guard: s.guard,
        blockGuard: s.blockGuard,
        fullPierce,
        halfPierce,
        pinpoint: normalizedPinpoint
      });
      final = normalizedAmount - guardUsed;

      // Only Block (or an equivalent reduction) can take an attack to zero.
      const floor = defence === "block" ? 0 : 1;
      final = Math.max(floor, final);
    }

    // Temp HP absorbs first, and true damage bypasses it.
    let temp = s.hp.temp;
    if (!trueDamage && temp > 0) {
      const absorbed = Math.min(temp, final);
      temp -= absorbed;
      final -= absorbed;
    }

    const newHp = s.hp.value - final;
    const update = { "system.hp.value": newHp, "system.hp.temp": temp };

    await this.update(update);
    await this._checkDowned(newHp);

    const result = { applied: final, guardUsed, hp: newHp };
    Hooks.callAll("lyrianDamage", this, result, options);
    return result;
  }

  /** Heal, respecting max HP. */
  async applyHealing(amount) {
    return queueActorTransaction(this, async () => {
      const normalizedAmount = positiveInteger(amount);
      if (!normalizedAmount) return this.system.hp.value;
      const newHp = Math.min(this.system.hp.max, this.system.hp.value + normalizedAmount);
      await this.update({ "system.hp.value": newHp });
      if (newHp > 0) await this.toggleStatusEffect("downed", { active: false });
      Hooks.callAll("lyrianHealing", this, normalizedAmount);
      return newHp;
    });
  }

  /* -------------------------------------------- */

  /** Flag Downed at 0 HP and Mortal Wound at negative max HP. */
  async _checkDowned(hp) {
    const max = this.system.hp.max;

    if (hp <= -max) {
      await this.toggleStatusEffect("downed", { active: true });
      await this.toggleStatusEffect("mortalWound", { active: true });
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this }),
        content: `<p><strong>${this.name}</strong> ${game.i18n.localize("LYRIAN.Msg.MortallyWounded")}</p>`
      });
      return;
    }

    if (hp <= 0) {
      // Grunts die outright; everyone else goes down.
      if ((this.type === "npc" || this.type === "monster") && this.system.diesWhenDropped) {
        await this.toggleStatusEffect("dead", { active: true, overlay: true });
        return;
      }
      await this.toggleStatusEffect("downed", { active: true });
      await this.toggleStatusEffect("prone", { active: true });
      if (this.type === "character") {
        await this.update({
          "system.encounter.downedThisEncounter": this.system.encounter.downedThisEncounter + 1
        });
      }
      Hooks.callAll("lyrianDowned", this);
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this }),
        content: `<p><strong>${this.name}</strong> ${game.i18n.localize("LYRIAN.Msg.Downed")}</p>`
      });
    }
  }

  /* -------------------------------------------- */
  /*  Encounter conclusion                         */
  /* -------------------------------------------- */

  /* -------------------------------------------- */
  /*  Cover and size                               */
  /* -------------------------------------------- */

  /**
   * Effective defences against one attacker, accounting for cover and the
   * size difference between the two combatants.
   *
   * Cover raises Evasion (and Guard for high cover). Size works both ways:
   * a larger target is easier to hit, a smaller one harder.
   *
   * @param {object} [options]
   * @param {string} [options.cover]     none | low | high | full
   * @param {Actor}  [options.attacker]  Used for the size comparison.
   * @returns {{evasion, dodgeEvasion, guard, blockGuard, untargetable, notes}}
   */
  getDefencesAgainst({ cover = "none", attacker = null } = {}) {
    const c = LYRIAN.cover[cover] ?? LYRIAN.cover.none;
    const notes = [];

    let evasion = this.system.evasion + c.evasion;
    let guard = this.system.guard + c.guard;
    if (c.evasion || c.guard) notes.push(game.i18n.localize(c.label));

    // Size: each step of difference shifts Evasion by 1 in the smaller
    // creature's favour. A Huge target is easy to hit; a Tiny one is not.
    if (attacker) {
      const sizes = Object.keys(LYRIAN.creatureSizes);
      const diff = sizes.indexOf(attacker.system.size) - sizes.indexOf(this.system.size);
      if (diff) {
        evasion += diff;
        notes.push(`${diff > 0 ? "+" : ""}${diff} size`);
      }
    }

    return {
      evasion,
      dodgeEvasion: evasion + LYRIAN.dodgeBonus,
      guard,
      blockGuard: this.system.blockGuard + c.guard,
      untargetable: !!c.untargetable,
      notes
    };
  }

  /** Squares this creature occupies, from its size. */
  get spaceOccupied() {
    return LYRIAN.creatureSizes[this.system.size]?.space ?? 1;
  }

  /* -------------------------------------------- */
  /*  Interlude and progression                    */
  /* -------------------------------------------- */

  /**
   * Spend interlude points. Returns false if the character cannot afford it.
   * @param {number} points
   * @param {string} reason  Recorded in chat so the table can audit spending.
   */
  async spendInterludePoints(points, reason = "") {
    if (this.type !== "character") return false;
    points = positiveInteger(points);
    if (!points) {
      ui.notifications.warn(game.i18n.localize("LYRIAN.Warn.InvalidAmount"));
      return false;
    }
    const available = this.system.interlude.points;
    if (points > available) {
      ui.notifications.warn(
        game.i18n.format("LYRIAN.Warn.NotEnoughInterlude", { name: this.name, points })
      );
      return false;
    }
    await this.update({ "system.interlude.points": available - points });
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p>${game.i18n.format("LYRIAN.Msg.InterludeSpent", {
        name: this.name,
        points,
        reason: reason || game.i18n.localize("LYRIAN.Interlude.GenericAction")
      })}</p>`
    });
    return true;
  }

  /**
   * Commit EXP to the spirit core. Spending EXP *is* how the core grows, so
   * this is the single place progression happens.
   * @param {number} exp
   * @param {string} reason
   */
  async spendExp(exp, reason = "") {
    if (this.type !== "character") return false;
    exp = positiveInteger(exp);
    if (!exp) {
      ui.notifications.warn(game.i18n.localize("LYRIAN.Warn.InvalidAmount"));
      return false;
    }
    if (exp > this.system.exp.available) {
      ui.notifications.warn(
        game.i18n.format("LYRIAN.Warn.NotEnoughExp", { name: this.name, exp })
      );
      return false;
    }

    const before = this.system.spiritCore;
    await this.update({ "system.exp.spent": this.system.exp.spent + exp });
    const after = this.system.spiritCore;

    // Announce crossing a milestone, since it loosens the skill rank cap.
    const crossed = LYRIAN.spiritCoreTiers.find(
      (t) => t.threshold > before && t.threshold <= after
    );
    if (crossed) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this }),
        content: `<p class="lyrian-banner">${game.i18n.format("LYRIAN.Msg.TierReached", {
          name: this.name, tier: game.i18n.localize(crossed.label)
        })}</p>`
      });
    }

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p>${game.i18n.format("LYRIAN.Msg.ExpSpent", {
        name: this.name,
        exp,
        reason: reason || game.i18n.localize("LYRIAN.Interlude.Training"),
        core: after
      })}</p>`
    });
    return true;
  }

  /**
   * The Recover interlude action: clears one injury.
   * @param {string} [injuryId]  Defaults to the first injury carried.
   */
  async recoverInjury(injuryId) {
    const injuries = this.items.filter((i) => i.type === "injury" && !i.system.suppressed);
    if (!injuries.length) {
      return ui.notifications.info(game.i18n.localize("LYRIAN.Msg.NoInjuries"));
    }

    const injury = injuryId ? this.items.get(injuryId) : injuries[0];
    if (!injury) return;

    const paid = await this.spendInterludePoints(1, game.i18n.localize("LYRIAN.Interlude.Recover"));
    if (!paid) return;

    await injury.delete();
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p>${game.i18n.format("LYRIAN.Msg.InjuryHealed", {
        name: this.name, injury: injury.name
      })}</p>`
    });
  }

  /**
   * The Rest interlude action: full HP and mana, plus 20% of each as temporary.
   */
  async takeRest() {
    const tempHp = Math.floor(this.system.hp.max * 0.2);
    const tempMana = Math.floor(this.system.mana.max * 0.2);

    await this.update({
      "system.hp.value": this.system.hp.max,
      "system.hp.temp": tempHp,
      "system.mana.value": this.system.mana.max,
      "system.mana.temp": tempMana
    });

    await this.toggleStatusEffect("downed", { active: false });
    await this.toggleStatusEffect("mortalWound", { active: false });

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p>${game.i18n.format("LYRIAN.Msg.Rested", {
        name: this.name, hp: tempHp, mana: tempMana
      })}</p>`
    });
  }

  /**
   * Roll 1d10 on the injury table and create the matching Injury item.
   */
  async rollInjury() {
    if (!requireActorActionPermission(this)) return null;
    const roll = await new Roll("1d10").evaluate();
    const entry = LYRIAN.injuryTable[roll.total];
    const name = game.i18n.localize(entry.label);

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${game.i18n.localize("LYRIAN.Roll.Injury")} — <strong>${name}</strong>`
    });

    await this.createEmbeddedDocuments("Item", [
      {
        name,
        type: "injury",
        img: "icons/svg/blood.svg",
        system: { injuryKey: entry.key, rolled: roll.total, fromDowned: true }
      }
    ]);

    return entry;
  }
}
