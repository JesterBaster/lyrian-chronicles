import { LYRIAN } from "../config.mjs";

/**
 * The Actor document for Lyrian Chronicles.
 * Rolls live here so macros can call them: actor.rollSkill("stealth")
 */
export class LyrianActor extends Actor {
  /** @override */
  prepareData() {
    super.prepareData();
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
    if (!skill) return ui.notifications.warn(`Unknown skill: ${skillKey}`);

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
    if (!skill) return ui.notifications.warn(`Unknown artisan skill: ${skillKey}`);

    const { bonus, suffix } = this._resolveExpertise(skill, options);
    return this._rollCheck({
      formula: `1d10 + ${bonus}`,
      flavour: `${game.i18n.localize(LYRIAN.artisanSkills[skillKey])}${suffix} — Crafting Check`
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
    if (!skill) return ui.notifications.warn(`Unknown gathering skill: ${skillKey}`);
    return this._rollCheck({
      formula: `1d10 + ${skill.total + (options.bonus ?? 0)}`,
      flavour: `${game.i18n.localize(LYRIAN.gatheringSkills[skillKey])} — Gathering Check`
    });
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
    if (!stat) return ui.notifications.warn(`Unknown stat: ${statKey}`);
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

  /* -------------------------------------------- */

  async _rollCheck({ formula, flavour, dc }) {
    const roll = await new Roll(formula, this.getRollData()).evaluate();
    let flavorText = flavour;

    if (Number.isNumeric(dc)) {
      const success = roll.total >= dc;
      const tag = success
        ? game.i18n.localize("LYRIAN.Roll.Success")
        : game.i18n.localize("LYRIAN.Roll.Failure");
      flavorText += ` — DC ${dc}: <strong>${tag}</strong>`;
    }

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: flavorText
    });
    return roll;
  }

  /* -------------------------------------------- */
  /*  Resources                                    */
  /* -------------------------------------------- */

  /**
   * Attempt to pay AP, RP and mana. Returns false and warns if you cannot.
   */
  async spendResources({ ap = 0, rp = 0, mana = 0 } = {}) {
    const s = this.system;
    const shortfalls = [];
    if (ap > s.ap.total) shortfalls.push(`${ap} AP`);
    if (rp > s.rp.total) shortfalls.push(`${rp} RP`);
    if (mana > s.mana.total) shortfalls.push(`${mana} Mana`);

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
    for (const [key, cost] of [["ap", ap], ["rp", rp], ["mana", mana]]) {
      if (!cost) continue;
      // Temporary points are spent first — they expire, so burning them last wastes them.
      const pool = s[key];
      const fromTemp = Math.min(pool.temp ?? 0, cost);
      update[`system.${key}.temp`] = (pool.temp ?? 0) - fromTemp;
      update[`system.${key}.value`] = pool.value - (cost - fromTemp);
    }

    await this.update(update);
    return true;
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
    const locked = this.items.filter((i) => i.type === "ability" && i.system.usedThisRound);
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
      "system.rp.value": this.system.rp.max
    };
    if (this.type === "character") {
      update["system.encounter.secretArtUsed"] = false;
      update["system.encounter.encounterStartUsed"] = false;
      update["system.encounter.conclusionUsed"] = false;
      update["system.encounter.downedThisEncounter"] = 0;
    }
    await this.update(update);
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
   * @param {number}  [options.pinpoint]     Ignore this many points of Guard.
   */
  async applyDamage(amount, options = {}) {
    const { defence = "none", trueDamage = false, fullPierce = false, pinpoint = 0 } = options;
    const s = this.system;

    let final = amount;
    let guardUsed = 0;

    if (!trueDamage) {
      if (!fullPierce) {
        const baseGuard = defence === "block" ? s.blockGuard : s.guard;
        guardUsed = Math.max(0, baseGuard - pinpoint);
        final = amount - guardUsed;
      }

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
    const newHp = Math.min(this.system.hp.max, this.system.hp.value + amount);
    await this.update({ "system.hp.value": newHp });
    if (newHp > 0) await this.toggleStatusEffect("downed", { active: false });
    Hooks.callAll("lyrianHealing", this, amount);
    return newHp;
  }

  /* -------------------------------------------- */

  /** Flag Downed at 0 HP and Mortal Wound at negative max HP. */
  async _checkDowned(hp) {
    const max = this.system.hp.max;

    if (hp <= -max) {
      await this.toggleStatusEffect("downed", { active: true });
      await this.toggleStatusEffect("mortalWound", { active: true });
      ChatMessage.create({
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
      ChatMessage.create({
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
    const available = this.system.interlude.points;
    if (points > available) {
      ui.notifications.warn(
        game.i18n.format("LYRIAN.Warn.NotEnoughInterlude", { name: this.name, points })
      );
      return false;
    }
    await this.update({ "system.interlude.points": available - points });
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p>${game.i18n.format("LYRIAN.Msg.InterludeSpent", {
        name: this.name, points, reason: reason || "an interlude action"
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
      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this }),
        content: `<p class="lyrian-banner">${game.i18n.format("LYRIAN.Msg.TierReached", {
          name: this.name, tier: game.i18n.localize(crossed.label)
        })}</p>`
      });
    }

    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p>${game.i18n.format("LYRIAN.Msg.ExpSpent", {
        name: this.name, exp, reason: reason || "training", core: after
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
    ChatMessage.create({
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

    ChatMessage.create({
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
