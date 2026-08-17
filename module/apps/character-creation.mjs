import { LYRIAN } from "../config.mjs";
import { raceSkillGrant } from "../rules/progression.mjs";
import { convertOfficialEquipment } from "../rules/equipment-import.mjs";
import {
  HYBRID_TYPES,
  hybridAncestryFamily,
  hybridRaceFlag,
  hybridRule,
  isHybridBreakthrough,
  prepareHybridAncestryData,
  prepareHybridPrimaryData,
  validateHybridSelection
} from "../rules/hybrid-race.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const EQUIPMENT_PACKS = Object.freeze(["weapons", "armor-shields", "consumables", "gear-kits"]);

function numberFrom(value) {
  const match = String(value ?? "").replaceAll(",", "").match(/\d+/);
  return match ? Number(match[0]) : 0;
}

/**
 * Guided character creation.
 *
 * Walks the rulebook character-creation decisions in order: race, stats and
 * skills, breakthroughs, class, equipment, then an inventory review. Everything
 * it does is a normal document update, so a GM who prefers to build by hand can
 * ignore it entirely.
 */
export class LyrianCharacterCreation extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;

    const p = LYRIAN.progression;
    this.creationState = {
      step: "race",
      mainAssign: {},        // stat key -> array value
      subAssign: {},
      raceMode: "standard",
      raceId: null,
      ancestryId: null,
      hybridType: "",
      hybridBreakthroughId: null,
      raceMainChoice: "",
      raceSubChoice: "",
      raceVariant: "",
      classId: null,
      breakthroughIds: [],
      equipmentIds: [],
      skillPoints: p.startingSkillPoints,
      skillSpend: {},        // skill key -> ranks bought
      raceSkillSpend: {},    // race compendium ID -> skill bonuses
      expBudget: p.startingClassExp,
      breakthroughBudget: p.startingBreakthroughExp
    };
  }

  static DEFAULT_OPTIONS = {
    id: "lyrian-character-creation",
    classes: ["lyrian", "lyr-creation"],
    position: { width: 640, height: 700 },
    window: { title: "LYRIAN.Creation.Title", resizable: true },
    actions: {
      goStep: LyrianCharacterCreation.#onGoStep,
      adjustSkill: LyrianCharacterCreation.#onAdjustSkill,
      adjustRaceSkill: LyrianCharacterCreation.#onAdjustRaceSkill,
      toggleBreakthrough: LyrianCharacterCreation.#onToggleBreakthrough,
      toggleEquipment: LyrianCharacterCreation.#onToggleEquipment,
      finish: LyrianCharacterCreation.#onFinish,
      reset: LyrianCharacterCreation.#onReset
    }
  };

  static PARTS = {
    body: { template: "systems/lyrian-chronicles/templates/apps/character-creation.hbs" }
  };

  /* -------------------------------------------- */

  async _prepareContext() {
    const s = this.creationState;
    const p = LYRIAN.progression;
    const usedMain = Object.values(s.mainAssign);
    const usedSub = Object.values(s.subAssign);
    const [raceEntries, breakthroughEntries, classes, ...equipmentGroups] = await Promise.all([
      this._packIndex("races"),
      this._packIndex("breakthroughs"),
      this._packIndex("classes"),
      ...EQUIPMENT_PACKS.map((pack) => this._packIndex(pack))
    ]);
    const races = raceEntries.filter((entry) => entry.system.raceKind === "primary");
    const selectedRace = races.find((entry) => entry.id === s.raceId) ?? null;
    const hybrid = hybridRule(s.hybridType);
    const ancestryPrimaryRace = s.raceMode === "hybrid"
      ? hybridAncestryFamily(s.hybridType, selectedRace?.name)
      : selectedRace?.name;
    const ancestries = selectedRace
      ? raceEntries.filter((entry) => entry.system.raceKind === "ancestry" &&
          entry.system.primaryRace === ancestryPrimaryRace)
      : [];
    const selectedAncestry = ancestries.find((entry) => entry.id === s.ancestryId) ?? null;
    const selectedHybridBreakthrough = breakthroughEntries.find(
      (entry) => entry.system.stableId === hybrid?.breakthroughStableId
    ) ?? null;
    const hybridChoices = Object.values(HYBRID_TYPES).map((rule) => {
      const breakthrough = breakthroughEntries.find(
        (entry) => entry.system.stableId === rule.breakthroughStableId
      );
      const fixedPrimary = rule.primaryRaces.length === 1
        ? races.find((race) => race.name === rule.primaryRaces[0])
        : null;
      return {
        ...rule,
        breakthroughId: breakthrough?.id ?? null,
        description: breakthrough?.system.description ?? "",
        fixedPrimaryId: fixedPrimary?.id ?? null
      };
    });
    const hybridPrimaryOptions = s.hybridType === "faerieChimera"
      ? races.filter((race) => HYBRID_TYPES.faerieChimera.primaryRaces.includes(race.name))
      : [];
    const hybridValidation = s.raceMode === "hybrid" ? validateHybridSelection({
      type: s.hybridType,
      primaryRace: selectedRace?.name,
      ancestryPrimaryRace: selectedAncestry?.system.primaryRace,
      budget: s.breakthroughBudget
    }) : null;
    const raceSkillPools = [selectedRace, selectedAncestry].filter(Boolean).map((race) => {
      const grant = Number(race.system.skillGrant?.points)
        ? race.system.skillGrant
        : raceSkillGrant(race.system.grantedSkills);
      const spent = Object.values(s.raceSkillSpend[race.id] ?? {}).reduce((a, b) => a + b, 0);
      return {
        race,
        points: grant.points,
        remaining: Math.max(0, grant.points - spent),
        skills: (grant.allowedSkills ?? []).map((key) => ({
          key,
          label: game.i18n.localize(LYRIAN.skills[key]?.label ?? key),
          ranks: s.raceSkillSpend[race.id]?.[key] ?? 0
        }))
      };
    }).filter((pool) => pool.points && pool.skills.length);

    const hybridStableIds = new Set(Object.values(HYBRID_TYPES).map((rule) => rule.breakthroughStableId));
    const hybridExpSpent = s.raceMode === "hybrid" ? Number(hybrid?.cost ?? 0) : 0;
    const breakthroughs = breakthroughEntries
      .filter((entry) => !hybridStableIds.has(entry.system.stableId))
      .map((entry) => ({
        ...entry,
        cost: Number(entry.system.expCost) || 0,
        selected: s.breakthroughIds.includes(entry.id)
      }));
    const selectedBreakthroughs = breakthroughs.filter((entry) => entry.selected);
    const breakthroughExpSpent = hybridExpSpent +
      selectedBreakthroughs.reduce((total, entry) => total + entry.cost, 0);
    const breakthroughExpLeft = s.breakthroughBudget - breakthroughExpSpent;

    const equipment = equipmentGroups.flatMap((entries, index) => entries.map((entry) => {
      const key = `${EQUIPMENT_PACKS[index]}:${entry.id}`;
      return {
        ...entry,
        key,
        packName: EQUIPMENT_PACKS[index],
        cost: numberFrom(entry.system.cost),
        burden: numberFrom(entry.system.burden),
        selected: s.equipmentIds.includes(key)
      };
    })).sort((a, b) => a.name.localeCompare(b.name));
    const selectedEquipment = equipment.filter((entry) => entry.selected);
    const equipmentSpent = selectedEquipment.reduce((total, entry) => total + entry.cost, 0);
    const equipmentClimLeft = p.startingClim - equipmentSpent;
    const skillPointsLeft = s.skillPoints -
      Object.values(s.skillSpend).reduce((a, b) => a + b, 0);
    const skillsComplete = skillPointsLeft === 0 &&
      raceSkillPools.every((pool) => pool.remaining === 0);
    const selectedClass = classes.find((entry) => entry.id === s.classId) ?? null;
    const classCost = selectedClass
      ? (Number(selectedClass.system.expCost) || Number(selectedClass.system.tier) * p.classCostPerTier)
      : 0;
    const statsComplete =
      Object.keys(s.mainAssign).length === 4 && Object.keys(s.subAssign).length === 5;
    const raceComplete = !!selectedRace &&
      (!selectedRace.system.attributeBonuses?.chooseMain || !!s.raceMainChoice) &&
      (!selectedRace.system.attributeBonuses?.chooseSub || !!s.raceSubChoice) &&
      (!ancestries.length || !!s.ancestryId) &&
      (!(selectedRace.system.variants?.length) || !!s.raceVariant) &&
      (s.raceMode !== "hybrid" || (hybridValidation?.valid && !!selectedHybridBreakthrough));
    const creationReady = statsComplete && raceComplete && skillsComplete && !!selectedClass &&
      classCost <= s.expBudget && breakthroughExpLeft >= 0 && equipmentClimLeft >= 0;

    return {
      actor: this.actor,
      state: s,
      config: LYRIAN,

      mainStats: Object.entries(LYRIAN.mainStats).map(([key, label]) => ({
        key,
        label: game.i18n.localize(label),
        assigned: s.mainAssign[key] ?? null,
        // Each array value is used once, so offer only what is still free.
        options: LYRIAN.mainStatArray.filter(
          (v, i) => !usedMain.includes(v) || s.mainAssign[key] === v ||
            LYRIAN.mainStatArray.filter((x) => x === v).length >
            usedMain.filter((x) => x === v).length
        )
      })),

      subStats: Object.entries(LYRIAN.subStats).map(([key, label]) => ({
        key,
        label: game.i18n.localize(label),
        assigned: s.subAssign[key] ?? null,
        options: LYRIAN.subStatArray.filter((v) => !usedSub.includes(v) || s.subAssign[key] === v)
      })),

      statsComplete,

      races,
      ancestries,
      selectedRace,
      selectedAncestry,
      hybridMode: s.raceMode === "hybrid",
      hybridChoices,
      hybridPrimaryOptions,
      selectedHybridBreakthrough,
      hybridCost: hybrid?.cost ?? 200,
      hybridBudgetRemaining: hybrid ? s.breakthroughBudget - hybrid.cost : s.breakthroughBudget,
      showRaceAmbition: Boolean(selectedRace?.system.ambition) &&
        !(s.raceMode === "hybrid" && s.hybridType === "humanChimera"),
      raceNeedsMainChoice: !!selectedRace?.system.attributeBonuses?.chooseMain,
      raceNeedsSubChoice: !!selectedRace?.system.attributeBonuses?.chooseSub,
      raceVariants: selectedRace?.system.variants ?? [],
      raceComplete,
      mainStatChoices: Object.entries(LYRIAN.mainStats).map(([key, label]) => ({ key, label: game.i18n.localize(label) })),
      subStatChoices: Object.entries(LYRIAN.subStats).map(([key, label]) => ({ key, label: game.i18n.localize(label) })),
      classes,
      selectedClass,
      classCost,
      creationReady,
      breakthroughs,
      selectedBreakthroughs,
      breakthroughExpSpent,
      breakthroughExpLeft,
      equipment,
      selectedEquipment,
      equipmentSpent,
      equipmentClimLeft,

      skills: Object.entries(LYRIAN.skills).map(([key, def]) => ({
        key,
        label: game.i18n.localize(def.label),
        stat: game.i18n.localize(LYRIAN.subStats[def.stat]),
        ranks: s.skillSpend[key] ?? 0
      })),
      skillPointsLeft,
      skillsComplete,
      raceSkillPools,

      mainArray: LYRIAN.mainStatArray.join(", "),
      subArray: LYRIAN.subStatArray.join(", "),
      isStep: (id) => s.step === id
    };
  }

  /* -------------------------------------------- */

  /** Read a compendium's index; returns [] when the pack has no content yet. */
  async _packIndex(packName) {
    const pack = game.packs.get(`lyrian-chronicles.${packName}`);
    if (!pack) return [];
    const index = await pack.getIndex({ fields: [
      "system.raceKind", "system.primaryRace", "system.attributes", "system.ambition",
      "system.attributeBonuses", "system.variants", "system.tier",
      "system.grantedSkills", "system.skillGrant", "system.description",
      "system.stableId", "system.expCost", "system.requirements", "system.relationships",
      "system.cost", "system.burden", "system.category", "system.subType", "system.quantity"
    ] });
    return index.map((e) => ({
      id: e._id, uuid: e.uuid, name: e.name, img: e.img, system: e.system ?? {}
    }));
  }

  /* -------------------------------------------- */

  /** Bind the inputs that fire `change` rather than `click`. */
  async _onRender(context, options) {
    await super._onRender?.(context, options);
    const html = this.element;

    html.querySelectorAll("[data-assign]").forEach((select) => {
      select.addEventListener("change", (event) => {
        const bucket = event.target.dataset.assign === "main" ? "mainAssign" : "subAssign";
        const key = event.target.dataset.stat;
        const value = Number(event.target.value);
        if (!event.target.value) delete this.creationState[bucket][key];
        else this.creationState[bucket][key] = value;
        this.render();
      });
    });

    html.querySelectorAll("input[name='raceId'], input[name='ancestryId'], input[name='classId']").forEach((radio) => {
      radio.addEventListener("change", (event) => {
        const field = event.target.name;
        this.creationState[field] = event.target.value;
        if (field === "raceId") {
          this.creationState.raceMode = "standard";
          this.creationState.hybridType = "";
          this.creationState.hybridBreakthroughId = null;
          this.creationState.ancestryId = null;
          this.creationState.raceMainChoice = "";
          this.creationState.raceSubChoice = "";
          this.creationState.raceVariant = "";
          this.creationState.raceSkillSpend = {};
        } else if (field === "ancestryId") {
          for (const id of Object.keys(this.creationState.raceSkillSpend)) {
            if (id !== this.creationState.raceId) delete this.creationState.raceSkillSpend[id];
          }
        }
        this.render();
      });
    });

    html.querySelectorAll("input[name='raceMode']").forEach((radio) => {
      radio.addEventListener("change", () => {
        this.creationState.raceMode = "hybrid";
        this.creationState.raceId = null;
        this.creationState.ancestryId = null;
        this.creationState.hybridType = "";
        this.creationState.hybridBreakthroughId = null;
        this.creationState.raceMainChoice = "";
        this.creationState.raceSubChoice = "";
        this.creationState.raceVariant = "";
        this.creationState.raceSkillSpend = {};
        this.render();
      });
    });

    html.querySelectorAll("input[name='hybridType']").forEach((radio) => {
      radio.addEventListener("change", (event) => {
        this.creationState.raceMode = "hybrid";
        this.creationState.hybridType = event.target.value;
        this.creationState.hybridBreakthroughId = event.target.dataset.breakthroughId || null;
        this.creationState.raceId = event.target.dataset.fixedPrimaryId || null;
        this.creationState.ancestryId = null;
        this.creationState.raceMainChoice = "";
        this.creationState.raceSubChoice = "";
        this.creationState.raceVariant = "";
        this.creationState.raceSkillSpend = {};
        this.render();
      });
    });

    html.querySelectorAll("input[name='hybridPrimaryRaceId']").forEach((radio) => {
      radio.addEventListener("change", (event) => {
        this.creationState.raceId = event.target.value;
        this.creationState.ancestryId = null;
        this.creationState.raceMainChoice = "";
        this.creationState.raceSubChoice = "";
        this.creationState.raceSkillSpend = {};
        this.render();
      });
    });

    html.querySelectorAll("[data-race-choice]").forEach((select) => {
      select.addEventListener("change", (event) => {
        this.creationState[event.target.dataset.raceChoice] = event.target.value;
        this.render();
      });
    });
  }

  /* -------------------------------------------- */
  /*  Actions                                      */
  /* -------------------------------------------- */

  static async #onGoStep(event, target) {
    this.creationState.step = target.dataset.step;
    this.render();
  }

  static async #onAdjustSkill(event, target) {
    const key = target.dataset.skill;
    const delta = Number(target.dataset.delta);
    const current = this.creationState.skillSpend[key] ?? 0;
    const spent = Object.values(this.creationState.skillSpend).reduce((a, b) => a + b, 0);

    if (delta > 0 && spent >= this.creationState.skillPoints) return;
    const next = Math.max(0, current + delta);

    if (next === 0) delete this.creationState.skillSpend[key];
    else this.creationState.skillSpend[key] = next;
    this.render();
  }

  static async #onToggleBreakthrough(event, target) {
    const id = target.dataset.id;
    const cost = Number(target.dataset.cost) || 0;
    const selected = this.creationState.breakthroughIds;
    if (selected.includes(id)) {
      this.creationState.breakthroughIds = selected.filter((entryId) => entryId !== id);
    } else {
      const context = await this._prepareContext();
      if (context.breakthroughExpLeft < cost) {
        return ui.notifications.warn(game.i18n.localize("LYRIAN.Creation.BreakthroughBudgetExceeded"));
      }
      this.creationState.breakthroughIds = [...selected, id];
    }
    this.render();
  }

  static async #onToggleEquipment(event, target) {
    const key = target.dataset.key;
    const cost = Number(target.dataset.cost) || 0;
    const selected = this.creationState.equipmentIds;
    if (selected.includes(key)) {
      this.creationState.equipmentIds = selected.filter((entryKey) => entryKey !== key);
    } else {
      const context = await this._prepareContext();
      if (context.equipmentClimLeft < cost) {
        return ui.notifications.warn(game.i18n.localize("LYRIAN.Creation.EquipmentBudgetExceeded"));
      }
      this.creationState.equipmentIds = [...selected, key];
    }
    this.render();
  }

  static async #onAdjustRaceSkill(event, target) {
    const raceId = target.dataset.raceId;
    const key = target.dataset.skill;
    const delta = Number(target.dataset.delta);
    const maximum = Number(target.dataset.maximum) || 0;
    const allocation = this.creationState.raceSkillSpend[raceId] ??= {};
    const spent = Object.values(allocation).reduce((a, b) => a + b, 0);
    if (delta > 0 && spent >= maximum) return;
    const next = Math.max(0, (allocation[key] ?? 0) + delta);
    if (next) allocation[key] = next;
    else delete allocation[key];
    this.render();
  }

  static async #onReset() {
    this.creationState.mainAssign = {};
    this.creationState.subAssign = {};
    this.creationState.skillSpend = {};
    this.creationState.raceSkillSpend = {};
    this.creationState.raceMode = "standard";
    this.creationState.raceId = null;
    this.creationState.ancestryId = null;
    this.creationState.hybridType = "";
    this.creationState.hybridBreakthroughId = null;
    this.creationState.raceMainChoice = "";
    this.creationState.raceSubChoice = "";
    this.creationState.raceVariant = "";
    this.creationState.classId = null;
    this.creationState.breakthroughIds = [];
    this.creationState.equipmentIds = [];
    this.creationState.step = "race";
    this.render();
  }

  /**
   * Write everything to the actor in one update, then drag in the chosen
   * race and class documents.
   */
  static async #onFinish() {
    const s = this.creationState;
    const actor = this.actor;
    const p = LYRIAN.progression;
    const context = await this._prepareContext();
    if (!context.creationReady) {
      return ui.notifications.warn(game.i18n.localize("LYRIAN.Creation.Incomplete"));
    }

    const racePack = game.packs.get("lyrian-chronicles.races");
    const classPack = game.packs.get("lyrian-chronicles.classes");
    const breakthroughPack = game.packs.get("lyrian-chronicles.breakthroughs");
    const [primaryDoc, ancestryDoc, classDoc, hybridBreakthroughDoc, breakthroughDocs, equipmentDocs] = await Promise.all([
      s.raceId ? racePack?.getDocument(s.raceId) : null,
      s.ancestryId ? racePack?.getDocument(s.ancestryId) : null,
      s.classId ? classPack?.getDocument(s.classId) : null,
      s.raceMode === "hybrid" && s.hybridBreakthroughId
        ? breakthroughPack?.getDocument(s.hybridBreakthroughId)
        : null,
      Promise.all(s.breakthroughIds.map((id) => breakthroughPack?.getDocument(id))),
      Promise.all(s.equipmentIds.map((key) => {
        const separator = key.indexOf(":");
        const packName = key.slice(0, separator);
        const id = key.slice(separator + 1);
        return game.packs.get(`lyrian-chronicles.${packName}`)?.getDocument(id);
      }))
    ]);
    if (!primaryDoc || !classDoc || (s.ancestryId && !ancestryDoc) ||
        breakthroughDocs.some((doc) => !doc) || equipmentDocs.some((doc) => !doc)) {
      return ui.notifications.warn(game.i18n.localize("LYRIAN.Creation.SourceMissing"));
    }

    const hybrid = hybridRule(s.hybridType);
    if (s.raceMode === "hybrid") {
      const validation = validateHybridSelection({
        type: s.hybridType,
        primaryRace: primaryDoc.name,
        ancestryPrimaryRace: ancestryDoc?.system.primaryRace,
        budget: s.breakthroughBudget
      });
      if (!validation.valid || hybridBreakthroughDoc?.system.stableId !== hybrid?.breakthroughStableId) {
        return ui.notifications.warn(game.i18n.localize(`LYRIAN.Hybrid.Invalid.${validation.reason || "type"}`));
      }
    }

    let faerieFlashLink = null;
    if (s.raceMode === "hybrid" && s.hybridType === "faerieChimera" &&
        primaryDoc.name === "Chimera" && ancestryDoc?.name === "High Fae") {
      const index = await racePack.getIndex({ fields: ["system.stableId"] });
      const faeEntry = index.find((entry) => entry.system?.stableId === "primary-race--fae");
      const fae = faeEntry ? await racePack.getDocument(faeEntry._id) : null;
      faerieFlashLink = fae?.system.relationships?._links?.find(
        (link) => link.stableId === "ability--faerie-flash"
      ) ?? null;
      if (!faerieFlashLink) {
        return ui.notifications.warn(game.i18n.localize("LYRIAN.Hybrid.FaerieFlashMissing"));
      }
    }

    const toCreate = [];
    const primaryData = s.raceMode === "hybrid"
      ? prepareHybridPrimaryData(primaryDoc.toObject(), s.hybridType)
      : primaryDoc.toObject();
    delete primaryData._id;
    primaryData.system.selectedMainStat = s.raceMainChoice;
    primaryData.system.selectedSubStat = s.raceSubChoice;
    primaryData.system.selectedVariant = s.raceVariant;
    primaryData.system.selectedSkillBonuses = { ...(s.raceSkillSpend[s.raceId] ?? {}) };

    if (s.raceMode === "hybrid") {
      const flag = hybridRaceFlag(s.hybridType, primaryDoc.name, ancestryDoc.name);
      primaryData.flags ??= {};
      primaryData.flags["lyrian-chronicles"] ??= {};
      primaryData.flags["lyrian-chronicles"].hybridRace = flag;
    }
    toCreate.push(primaryData);

    if (ancestryDoc) {
      const ancestryData = s.raceMode === "hybrid"
        ? prepareHybridAncestryData(ancestryDoc.toObject(), {
          type: s.hybridType,
          primaryRace: primaryDoc.name,
          faerieFlashLink
        })
        : ancestryDoc.toObject();
      delete ancestryData._id;
      ancestryData.system.selectedSkillBonuses = { ...(s.raceSkillSpend[s.ancestryId] ?? {}) };
      toCreate.push(ancestryData);
    }

    const alreadyOwnedClass = actor.items.find(
      (item) => item.type === "class" && item.system.stableId === classDoc.system.stableId
    );
    if (!alreadyOwnedClass) {
      const classData = classDoc.toObject();
      delete classData._id;
      classData.system.abilitiesUnlocked = 1;
      toCreate.push(classData);
    }

    for (const doc of breakthroughDocs) {
      const alreadyOwned = actor.items.find(
        (item) => item.type === "breakthrough" && item.system.stableId === doc.system.stableId
      );
      if (alreadyOwned) continue;
      const breakthroughData = doc.toObject();
      delete breakthroughData._id;
      toCreate.push(breakthroughData);
    }

    if (hybridBreakthroughDoc) {
      const breakthroughData = hybridBreakthroughDoc.toObject();
      delete breakthroughData._id;
      breakthroughData.flags ??= {};
      breakthroughData.flags["lyrian-chronicles"] ??= {};
      breakthroughData.flags["lyrian-chronicles"].hybridRace = hybridRaceFlag(
        s.hybridType, primaryDoc.name, ancestryDoc.name
      );
      toCreate.push(breakthroughData);
    }

    for (const doc of equipmentDocs) {
      const equipmentData = convertOfficialEquipment(doc.toObject());
      if (equipmentData) toCreate.push(equipmentData);
    }

    const update = {};
    for (const [key, value] of Object.entries(s.mainAssign)) {
      update[`system.stats.${key}.value`] = value;
    }
    for (const [key, value] of Object.entries(s.subAssign)) {
      update[`system.subStats.${key}.value`] = value;
    }
    for (const [key, ranks] of Object.entries(s.skillSpend)) {
      update[`system.skills.${key}.rank`] = ranks;
    }

    // Starting budgets. Spirit core is EXP spent, so a fresh character with a
    // class purchased already has a small core.
    update["system.exp.total"] = p.startingClassExp + p.startingBreakthroughExp;
    update["system.interlude.points"] = p.startingInterludePoints;
    const equipmentSpent = equipmentDocs.reduce(
      (total, doc) => total + numberFrom(doc.system.cost), 0
    );
    update["system.clim"] = Math.max(0, p.startingClim - equipmentSpent);

    // Refill pools to the new maxima.
    const tough = s.mainAssign.toughness ?? 3;
    const power = s.mainAssign.power ?? 3;
    update["system.hp.value"] = 20 + tough * 10;
    update["system.mana.value"] = 6 + power;

    await actor.update(update);

    // Replace the race selection cleanly when the wizard is reopened. Generated
    // traits are removed by the synchronization pass below.
    const existingRaces = actor.items.filter((item) => item.type === "race");
    if (existingRaces.length) {
      await actor.deleteEmbeddedDocuments("Item", existingRaces.map((item) => item.id));
    }

    const existingHybridBreakthroughs = actor.items.filter(
      (item) => item.type === "breakthrough" && isHybridBreakthrough(item)
    );
    if (existingHybridBreakthroughs.length) {
      await actor.deleteEmbeddedDocuments("Item", existingHybridBreakthroughs.map((item) => item.id));
    }
    if (toCreate.length) {
      await actor.createEmbeddedDocuments("Item", toCreate, { lyrianCharacterCreation: true });
    }

    await actor.syncProgressionFeatures();

    // A purchased class is committed EXP.
    const classExp = actor.items
      .filter((item) => item.type === "class")
      .reduce((total, item) => total + item.system.expInvested, 0);
    const breakthroughExp = actor.items
      .filter((item) => item.type === "breakthrough")
      .reduce((total, item) => total + item.system.expCost, 0);
    await actor.update({ "system.exp.spent": classExp + breakthroughExp });

    // Race bonuses may change HP and mana maxima; start the new character full.
    await actor.update({
      "system.hp.value": actor.system.hp.max,
      "system.mana.value": actor.system.mana.max
    });

    ui.notifications.info(
      game.i18n.format("LYRIAN.Creation.Done", { name: actor.name })
    );
    this.close();
    actor.sheet.render(true);
  }
}

/* -------------------------------------------- */

/** Open the wizard for an actor. */
export function runCharacterCreation(actor) {
  if (!actor || actor.type !== "character") {
    return ui.notifications.warn(game.i18n.localize("LYRIAN.Creation.CharactersOnly"));
  }
  return new LyrianCharacterCreation(actor).render(true);
}
