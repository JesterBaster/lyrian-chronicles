import { LYRIAN } from "../config.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Guided character creation.
 *
 * Walks the four decisions the rulebook front-loads: assign the stat arrays,
 * pick a race, buy a starting class, and distribute skill points. Everything
 * it does is a normal document update, so a GM who prefers to build by hand
 * can ignore it entirely.
 */
export class LyrianCharacterCreation extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;

    const p = LYRIAN.progression;
    this.state = {
      step: "stats",
      mainAssign: {},        // stat key -> array value
      subAssign: {},
      raceId: null,
      ancestryId: null,
      raceMainChoice: "",
      raceSubChoice: "",
      raceVariant: "",
      classId: null,
      skillPoints: p.startingSkillPoints,
      skillSpend: {},        // skill key -> ranks bought
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
      finish: LyrianCharacterCreation.#onFinish,
      reset: LyrianCharacterCreation.#onReset
    }
  };

  static PARTS = {
    body: { template: "systems/lyrian-chronicles/templates/apps/character-creation.hbs" }
  };

  /* -------------------------------------------- */

  async _prepareContext() {
    const s = this.state;
    const usedMain = Object.values(s.mainAssign);
    const usedSub = Object.values(s.subAssign);
    const raceEntries = await this._packIndex("races");
    const races = raceEntries.filter((entry) => entry.system.raceKind === "primary");
    const selectedRace = races.find((entry) => entry.id === s.raceId) ?? null;
    const ancestries = selectedRace
      ? raceEntries.filter((entry) => entry.system.raceKind === "ancestry" &&
          entry.system.primaryRace === selectedRace.name)
      : [];

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

      statsComplete:
        Object.keys(s.mainAssign).length === 4 && Object.keys(s.subAssign).length === 5,

      races,
      ancestries,
      selectedRace,
      raceNeedsMainChoice: !!selectedRace?.system.attributeBonuses?.chooseMain,
      raceNeedsSubChoice: !!selectedRace?.system.attributeBonuses?.chooseSub,
      raceVariants: selectedRace?.system.variants ?? [],
      raceComplete: !!selectedRace &&
        (!selectedRace.system.attributeBonuses?.chooseMain || !!s.raceMainChoice) &&
        (!selectedRace.system.attributeBonuses?.chooseSub || !!s.raceSubChoice) &&
        (!ancestries.length || !!s.ancestryId) &&
        (!(selectedRace.system.variants?.length) || !!s.raceVariant),
      mainStatChoices: Object.entries(LYRIAN.mainStats).map(([key, label]) => ({ key, label: game.i18n.localize(label) })),
      subStatChoices: Object.entries(LYRIAN.subStats).map(([key, label]) => ({ key, label: game.i18n.localize(label) })),
      classes: await this._packIndex("classes"),

      skills: Object.entries(LYRIAN.skills).map(([key, def]) => ({
        key,
        label: game.i18n.localize(def.label),
        stat: game.i18n.localize(LYRIAN.subStats[def.stat]),
        ranks: s.skillSpend[key] ?? 0
      })),
      skillPointsLeft: s.skillPoints - Object.values(s.skillSpend).reduce((a, b) => a + b, 0),

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
      "system.attributeBonuses", "system.variants", "system.tier"
    ] });
    return index.map((e) => ({
      id: e._id, uuid: e.uuid, name: e.name, img: e.img, system: e.system ?? {}
    }));
  }

  /* -------------------------------------------- */

  /** Bind the inputs that fire `change` rather than `click`. */
  _onRender(context, options) {
    super._onRender?.(context, options);
    const html = this.element;

    html.querySelectorAll("[data-assign]").forEach((select) => {
      select.addEventListener("change", (event) => {
        const bucket = event.target.dataset.assign === "main" ? "mainAssign" : "subAssign";
        const key = event.target.dataset.stat;
        const value = Number(event.target.value);
        if (!event.target.value) delete this.state[bucket][key];
        else this.state[bucket][key] = value;
        this.render();
      });
    });

    html.querySelectorAll("input[name='raceId'], input[name='ancestryId'], input[name='classId']").forEach((radio) => {
      radio.addEventListener("change", (event) => {
        const field = event.target.name;
        this.state[field] = event.target.value;
        if (field === "raceId") {
          this.state.ancestryId = null;
          this.state.raceMainChoice = "";
          this.state.raceSubChoice = "";
          this.state.raceVariant = "";
        }
        this.render();
      });
    });

    html.querySelectorAll("[data-race-choice]").forEach((select) => {
      select.addEventListener("change", (event) => {
        this.state[event.target.dataset.raceChoice] = event.target.value;
        this.render();
      });
    });
  }

  /* -------------------------------------------- */
  /*  Actions                                      */
  /* -------------------------------------------- */

  static async #onGoStep(event, target) {
    this.state.step = target.dataset.step;
    this.render();
  }

  static async #onAdjustSkill(event, target) {
    const key = target.dataset.skill;
    const delta = Number(target.dataset.delta);
    const current = this.state.skillSpend[key] ?? 0;
    const spent = Object.values(this.state.skillSpend).reduce((a, b) => a + b, 0);

    if (delta > 0 && spent >= this.state.skillPoints) return;
    const next = Math.max(0, current + delta);

    if (next === 0) delete this.state.skillSpend[key];
    else this.state.skillSpend[key] = next;
    this.render();
  }

  static async #onReset() {
    this.state.mainAssign = {};
    this.state.subAssign = {};
    this.state.skillSpend = {};
    this.state.raceId = null;
    this.state.ancestryId = null;
    this.state.raceMainChoice = "";
    this.state.raceSubChoice = "";
    this.state.raceVariant = "";
    this.state.classId = null;
    this.render();
  }

  /**
   * Write everything to the actor in one update, then drag in the chosen
   * race and class documents.
   */
  static async #onFinish() {
    const s = this.state;
    const actor = this.actor;
    const p = LYRIAN.progression;

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
    update["system.clim"] = p.startingClim;

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

    // Bring in the chosen race and class as owned items.
    const toCreate = [];
    for (const [packName, id] of [["races", s.raceId], ["races", s.ancestryId], ["classes", s.classId]]) {
      if (!id) continue;
      const pack = game.packs.get(`lyrian-chronicles.${packName}`);
      const doc = await pack?.getDocument(id);
      if (doc) {
        const data = doc.toObject();
        delete data._id;
        if (doc.type === "race" && doc.system.raceKind === "primary") {
          data.system.selectedMainStat = s.raceMainChoice;
          data.system.selectedSubStat = s.raceSubChoice;
          data.system.selectedVariant = s.raceVariant;
        }
        if (doc.type === "class") {
          const alreadyOwned = actor.items.find(
            (item) => item.type === "class" && item.system.stableId === doc.system.stableId
          );
          if (alreadyOwned) continue;
          data.system.abilitiesUnlocked = 1;
        }
        toCreate.push(data);
      }
    }
    if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate);

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
