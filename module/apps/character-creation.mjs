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

      races: await this._packIndex("races"),
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
    const index = await pack.getIndex();
    return index.map((e) => ({ id: e._id, uuid: e.uuid, name: e.name, img: e.img }));
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

    html.querySelectorAll("input[name='raceId'], input[name='classId']").forEach((radio) => {
      radio.addEventListener("change", (event) => {
        const field = event.target.name === "raceId" ? "raceId" : "classId";
        this.state[field] = event.target.value;
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

    // Bring in the chosen race and class as owned items.
    const toCreate = [];
    for (const [packName, id] of [["races", s.raceId], ["classes", s.classId]]) {
      if (!id) continue;
      const pack = game.packs.get(`lyrian-chronicles.${packName}`);
      const doc = await pack?.getDocument(id);
      if (doc) toCreate.push(doc.toObject());
    }
    if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate);

    // A purchased class is committed EXP.
    const classItem = actor.items.find((i) => i.type === "class");
    if (classItem) {
      await actor.update({ "system.exp.spent": classItem.system.unlockCost });
    }

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
