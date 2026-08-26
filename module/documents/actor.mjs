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
import { isUnarmedProficient } from "../rules/proficiencies.mjs";
import { guardForDamage } from "../rules/damage.mjs";
import { buildCheckPayload, namedCheckTitle } from "../rules/check-card.mjs";
import { initiativeTargets } from "../rules/initiative.mjs";
import {
  expandAttackPlan,
  multiAttackCost,
  normalizeAttackCounts
} from "../rules/multi-attack.mjs";
import {
  buildCraftPayload,
  normalizeCraftProject,
  planCraftMaterials,
  resolveCraftOutput
} from "../rules/crafting.mjs";
import { installedModFlag, isCompatibleModTarget } from "../rules/mod-installation.mjs";
import {
  CRAFT_ACTIONS,
  applyCraftAction,
  canUseCraftAction,
  craftStatus,
  installCraftMod
} from "../rules/crafting-session.mjs";
import { craftValue } from "../rules/craft-value.mjs";
import { convertOfficialEquipment } from "../rules/equipment-import.mjs";
import { collectActorProficiencies } from "../rules/proficiencies.mjs";
import { resolveDamageType } from "../rules/damage-types.mjs";
import { applyChatMode } from "../rules/chat-content.mjs";

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
    // Re-checked against the collection rather than trusted from the scan
    // above: several awaits have happened since (fromUuid reaches a pack), and
    // deleting a class cascades, so a feature listed here may already be gone.
    // deleteEmbeddedDocuments throws on an id it cannot find, and one missing
    // id rejects the whole call — taking the update and create passes with it.
    const removeIds = remove.map((item) => item.id).filter((id) => this.items.has(id));
    if (removeIds.length) await this.deleteEmbeddedDocuments("Item", removeIds);
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
      flavour: namedCheckTitle(label, suffix),
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
    // Kept so an old macro or module calling attemptCraft still does something
    // sensible: take one Basic Craft, which is what a single "attempt" was.
    return this._craftAction(projectIndex, "basicCraft");
  }

  /**
   * Take one crafting action on a project.
   *
   * A craft is worked at over several actions rather than settled by one roll,
   * so this advances the session and leaves it open. Materials are spent on the
   * first action: the rules lose them on a failed craft, and a craft that is
   * never finished is a craft that failed.
   *
   * @param {number} projectIndex
   * @param {string} actionKey   A key of CRAFT_ACTIONS.
   */
  async craftAction(projectIndex, actionKey) {
    if (this.type !== "character" || !requireActorActionPermission(this)) return null;
    const action = await runExclusiveActorAction(this, () =>
      this._craftAction(projectIndex, actionKey));
    if (!action.started) {
      ui.notifications.warn(game.i18n.localize(actionLockWarningKey(action.reason)));
    }
    return action.value;
  }

  /** Read a project by index, or warn and return null. */
  _craftProject(projectIndex) {
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
    return { index, projects, project };
  }

  async _craftAction(projectIndex, actionKey) {
    const found = this._craftProject(projectIndex);
    if (!found) return null;
    const { index, projects, project } = found;

    if (project.completed) {
      ui.notifications.warn(game.i18n.format("LYRIAN.Warn.CraftCompleted", { name: project.name }));
      return null;
    }
    if (!LYRIAN.artisanSkills[project.skill]) {
      ui.notifications.warn(game.i18n.format("LYRIAN.Warn.UnknownArtisan", { skill: project.skill }));
      return null;
    }

    const allowed = canUseCraftAction(project, actionKey);
    if (!allowed.ok) {
      ui.notifications.warn(game.i18n.localize(`LYRIAN.Craft.Refused.${allowed.reason}`));
      return null;
    }

    // Materials go in as the craft begins, and are not returned.
    const consumesMaterials = game.settings.get("lyrian-chronicles", "craftingConsumesMaterials");
    let spent = [];
    if (!project.diceSpent) {
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
      spent = materialPlan.spent;
    }

    // The skill bonus is needed apart from the die: Beginners Luck drops it,
    // and Steady Craft replaces the die but keeps it.
    const skill = this.system.artisan?.[project.skill];
    const { bonus, suffix } = this._resolveExpertise(skill ?? {}, { useBest: true });

    const definition = CRAFT_ACTIONS[actionKey];
    let roll = null;
    let dieTotal = 0;
    if (definition.formula) {
      roll = await new Roll(definition.formula).evaluate();
      dieTotal = roll.total;
    }

    const applied = applyCraftAction(project, actionKey, { dieTotal, skillBonus: bonus });
    if (applied.refused) return null;

    projects[index] = { ...project, ...applied.session };
    await this.update({ "system.crafting.projects": projects });

    const status = craftStatus(projects[index]);
    await this._postCraftAction({
      project: projects[index],
      actionKey,
      roll,
      added: applied.added,
      doubled: applied.doubled,
      status,
      suffix,
      materials: spent,
      consumed: consumesMaterials && spent.length > 0
    });

    // Spending the last die ends the craft, so resolve it rather than leaving
    // the player with a finished session and no result.
    if (status.finished) return this._resolveCraft(index);
    return { project: projects[index], status, roll, added: applied.added };
  }

  /** Spend accumulated crafting points on one of the project's Mods. */
  async installProjectMod(projectIndex, modItemId) {
    if (this.type !== "character" || !requireActorActionPermission(this)) return null;
    const action = await runExclusiveActorAction(this, () =>
      this._installProjectMod(projectIndex, modItemId));
    if (!action.started) {
      ui.notifications.warn(game.i18n.localize(actionLockWarningKey(action.reason)));
    }
    return action.value;
  }

  async _installProjectMod(projectIndex, modItemId) {
    const found = this._craftProject(projectIndex);
    if (!found) return null;
    const { index, projects, project } = found;

    const mod = this.items.get(String(modItemId ?? ""));
    if (!mod) {
      ui.notifications.warn(game.i18n.format("LYRIAN.Warn.CraftModMissing", { name: modItemId }));
      return null;
    }

    // Checked here, where the player can still choose differently, rather
    // than silently declining to fit it when the craft resolves.
    const base = project.outputUuid ? await fromUuid(project.outputUuid) : null;
    const plan = resolveCraftOutput({ project, base, fallbackName: project.name });
    // Checked against what the craft will actually produce, not the reference
    // document it copies. A compendium entry is type "equipment", and every
    // Universal Weapon and Universal Armor Mod tests the target's type — so
    // checking the unconverted copy rejected all 81 of them out of hand.
    const target = plan.ok
      ? this._craftOutputItem(plan.data, plan.fromBase ? base?.name : "")
      : null;
    if (plan.ok && !isCompatibleModTarget(mod, target)) {
      ui.notifications.warn(game.i18n.format("LYRIAN.Warn.CraftModIncompatible", {
        mod: mod.name,
        output: target.name
      }));
      return null;
    }

    // One physical stack, one craft. Two projects could otherwise each pay for
    // the same Mod, and whichever resolved first would consume it — leaving
    // the other charged for a Mod that is no longer there to fit.
    const committedElsewhere = projects.some((other, row) => row !== index
      && (other.installedMods ?? []).some((entry) => entry.itemId === mod.id));
    if (committedElsewhere) {
      ui.notifications.warn(game.i18n.format("LYRIAN.Craft.ModRefused.committed", {
        mod: mod.name
      }));
      return null;
    }

    const cost = Math.max(0, Math.trunc(Number(mod.system?.craftingPoints) || 0));
    const result = installCraftMod(project, { itemId: mod.id, name: mod.name, cost });
    if (result.refused) {
      ui.notifications.warn(game.i18n.format(`LYRIAN.Craft.ModRefused.${result.refused}`, {
        mod: mod.name,
        cost,
        points: project.points
      }));
      return null;
    }

    projects[index] = { ...project, ...result.session };
    await this.update({ "system.crafting.projects": projects });
    ui.notifications.info(game.i18n.format("LYRIAN.Craft.ModFitted", {
      mod: mod.name,
      cost,
      points: projects[index].points
    }));
    return { project: projects[index], status: craftStatus(projects[index]) };
  }

  /**
   * Put a finished project back to the start, keeping the plan.
   *
   * A craft that fell short loses its materials, not its blueprint: the same
   * item can be attempted again. Without this the row is dead once it ends,
   * and the only way to try again is to delete the project and retype the
   * name, skill, target, dice, materials, Mods and output link.
   */
  async restartCraft(projectIndex) {
    if (this.type !== "character" || !requireActorActionPermission(this)) return null;
    const action = await runExclusiveActorAction(this, () => this._restartCraft(projectIndex));
    if (!action.started) {
      ui.notifications.warn(game.i18n.localize(actionLockWarningKey(action.reason)));
    }
    return action.value;
  }

  async _restartCraft(projectIndex) {
    const found = this._craftProject(projectIndex);
    if (!found) return null;
    const { index, projects, project } = found;
    if (!project.finished && !project.completed) {
      ui.notifications.warn(game.i18n.localize("LYRIAN.Warn.CraftNotFinished"));
      return null;
    }

    projects[index] = {
      ...project,
      points: 0,
      diceSpent: 0,
      usedActions: [],
      // The Mods paid for last time were consumed into the item that was made,
      // or are still in stock if it was not. Either way nothing is paid for on
      // this attempt yet.
      installedMods: [],
      finished: false,
      completed: false
    };
    await this.update({ "system.crafting.projects": projects });
    ui.notifications.info(game.i18n.format("LYRIAN.Craft.Restarted", {
      name: project.name || game.i18n.localize("LYRIAN.Craft.UnnamedOutput")
    }));
    return { project: projects[index], status: craftStatus(projects[index]) };
  }

  /** End a craft deliberately, before the dice run out. */
  async endCraft(projectIndex) {
    if (this.type !== "character" || !requireActorActionPermission(this)) return null;
    const action = await runExclusiveActorAction(this, () => this._resolveCraft(projectIndex));
    if (!action.started) {
      ui.notifications.warn(game.i18n.localize(actionLockWarningKey(action.reason)));
    }
    return action.value;
  }

  /**
   * Turn a craft's output into an item the character can actually use.
   *
   * A project linked to a compendium entry copies a reference document of type
   * "equipment", which nothing can equip or attack with. Dropping one into the
   * inventory converts it to a weapon, armor or gear item; a craft has to do
   * the same or the reward for a successful craft is an unusable page.
   *
   * Anything the converter does not recognise — a material, an artifice with
   * no weapon mapping — is left exactly as it was rather than forced into a
   * shape the rules do not give it.
   *
   * `detectionName` is the stock entry's own name, and matters because the
   * converter reads the type out of it: "Armor (Medium)" is what makes an
   * armour an armour, and "Axe (One-Handed)" is what puts an axe in the axe
   * proficiency group. Naming a craft "Bob's Blade" would otherwise cost it
   * its armour type outright, or drop a weapon into the improvised group.
   *
   * @param {object} data
   * @param {string} [detectionName]  The base entry's name, when it was renamed.
   */
  _craftOutputItem(data, detectionName = "") {
    if (data?.type !== "equipment") return data;
    const groups = this.type === "character"
      ? collectActorProficiencies(this).groups
      : null;
    const stockName = detectionName || data.name;
    const converted = convertOfficialEquipment({ ...data, name: stockName }, groups ? {
      weapons: groups.weapons.map((entry) => entry.name),
      armor: groups.armor.map((entry) => entry.name)
    } : { assumeProficient: true });
    if (!converted) return data;
    // The type came from the stock name; the label is whatever the smith chose.
    converted.name = data.name;
    return converted;
  }

  /**
   * Price a project's material lines against the stacks they were drawn from.
   *
   * The stacks are read at resolve time rather than when they were consumed:
   * spending units changes a stack's quantity, never its listed cost, and a
   * depleted stack is left in the inventory at zero rather than deleted.
   */
  _craftMaterialPrices(project) {
    return Array.from(project?.materials ?? [], (line) => {
      const item = this.items.get(String(line?.itemId ?? ""));
      return {
        name: item?.name ?? "",
        quantity: Math.max(0, Math.trunc(Number(line?.quantity) || 0)),
        // Owned Gear stores its price as `value`, a number. Only an
        // unconverted compendium entry carries the `cost` string, so both are
        // read: reading `cost` alone priced every material at nothing.
        value: item?.system?.value ?? item?.system?.cost ?? 0
      };
    }).filter((line) => line.quantity > 0);
  }

  /**
   * Settle a craft: build the item if the points reached its crafting HP,
   * and otherwise report the failure. The materials are already gone either
   * way, which is what the rules say a failed craft costs.
   */
  async _resolveCraft(projectIndex) {
    const found = this._craftProject(projectIndex);
    if (!found) return null;
    const { index, projects, project } = found;
    if (project.completed) return null;

    const status = craftStatus(project);
    const base = project.outputUuid ? await fromUuid(project.outputUuid) : null;
    const outputPlan = (project.outputUuid && !base?.toObject)
      ? { ok: false }
      : resolveCraftOutput({
          project,
          base,
          fallbackName: game.i18n.localize("LYRIAN.Craft.UnnamedOutput")
        });

    if (status.succeeds && !outputPlan.ok) {
      ui.notifications.warn(game.i18n.format("LYRIAN.Warn.CraftOutputMissing", {
        name: project.outputName || project.name
      }));
      return null;
    }

    // A compendium entry is a reference document of type "equipment": it can
    // be read but not equipped or attacked with. Crafting a longsword has to
    // produce a longsword you can swing, so the copy goes through the same
    // conversion a drop into the inventory does.
    const outputData = this._craftOutputItem(
      outputPlan.data, outputPlan.fromBase ? base?.name : "");

    // The Book Price of what was made, by the source spreadsheet's rule:
    // base item cost + 25 Clim per crafting point of every Mod + materials.
    const value = craftValue({
      base: outputData,
      mods: project.installedMods,
      materials: this._craftMaterialPrices(project)
    });
    if (status.succeeds && value.total > 0 && outputData) {
      // A crafted item is worth what it cost to make, not what the stock
      // entry it was copied from is listed at. Which field holds that depends
      // on the type: only "equipment" has a `cost` string, and writing it onto
      // a weapon would be dropped by the schema without a word.
      if (outputData.type === "equipment") {
        foundry.utils.setProperty(outputData, "system.cost", `${value.total} Clim`);
      } else {
        foundry.utils.setProperty(outputData, "system.value", value.total);
      }
    }

    let installed = [];
    if (status.succeeds) {
      const [created] = await this.createEmbeddedDocuments("Item", [outputData]);
      // Only Mods actually paid for during the craft are fitted, and only
      // those that suit what was made.
      const paid = (project.installedMods ?? [])
        .map((entry) => this.items.get(entry.itemId))
        .filter((mod) => mod && isCompatibleModTarget(mod, outputData));
      // Points were spent on every entry. One that cannot be fitted now — the
      // stack was sold, or the craft ended up making something else — is worth
      // saying out loud rather than quietly charging for nothing.
      if (paid.length < (project.installedMods ?? []).length) {
        const lost = (project.installedMods ?? [])
          .filter((entry) => !paid.some((mod) => mod.id === entry.itemId))
          .map((entry) => entry.name || entry.itemId);
        ui.notifications.warn(game.i18n.format("LYRIAN.Warn.CraftModLost", {
          mods: lost.join(", ")
        }));
      }
      if (created && paid.length) {
        await this.createEmbeddedDocuments("Item", paid.map((mod) => {
          const modData = mod.toObject();
          delete modData._id;
          foundry.utils.setProperty(
            modData,
            "flags.lyrian-chronicles.installedMod",
            installedModFlag(mod, created)
          );
          return modData;
        }));
        await this.deleteEmbeddedDocuments("Item", paid.map((mod) => mod.id));
      }
      installed = paid;
    }

    projects[index] = {
      ...project,
      finished: true,
      completed: status.succeeds,
      attempts: project.attempts + 1
    };
    await this.update({ "system.crafting.projects": projects });

    const skillLabel = game.i18n.localize(LYRIAN.artisanSkills[project.skill] ?? project.skill);
    const craftData = buildCraftPayload({
      actorUuid: this.uuid,
      projectIndex: index,
      project: projects[index],
      skillLabel,
      success: status.succeeds,
      materials: [],
      consumed: true,
      mods: installed,
      custom: outputPlan.custom,
      outputType: outputData?.type ?? "",
      status,
      value: status.succeeds ? value : null
    });
    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/lyrian-chronicles/templates/chat/craft-card.hbs",
      {
        actor: this,
        project: projects[index],
        skillLabel,
        status,
        success: status.succeeds,
        outputName: outputData?.name ?? project.name,
        custom: outputPlan.custom,
        mods: installed,
        value: status.succeeds ? value : null,
        resolved: true
      }
    );
    const messageData = {
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content,
      flags: { "lyrian-chronicles": { craft: craftData } }
    };
    applyChatMode(messageData, game.settings.get("core", "rollMode"));
    const message = await ChatMessage.create(messageData);

    Hooks.callAll("lyrianCraft", craftData);
    return { success: status.succeeds, status, message, craft: craftData };
  }

  /** Post the result of a single crafting action. */
  async _postCraftAction({ project, actionKey, roll, added, doubled, status, suffix, materials, consumed }) {
    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/lyrian-chronicles/templates/chat/craft-card.hbs",
      {
        actor: this,
        project,
        actionLabel: game.i18n.localize(`LYRIAN.Craft.Action.${actionKey}`),
        skillLabel: `${game.i18n.localize(LYRIAN.artisanSkills[project.skill] ?? project.skill)}${suffix ?? ""}`,
        roll,
        added,
        doubled,
        status,
        materials,
        consumed,
        tooltip: roll ? await roll.getTooltip() : ""
      }
    );
    const messageData = {
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content,
      rolls: roll ? [roll] : []
    };
    applyChatMode(messageData, game.settings.get("core", "rollMode"));
    const message = await ChatMessage.create(messageData);
    return message;
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
      flavour: namedCheckTitle(label),
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
    const roll = await this._rollCheck({
      formula: `1d4 + ${this.system.initiative.value}`,
      flavour: game.i18n.localize("LYRIAN.Roll.Initiative")
    });
    if (!roll) return roll;

    // Write the result through to the encounter. Without this the roll was
    // only a chat card, so a player who rolled from their sheet still showed
    // as unrolled in the tracker and the GM had to roll for them again.
    const targets = initiativeTargets({
      combatants: game.combat?.combatants ?? [],
      actorId: this.id,
      controlledTokenIds: canvas?.tokens?.controlled?.map((token) => token.id) ?? []
    });
    const writable = targets.filter((combatant) => combatant.isOwner);
    if (writable.length) {
      await game.combat.updateEmbeddedDocuments(
        "Combatant",
        writable.map((combatant) => ({ _id: combatant.id, initiative: roll.total }))
      );
    } else if (targets.length) {
      ui.notifications.warn(game.i18n.localize("LYRIAN.Warn.InitiativeNotOwned"));
    }
    return roll;
  }

  /**
   * Resolve several basic attacks from one activation, with or without a weapon.
   *
   * @param {object}  [options]
   * @param {string}  [options.itemId]  Weapon to swing; omitted means unarmed.
   * @param {object}  [options.counts]  Attacks wanted per type, e.g. {light: 2}.
   * @param {boolean} [options.free]    Skip the AP cost entirely.
   */
  async rollMultiAttack({ itemId = "", counts = {}, free = false } = {}) {
    if (!requireActorActionPermission(this)) return null;

    const plan = normalizeAttackCounts(counts, LYRIAN.attackTypes);
    if (!plan.length) {
      ui.notifications.warn(game.i18n.localize("LYRIAN.Warn.NoAttacksChosen"));
      return null;
    }

    const weapon = itemId ? this.items.get(itemId) : null;
    if (itemId && weapon?.type !== "weapon") {
      ui.notifications.warn(game.i18n.localize("LYRIAN.Warn.NoWeapon"));
      return null;
    }
    if (!weapon && this.type !== "character") {
      ui.notifications.warn(game.i18n.localize("LYRIAN.Warn.NoWeapon"));
      return null;
    }

    // One lock for the whole sequence. The per-attack entry points take the
    // same lock, so calling them here would refuse every swing after the first.
    const action = await runExclusiveActorAction(this, () =>
      this._rollMultiAttack(plan, weapon, free)
    );
    if (!action.started) {
      ui.notifications.warn(game.i18n.localize(actionLockWarningKey(action.reason)));
    }
    return action.value;
  }

  async _rollMultiAttack(plan, weapon, free) {
    const cost = multiAttackCost(plan, LYRIAN.attackTypes);
    // Charged once, so the sequence either happens or costs nothing.
    if (!free && cost > 0) {
      const paid = await this.spendResources({ ap: cost });
      if (!paid) return null;
    }

    const results = [];
    for (const attackType of expandAttackPlan(plan)) {
      const result = weapon
        ? await weapon._rollWeaponAttack(attackType, { free: true })
        : await this._rollUniversalAttack(attackType, { free: true });
      results.push(result ?? null);
    }

    const payload = { actorUuid: this.uuid, plan, cost, attacks: results.length };
    Hooks.callAll("lyrianMultiAttack", payload);
    return { ...payload, results };
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
      unarmedProficient: this.type !== "character" || isUnarmedProficient(this.system)
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
      damageType: resolveDamageType(this.system.universalDamageType, LYRIAN.damageTypes),
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
      damageType: resolveDamageType(this.system.universalDamageType, LYRIAN.damageTypes),
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
    if (!createMessage) return roll;

    const outcome = Number.isNumeric(dc)
      ? { dc, success: roll.total >= dc }
      : null;

    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/lyrian-chronicles/templates/chat/check-card.hbs",
      {
        actor: this,
        title: flavour,
        roll,
        outcome,
        tooltip: await roll.getTooltip()
      }
    );

    const messageData = {
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content,
      rolls: [roll],
      flags: {
        "lyrian-chronicles": {
          check: buildCheckPayload({ actorUuid: this.uuid, title: flavour, roll, outcome })
        }
      }
    };
    // Rendering our own card bypasses Roll#toMessage, which is what would
    // normally honour a blind or whispered roll mode — so apply it by hand.
    applyChatMode(messageData, game.settings.get("core", "rollMode"));
    await ChatMessage.create(messageData);
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
    await this.update({
      "system.ap.value": this.system.ap.max,
      // "Once on your turn" — the dual wield window is a new one each turn.
      "system.turn.dualWieldOpenerId": "",
      "system.turn.dualWieldUsed": false
    });
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
      "system.encounter.secretArtUsed": false,
      "system.turn.dualWieldOpenerId": "",
      "system.turn.dualWieldUsed": false
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

    // The table can turn automatic Guard off and subtract it by hand. The
    // setting has always been offered in the world options; until now nothing
    // read it, so switching it off changed nothing.
    const subtractGuard = game.settings.get("lyrian-chronicles", "autoApplyGuard");

    if (!trueDamage && subtractGuard) {
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
   * @param {object}  [options]
   * @param {boolean} [options.announce]  Overrides the announceExpSpending setting.
   */
  async spendExp(exp, reason = "", options = {}) {
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

    // Levelling a class routes through here, so this fires on every advance.
    // The milestone banner above is deliberately not suppressed: crossing a
    // tier loosens the skill rank cap, which the table needs to see.
    const announce = options.announce
      ?? game.settings.get("lyrian-chronicles", "announceExpSpending");
    if (announce) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this }),
        content: `<p>${game.i18n.format("LYRIAN.Msg.ExpSpent", {
          name: this.name,
          exp,
          reason: reason || game.i18n.localize("LYRIAN.Interlude.Training"),
          core: after
        })}</p>`
      });
    }
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
