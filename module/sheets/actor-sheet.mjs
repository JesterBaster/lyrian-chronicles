import { LYRIAN } from "../config.mjs";
import { adjustResourcePool } from "../rules/resource-utils.mjs";
import { normalizeClassLevel } from "../rules/progression.mjs";

const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Character and NPC sheet.
 */
export class LyrianActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["lyrian", "sheet", "actor"],
    position: { width: 820, height: 800 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      rollSkill: LyrianActorSheet.#onRollSkill,
      addExpertise: LyrianActorSheet.#onAddExpertise,
      removeExpertise: LyrianActorSheet.#onRemoveExpertise,
      rollAttribute: LyrianActorSheet.#onRollAttribute,
      rollArtisan: LyrianActorSheet.#onRollArtisan,
      rollGathering: LyrianActorSheet.#onRollGathering,
      rollSave: LyrianActorSheet.#onRollSave,
      rollInitiative: LyrianActorSheet.#onRollInitiative,
      rollInjury: LyrianActorSheet.#onRollInjury,
      attack: LyrianActorSheet.#onAttack,
      monsterAttack: LyrianActorSheet.#onMonsterAttack,
      useItem: LyrianActorSheet.#onUseItem,
      browsePack: LyrianActorSheet.#onBrowsePack,
      adjustClassLevel: LyrianActorSheet.#onAdjustClassLevel,
      createItem: LyrianActorSheet.#onCreateItem,
      editItem: LyrianActorSheet.#onEditItem,
      deleteItem: LyrianActorSheet.#onDeleteItem,
      toggleEquip: LyrianActorSheet.#onToggleEquip,
      adjustResource: LyrianActorSheet.#onAdjustResource,
      refreshTurn: LyrianActorSheet.#onRefreshTurn,
      startEncounter: LyrianActorSheet.#onStartEncounter,
      takeRest: LyrianActorSheet.#onTakeRest,
      recoverInjury: LyrianActorSheet.#onRecoverInjury,
      spendExpPrompt: LyrianActorSheet.#onSpendExp,
      openCreation: LyrianActorSheet.#onOpenCreation
    },
    dragDrop: [{ dragSelector: "[data-drag]", dropSelector: null }]
  };

  /** @override */
  static PARTS = {
    header: { template: "systems/lyrian-chronicles/templates/actor/header.hbs" },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    main: { template: "systems/lyrian-chronicles/templates/actor/tab-main.hbs" },
    skills: { template: "systems/lyrian-chronicles/templates/actor/tab-skills.hbs" },
    abilities: { template: "systems/lyrian-chronicles/templates/actor/tab-abilities.hbs" },
    inventory: { template: "systems/lyrian-chronicles/templates/actor/tab-inventory.hbs" },
    progression: { template: "systems/lyrian-chronicles/templates/actor/tab-progression.hbs" },
    biography: { template: "systems/lyrian-chronicles/templates/actor/tab-biography.hbs" }
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "main", icon: "fa-solid fa-shield-halved" },
        { id: "skills", icon: "fa-solid fa-dice-d20" },
        { id: "abilities", icon: "fa-solid fa-wand-sparkles" },
        { id: "inventory", icon: "fa-solid fa-sack" },
        { id: "progression", icon: "fa-solid fa-gem" },
        { id: "biography", icon: "fa-solid fa-feather" }
      ],
      initial: "main",
      labelPrefix: "LYRIAN.Tab"
    }
  };

  /* -------------------------------------------- */

  /** @override */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    // NPCs have no skill sheet or interlude bookkeeping.
    if (this.document.type === "npc" || this.document.type === "monster") {
      delete parts.skills;
      delete parts.progression;
    }
    return parts;
  }

  /** @override */
  _prepareTabs(group) {
    const tabs = super._prepareTabs(group);
    if (this.document.type === "npc" || this.document.type === "monster") {
      delete tabs.skills;
      delete tabs.progression;
    }
    return tabs;
  }

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.document;

    context.actor = actor;
    context.system = actor.system;
    context.config = LYRIAN;
    context.isCharacter = actor.type === "character";
    context.isNPC = actor.type === "npc" || actor.type === "monster";
    context.editable = this.isEditable;
    context.systemFields = actor.system.schema.fields;

    context.enrichedBiography = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      actor.system.biography ?? "",
      { relativeTo: actor, rollData: actor.getRollData() }
    );

    if (context.isNPC) {
      context.enrichedTactics = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
        actor.system.tactics ?? "",
        { relativeTo: actor }
      );
      context.enrichedRunningMonster = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
        actor.system.runningMonster ?? "",
        { relativeTo: actor }
      );
    }

    this._prepareStats(context);
    this._prepareItems(context);
    if (context.isCharacter) this._prepareSkills(context);

    return context;
  }

  /* -------------------------------------------- */

  /** @override */
  async _preparePartContext(partId, context) {
    context = await super._preparePartContext(partId, context);
    if (partId in (context.tabs ?? {})) context.tab = context.tabs[partId];
    return context;
  }

  /* -------------------------------------------- */

  /** Build display-friendly stat blocks. */
  _prepareStats(context) {
    context.mainStats = Object.entries(LYRIAN.mainStats).map(([key, label]) => ({
      key,
      label: game.i18n.localize(label),
      ...context.system.stats[key]
    }));

    context.subStatList = Object.entries(LYRIAN.subStats).map(([key, label]) => ({
      key,
      label: game.i18n.localize(label),
      ...context.system.subStats[key]
    }));
  }

  /* -------------------------------------------- */

  /** Group skills under their governing sub stat for display. */
  _prepareSkills(context) {
    const groups = {};
    for (const [key, def] of Object.entries(LYRIAN.skills)) {
      const stat = def.stat;
      groups[stat] ??= {
        key: stat,
        label: game.i18n.localize(LYRIAN.subStats[stat]),
        value: context.system.subStats[stat].total,
        skills: []
      };
      groups[stat].skills.push({
        key,
        label: game.i18n.localize(def.label),
        ...context.system.skills[key]
      });
    }
    context.skillGroups = Object.values(groups);

    context.artisanList = Object.entries(LYRIAN.artisanSkills).map(([key, label]) => ({
      key,
      label: game.i18n.localize(label),
      ...context.system.artisan[key]
    }));

    context.gatheringList = Object.entries(LYRIAN.gatheringSkills).map(([key, label]) => ({
      key,
      label: game.i18n.localize(label),
      ...context.system.gathering[key]
    }));

    context.skillCapLabel = Number.isFinite(context.system.skillCap)
      ? context.system.skillCap
      : "∞";
  }

  /* -------------------------------------------- */

  /** Sort owned items into sheet sections. */
  _prepareItems(context) {
    const buckets = {
      weapons: [],
      armor: [],
      abilities: [],
      reactions: [],
      encounterStart: [],
      encounterConclusion: [],
      passives: [],
      classes: [],
      breakthroughs: [],
      races: [],
      gear: [],
      equipment: [],
      injuries: []
    };

    for (const item of this.document.items) {
      switch (item.type) {
        case "weapon":
          buckets.weapons.push(item);
          break;
        case "armor":
          buckets.armor.push(item);
          break;
        case "ability":
        case "monsterAbility":
          if (item.system.timing === "passive") buckets.passives.push(item);
          else if (item.system.timing === "encounterStart") buckets.encounterStart.push(item);
          else if (item.system.timing === "encounterConclusion")
            buckets.encounterConclusion.push(item);
          else if (item.system.isReaction) buckets.reactions.push(item);
          else buckets.abilities.push(item);
          break;
        case "class":
          buckets.classes.push(item);
          break;
        case "breakthrough":
          buckets.breakthroughs.push(item);
          break;
        case "race":
          buckets.races.push(item);
          break;
        case "gear":
          buckets.gear.push(item);
          break;
        case "equipment":
          buckets.equipment.push(item);
          break;
        case "injury":
          buckets.injuries.push(item);
          break;
      }
    }

    context.items = buckets;

    const granted = this.document.items.filter(
      (item) => item.type === "ability" && item.getFlag("lyrian-chronicles", "featureSource")
    );
    const grantedIds = new Set(granted.map((item) => item.id));
    for (const key of ["abilities", "reactions", "encounterStart", "encounterConclusion", "passives"]) {
      buckets[key] = buckets[key].filter((item) => !grantedIds.has(item.id));
    }

    const featureView = (item) => ({
      item,
      role: item.getFlag("lyrian-chronicles", "featureSource")?.role ?? "Trait",
      requiredLevel: item.getFlag("lyrian-chronicles", "featureSource")?.requiredLevel ?? 0,
      usable: item.system.timing !== "passive"
    });
    context.racialTraits = granted.filter(
      (item) => item.getFlag("lyrian-chronicles", "featureSource")?.kind === "race"
    ).map(featureView);
    context.classGroups = buckets.classes.map((classItem) => ({
      item: classItem,
      level: classItem.system.abilitiesUnlocked,
      features: granted
        .filter((item) => item.getFlag("lyrian-chronicles", "featureSource")?.sourceItemId === classItem.id)
        .sort((a, b) => (a.system.classStep ?? 0) - (b.system.classStep ?? 0))
        .map(featureView)
    }));

    const primaryRace = buckets.races.find((item) => item.system.raceKind === "primary");
    const ancestry = buckets.races.find((item) => item.system.raceKind === "ancestry");
    const variant = primaryRace?.system.variants?.find(
      (choice) => choice.key === primaryRace.system.selectedVariant
    );
    context.raceSummary = primaryRace ? { primary: primaryRace, ancestry, variant } : null;

    // EXP actually committed to classes and breakthroughs, for cross-checking Spirit Core.
    context.expInClasses = buckets.classes.reduce((n, c) => n + c.system.expInvested, 0);
    context.expInBreakthroughs = buckets.breakthroughs.reduce(
      (n, b) => n + b.system.expCost,
      0
    );
  }

  /* -------------------------------------------- */

  /**
   * Expertise inputs are handled by hand.
   *
   * Foundry expands a form name like `system.skills.athletics.expertises.0.name`
   * into an object keyed "0", which an ArrayField rejects. So these inputs are
   * kept out of the form submission and written as a complete array instead.
   */
  _onRender(context, options) {
    super._onRender?.(context, options);

    this.element.querySelectorAll("[data-expertise-field]").forEach((input) => {
      input.addEventListener("change", async (event) => {
        const { group, skill } = event.target.dataset;
        const rows = this.element.querySelectorAll(
          `[data-expertise-row][data-group="${group}"][data-skill="${skill}"]`
        );

        const expertises = Array.from(rows).map((row) => ({
          name: row.querySelector("[data-expertise-name]")?.value ?? "",
          rank: Number(row.querySelector("[data-expertise-rank]")?.value ?? 0)
        }));

        await this.document.update({ [`system.${group}.${skill}.expertises`]: expertises });
      });
    });
  }

  /** Complete race-specific choices when a Race is dragged from a compendium. */
  async _onDropItem(event, item) {
    const result = await super._onDropItem(event, item);
    const owned = Array.isArray(result) ? result[0] : result;
    if (!owned || this.document.type !== "character" || owned.type !== "race") return result;

    if (owned.system.raceKind === "ancestry") {
      const primary = this.document.items.find(
        (entry) => entry.type === "race" && entry.system.raceKind === "primary"
      );
      if (!primary || primary.name !== owned.system.primaryRace) {
        await owned.delete();
        ui.notifications.warn(`${owned.name} requires the ${owned.system.primaryRace} primary race.`);
        return null;
      }
    }

    const older = this.document.items.filter(
      (entry) => entry.type === "race" && entry.id !== owned.id &&
        entry.system.raceKind === owned.system.raceKind
    );
    if (older.length) await this.document.deleteEmbeddedDocuments("Item", older.map((entry) => entry.id));

    if (owned.system.raceKind === "primary") {
      const automation = owned.system.attributeBonuses ?? {};
      const variants = owned.system.variants ?? [];
      if (automation.chooseMain || automation.chooseSub || variants.length) {
        const options = (table) => Object.entries(table)
          .map(([key, label]) => `<option value="${key}">${game.i18n.localize(label)}</option>`)
          .join("");
        const variantOptions = variants
          .map((choice) => `<option value="${choice.key}">${choice.name}</option>`)
          .join("");
        const choice = await foundry.applications.api.DialogV2.prompt({
          window: { title: `${owned.name} choices` },
          content: `<div class="lyrian">
            ${automation.chooseMain ? `<label>Main stat +${automation.chooseMain}<select name="main"><option value="">—</option>${options(LYRIAN.mainStats)}</select></label>` : ""}
            ${automation.chooseSub ? `<label>Sub stat +${automation.chooseSub}<select name="sub"><option value="">—</option>${options(LYRIAN.subStats)}</select></label>` : ""}
            ${variants.length ? `<label>Demon house<select name="variant"><option value="">—</option>${variantOptions}</select></label>` : ""}
          </div>`,
          ok: {
            callback: (dialogEvent, button) => ({
              main: button.form.elements.main?.value ?? "",
              sub: button.form.elements.sub?.value ?? "",
              variant: button.form.elements.variant?.value ?? ""
            })
          }
        }).catch(() => null);
        if (choice) {
          await owned.update({
            "system.selectedMainStat": choice.main,
            "system.selectedSubStat": choice.sub,
            "system.selectedVariant": choice.variant
          });
        }
      }
    }

    await this.document.syncProgressionFeatures();
    return result;
  }

  /* -------------------------------------------- */
  /*  Actions                                      */
  /* -------------------------------------------- */

  static async #onRollSkill(event, target) {
    const index = target.dataset.expertiseIndex;
    await this.document.rollSkill(target.dataset.skill, {
      expertiseIndex: index === undefined ? undefined : Number(index)
    });
  }

  static async #onRollArtisan(event, target) {
    const index = target.dataset.expertiseIndex;
    await this.document.rollArtisan(target.dataset.skill, {
      expertiseIndex: index === undefined ? undefined : Number(index)
    });
  }

  /** Append a blank expertise to a skill. */
  static async #onAddExpertise(event, target) {
    const { group, skill } = target.dataset;
    const path = `system.${group}.${skill}.expertises`;
    const current = foundry.utils.getProperty(this.document, path) ?? [];
    await this.document.update({
      [path]: [...current.map((e) => ({ name: e.name, rank: e.rank })), { name: "", rank: 0 }]
    });
  }

  static async #onRemoveExpertise(event, target) {
    const { group, skill, index } = target.dataset;
    const path = `system.${group}.${skill}.expertises`;
    const current = foundry.utils.getProperty(this.document, path) ?? [];
    const next = current
      .map((e) => ({ name: e.name, rank: e.rank }))
      .filter((_, i) => i !== Number(index));
    await this.document.update({ [path]: next });
  }

  static async #onRollGathering(event, target) {
    await this.document.rollGathering(target.dataset.skill);
  }

  static async #onRollSave() {
    await this.document.rollSave();
  }

  static async #onRollInitiative() {
    await this.document.rollInitiativeCheck();
  }

  static async #onRollInjury() {
    await this.document.rollInjury();
  }

  static async #onAttack(event, target) {
    const item = this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (!item) return;
    await item.rollAttack(target.dataset.attackType, { free: event.shiftKey });
  }

  static async #onMonsterAttack(event, target) {
    await this.document.rollMonsterAttack(target.dataset.attackType, { free: event.shiftKey });
  }

  /** Open a system compendium so its entries can be dragged onto the sheet. */
  static async #onBrowsePack(event, target) {
    const packName = target.dataset.pack;
    const allowed = new Set([
      "breakthroughs", "player-abilities", "races", "classes", "items", "monster-abilities"
    ]);
    if (!allowed.has(packName)) return;

    const pack = game.packs.get(`lyrian-chronicles.${packName}`);
    if (!pack) return ui.notifications.warn(`Compendium not found: ${packName}`);
    if (typeof pack.render === "function") return pack.render(true);
    return pack.application?.render(true);
  }

  static async #onAdjustClassLevel(event, target) {
    const item = this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (!item || item.type !== "class") return;
    const level = normalizeClassLevel(item.system.abilitiesUnlocked + Number(target.dataset.delta ?? 0));
    if (level === item.system.abilitiesUnlocked) return;
    await item.update({ "system.abilitiesUnlocked": level });
    await this.document.syncProgressionFeatures();
  }

  static async #onUseItem(event, target) {
    const item = this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (!item) return;
    if (item.type === "ability" || item.type === "monsterAbility") {
      await item.rollAbility({ free: event.shiftKey });
    }
    else await item.postToChat();
  }

  static async #onCreateItem(event, target) {
    const type = target.dataset.type;
    const name = game.i18n.format("LYRIAN.New", {
      type: game.i18n.localize(`TYPES.Item.${type}`)
    });
    await this.document.createEmbeddedDocuments("Item", [{ name, type }]);
  }

  static async #onEditItem(event, target) {
    const item = this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    item?.sheet.render(true);
  }

  static async #onDeleteItem(event, target) {
    const item = this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (!item) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("LYRIAN.Delete") },
      content: `<p>${game.i18n.format("LYRIAN.DeleteConfirm", { name: item.name })}</p>`
    });
    if (confirmed) await item.delete();
  }

  static async #onToggleEquip(event, target) {
    const item = this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (!item) return;
    await item.update({ "system.equipped": !item.system.equipped });
  }

  /**
   * Increment or decrement AP, RP, HP or mana from the sheet header.
   * There is no upper bound: overhealing, bonus AP and temporary mana all
   * legitimately push a resource above its normal maximum. The only floor is
   * negative max HP for hit points, since that is where Mortal Wound sits.
   */
  static async #onAdjustResource(event, target) {
    const path = target.dataset.resource;
    const delta = Number(target.dataset.delta ?? 0);
    if (!["hp", "mana", "ap", "rp"].includes(path) || !Number.isFinite(delta) || delta === 0) {
      return;
    }

    const pool = foundry.utils.getProperty(this.document, `system.${path}`);
    const max = Number(pool?.max ?? 0);
    const floor = path === "hp" ? -max : 0;
    const next = adjustResourcePool(pool, delta, { floor });

    await this.document.update({
      [`system.${path}.value`]: next.value,
      [`system.${path}.temp`]: next.temp
    });
  }

  /**
   * Roll d20 plus any displayed value: a main stat, a sub stat, or a
   * defence number the GM wants to contest directly.
   */
  static async #onRollAttribute(event, target) {
    const value = Number(target.dataset.value ?? 0);
    const label = target.dataset.label ?? "Check";
    await this.document.rollAttribute(label, value);
  }

  static async #onRefreshTurn() {
    await this.document.refreshTurn();
  }

  static async #onStartEncounter() {
    await this.document.startEncounter();
  }

  static async #onTakeRest() {
    await this.document.takeRest();
  }

  static async #onRecoverInjury(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    await this.document.recoverInjury(id);
  }

  static async #onSpendExp() {
    const available = this.document.system.exp.available;
    const amount = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("LYRIAN.Interlude.Train") },
      content: `<p>${game.i18n.format("LYRIAN.Interlude.ExpAvailable", { exp: available })}</p>
                <label>EXP to commit <input type="number" name="exp" value="100" min="0" max="${available}" /></label>
                <label>Reason <input type="text" name="reason" placeholder="Class ability, breakthrough, skill" /></label>`,
      ok: {
        callback: (event, button) => ({
          exp: Number(button.form.elements.exp.value),
          reason: button.form.elements.reason.value
        })
      }
    }).catch(() => null);

    if (!amount?.exp) return;
    await this.document.spendExp(amount.exp, amount.reason);
  }

  static async #onOpenCreation() {
    const { runCharacterCreation } = await import("../apps/character-creation.mjs");
    runCharacterCreation(this.document);
  }
}
