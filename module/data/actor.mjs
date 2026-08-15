import { LYRIAN } from "../config.mjs";
import {
  raceAmbitionExp,
  selectedRaceBonuses,
  selectedRaceSkillBonuses
} from "../rules/progression.mjs";

const fields = foundry.data.fields;

/**
 * Shorthand for a non-negative integer field.
 */
function int(initial = 0, extra = {}) {
  return new fields.NumberField({ required: true, integer: true, initial, ...extra });
}

/**
 * A skill can carry several expertises — "Athletics (Climbing)" and
 * "Athletics (Swimming)" are separate purchases that apply to different rolls,
 * so each needs its own name and rank.
 */
function expertiseList() {
  return new fields.ArrayField(
    new fields.SchemaField({
      name: new fields.StringField({ required: true, blank: true, initial: "" }),
      rank: int(0, { min: 0 })
    }),
    { required: false, initial: [] }
  );
}

/* -------------------------------------------- */

/**
 * Shared schema and derivation for every actor in Lyr.
 */
export class LyrianActorBase extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const schema = {};

    schema.hp = new fields.SchemaField({
      value: int(30),
      max: int(30),
      temp: int(0),
      maxBonus: int(0)
    });

    schema.mana = new fields.SchemaField({
      value: int(6),
      max: int(6),
      temp: int(0),
      maxBonus: int(0)
    });

    schema.ap = new fields.SchemaField({
      value: int(4),
      max: int(4),
      temp: int(0),
      bonus: int(0)
    });

    schema.rp = new fields.SchemaField({
      value: int(2),
      max: int(2),
      temp: int(0),
      bonus: int(0)
    });

    // Main stats.
    schema.stats = new fields.SchemaField(
      Object.keys(LYRIAN.mainStats).reduce((obj, key) => {
        obj[key] = new fields.SchemaField({
          value: int(3, { min: 0 }),
          bonus: int(0)
        });
        return obj;
      }, {})
    );

    // Sub stats.
    schema.subStats = new fields.SchemaField(
      Object.keys(LYRIAN.subStats).reduce((obj, key) => {
        obj[key] = new fields.SchemaField({
          value: int(1, { min: 0 }),
          bonus: int(0)
        });
        return obj;
      }, {})
    );

    schema.defences = new fields.SchemaField({
      guardBonus: int(0),
      evasionBonus: int(0),
      blockBonus: int(0),
      potencyBonus: int(0),
      saveBonus: int(0),
      accuracyBonus: int(0)
    });

    schema.movement = new fields.SchemaField({
      speed: int(LYRIAN.baseSpeed),
      bonus: int(0),
      fly: int(0),
      swim: int(0)
    });

    schema.initiative = new fields.SchemaField({
      bonus: int(0)
    });

    schema.size = new fields.StringField({
      required: true,
      initial: "medium",
      choices: Object.keys(LYRIAN.creatureSizes)
    });

    schema.biography = new fields.HTMLField({ required: false, blank: true });

    return schema;
  }

  /* -------------------------------------------- */

  /**
   * Derive everything the rulebook calculates from stats and equipment.
   * Runs after Active Effects have been applied.
   */
  prepareDerivedData() {
    const stats = this.stats;
    const subStats = this.subStats;

    // Primary-race attributes are derived from the owned compendium Race item.
    // Keeping them derived prevents re-applying bonuses when a sheet reloads.
    const races = this.parent?.items?.filter((item) => item.type === "race") ?? [];
    for (const race of races) {
      const bonuses = selectedRaceBonuses(race.system);
      for (const [key, value] of Object.entries(bonuses.main)) {
        if (stats[key]) stats[key].bonus += Number(value) || 0;
      }
      for (const [key, value] of Object.entries(bonuses.sub)) {
        if (subStats[key]) subStats[key].bonus += Number(value) || 0;
      }
    }

    for (const stat of Object.values(stats)) stat.total = stat.value + stat.bonus;
    for (const stat of Object.values(subStats)) stat.total = stat.value + stat.bonus;

    const power = stats.power.total;
    const focus = stats.focus.total;
    const agility = stats.agility.total;
    const toughness = stats.toughness.total;

    // Equipment contributions.
    const gear = this._prepareEquipment();

    // Resources.
    this.hp.max = 20 + toughness * 10 + (this.hp.maxBonus ?? 0);
    this.mana.max = 6 + power + (this.mana.maxBonus ?? 0);

    // Current values are deliberately NOT capped at max. Overhealing, temporary
    // boosts and GM fiat all need to push a resource past its normal ceiling.
    this.hp.over = this.hp.value > this.hp.max;
    this.mana.over = this.mana.value > this.mana.max;

    // HP and mana have final maxima by now. AP and RP do not: their max is set
    // by the character/NPC subclass after this runs, so they are finished there.
    this._finishPools(this.hp, this.mana);

    // Defences.
    this.guard = Math.max(0, gear.guard + toughness + this.defences.guardBonus);
    this.blockGuard = Math.max(
      0,
      2 * toughness + gear.blockValue + this.defences.guardBonus + this.defences.blockBonus
    );
    this.evasion = 7 + agility + gear.evasion + this.defences.evasionBonus;
    this.dodgeEvasion = this.evasion + LYRIAN.dodgeBonus;
    this.potency = 11 + focus + this.defences.potencyBonus;
    this.save = toughness + this.defences.saveBonus;

    this.initiative.value = Math.max(
      0,
      agility + gear.initiative + this.initiative.bonus
    );

    this.movement.total = Math.max(0, this.movement.speed + this.movement.bonus);

    // Accuracy shorthands used by the roll helpers.
    this.accuracy = {
      standard: focus + this.defences.accuracyBonus,
      precise: focus * 2 + this.defences.accuracyBonus
    };

    this.equipment = gear;
    this.burden = gear.burden;
    this.overBurdened = gear.burden > LYRIAN.burdenLimit;
  }

  /* -------------------------------------------- */

  /**
   * Effective total and bar capacity for a resource pool.
   * `capacity` is max plus temp, so a boosted bar grows instead of compressing.
   */
  _finishPools(...pools) {
    for (const pool of pools) {
      const temp = pool.temp ?? 0;
      pool.total = pool.value + temp;
      pool.capacity = Math.max(1, pool.max + temp);
    }
  }

  /**
   * Sum equipped armour, shields and carried burden.
   * Only one armour applies; shields stack with armour but only for Block.
   */
  _prepareEquipment() {
    const out = {
      guard: 0,
      evasion: 0,
      initiative: 0,
      blockValue: 0,
      burden: 0,
      armor: null,
      shield: null,
      weapons: []
    };

    const items = this.parent?.items ?? [];

    for (const item of items) {
      const sys = item.system;

      if (item.type === "gear" && sys.combatItem) {
        out.burden += (sys.burden ?? 0) * (sys.quantity ?? 1);
        continue;
      }

      if (item.type === "weapon") {
        out.burden += sys.burden ?? 0;
        if (sys.equipped) out.weapons.push(item);
        continue;
      }

      if (item.type !== "armor") continue;

      const cat = LYRIAN.armorCategories[sys.category] ?? LYRIAN.armorCategories.clothing;
      out.burden += sys.burden ?? cat.burden ?? 0;
      if (!sys.equipped) continue;

      const penalty = sys.proficient ? { guard: 0, evasion: 0 } : LYRIAN.nonProficientArmorPenalty;

      if (cat.isShield) {
        if (out.shield) continue;
        out.shield = item;
        out.blockValue += cat.block + (sys.blockBonus ?? 0);
        out.guard += cat.guard + penalty.guard;
        out.evasion += cat.evasion + penalty.evasion;
        out.initiative += cat.initiative;
      } else {
        if (out.armor) continue;
        out.armor = item;
        out.guard += cat.guard + (sys.guardBonus ?? 0) + penalty.guard;
        out.evasion += cat.evasion + penalty.evasion;
        out.initiative += cat.initiative;
        out.blockValue += cat.block + (sys.blockBonus ?? 0);
      }
    }

    return out;
  }
}

/* -------------------------------------------- */
/*  Player characters                            */
/* -------------------------------------------- */

export class LyrianCharacter extends LyrianActorBase {
  static defineSchema() {
    const schema = super.defineSchema();

    schema.exp = new fields.SchemaField({
      total: int(0),
      spent: int(0)
    });

    schema.interlude = new fields.SchemaField({
      points: int(0),
      errandPoints: int(0)
    });

    schema.clim = int(LYRIAN.progression.startingClim);

    // Main skills: ranks plus a single named expertise.
    schema.skills = new fields.SchemaField(
      Object.keys(LYRIAN.skills).reduce((obj, key) => {
        obj[key] = new fields.SchemaField({
          rank: int(0, { min: 0 }),
          expertises: expertiseList(),
          bonus: int(0)
        });
        return obj;
      }, {})
    );

    schema.artisan = new fields.SchemaField(
      Object.keys(LYRIAN.artisanSkills).reduce((obj, key) => {
        obj[key] = new fields.SchemaField({
          rank: int(0, { min: 0 }),
          expertises: expertiseList(),
          bonus: int(0)
        });
        return obj;
      }, {})
    );

    schema.gathering = new fields.SchemaField(
      Object.keys(LYRIAN.gatheringSkills).reduce((obj, key) => {
        obj[key] = new fields.SchemaField({
          rank: int(0, { min: 0 }),
          bonus: int(0)
        });
        return obj;
      }, {})
    );

    schema.proficiencies = new fields.SchemaField({
      weapons: new fields.SetField(new fields.StringField(), { required: false }),
      armor: new fields.SetField(new fields.StringField(), { required: false }),
      languages: new fields.SetField(new fields.StringField(), { required: false }),
      unarmed: new fields.BooleanField({ initial: false })
    });
    schema.proficiencyChoiceSelections = new fields.ObjectField({
      required: true,
      nullable: false,
      initial: {}
    });

    schema.details = new fields.SchemaField({
      race: new fields.StringField({ blank: true, initial: "" }),
      subrace: new fields.StringField({ blank: true, initial: "" }),
      gender: new fields.StringField({ blank: true, initial: "" }),
      age: new fields.StringField({ blank: true, initial: "" }),
      height: new fields.StringField({ blank: true, initial: "" }),
      weight: new fields.StringField({ blank: true, initial: "" }),
      worship: new fields.StringField({ blank: true, initial: "" }),
      pronouns: new fields.StringField({ blank: true, initial: "" }),
      party: new fields.StringField({ blank: true, initial: "" }),
      partyRole: new fields.StringField({ blank: true, initial: "" })
    });

    schema.encounter = new fields.SchemaField({
      secretArtUsed: new fields.BooleanField({ initial: false }),
      encounterStartUsed: new fields.BooleanField({ initial: false }),
      conclusionUsed: new fields.BooleanField({ initial: false }),
      downedThisEncounter: int(0)
    });

    return schema;
  }

  /* -------------------------------------------- */

  prepareDerivedData() {
    super.prepareDerivedData();

    // Spirit core is exactly the EXP you have spent.
    const primaryRace = this.parent?.items?.find(
      (item) => item.type === "race" && item.system.raceKind === "primary"
    );
    this.ambitionExp = primaryRace?.system.ambitionExp || raceAmbitionExp(primaryRace?.system.ambition);
    this.spiritCore = this.exp.spent + this.ambitionExp;
    this.exp.available = this.exp.total + this.ambitionExp - this.exp.spent;

    // Skill caps loosen as your spirit core grows.
    const caps = LYRIAN.skillCaps;
    if (this.spiritCore >= caps.uncappedThreshold) this.skillCap = Infinity;
    else if (this.spiritCore >= caps.skyboundThreshold) this.skillCap = caps.base + caps.skyboundBonus;
    else this.skillCap = caps.base;

    this.tier = LYRIAN.spiritCoreTiers.reduce(
      (best, t) => (this.spiritCore >= t.threshold ? t : best),
      LYRIAN.spiritCoreTiers[0]
    );

    // Racial skill points are kept on their Race item and applied as derived
    // bonuses. Changing race therefore removes the old grant cleanly without
    // erasing skill ranks the player purchased normally.
    this.raceSkillPoints = { granted: 0, allocated: 0, unallocated: 0 };
    for (const race of this.parent?.items?.filter((item) => item.type === "race") ?? []) {
      const selection = selectedRaceSkillBonuses(race.system);
      this.raceSkillPoints.granted += selection.granted;
      this.raceSkillPoints.allocated += selection.allocated;
      this.raceSkillPoints.unallocated += selection.unallocated;
      for (const [key, value] of Object.entries(selection.bonuses)) {
        if (this.skills[key]) this.skills[key].bonus += value;
      }
    }

    // Action economy. Player characters are always heroic.
    const economy = LYRIAN.actionEconomy.heroic;
    this.ap.max = economy.ap + this.ap.bonus;
    this.rp.max = economy.rp + this.stats.agility.total + this.rp.bonus;
    this._finishPools(this.ap, this.rp);

    this._prepareSkillTotals();
  }

  /* -------------------------------------------- */

  /**
   * Skill check bonus = sub stat + ranks + highest applicable expertise.
   * Artisan and gathering skills do not add a sub stat.
   */
  _prepareSkillTotals() {
    for (const [key, skill] of Object.entries(this.skills)) {
      const statKey = LYRIAN.skills[key].stat;
      const stat = this.subStats[statKey]?.total ?? 0;
      skill.stat = statKey;
      skill.total = stat + skill.rank + skill.bonus;
      skill.atCap = skill.rank >= this.skillCap;
      this._prepareExpertises(skill);
    }

    for (const skill of Object.values(this.artisan)) {
      skill.total = skill.rank + skill.bonus;
      skill.atCap = skill.rank >= LYRIAN.skillCaps.artisan;
      this._prepareExpertises(skill);
    }

    for (const skill of Object.values(this.gathering)) {
      skill.total = skill.rank + skill.bonus;
      skill.atCap = skill.rank >= LYRIAN.skillCaps.gathering;
    }
  }

  /**
   * Give each expertise its own roll total, and record the best one so the
   * sheet can show what this skill is capable of at a glance.
   */
  _prepareExpertises(skill) {
    let best = null;
    for (const expertise of skill.expertises ?? []) {
      expertise.total = skill.total + expertise.rank;
      if (!best || expertise.total > best.total) best = expertise;
    }
    skill.bestExpertise = best;
    skill.hasExpertise = (skill.expertises?.length ?? 0) > 0;
  }
}

/* -------------------------------------------- */
/*  NPCs                                         */
/* -------------------------------------------- */

export class LyrianNPC extends LyrianActorBase {
  static defineSchema() {
    const schema = super.defineSchema();

    schema.rank = new fields.StringField({
      required: true,
      initial: "grunt",
      choices: Object.keys(LYRIAN.combatantTypes)
    });

    schema.details = new fields.SchemaField({
      creatureType: new fields.StringField({ blank: true, initial: "" }),
      powerLevel: int(0),
      expReward: int(0),
      astraCorruption: int(0),
      dangerLevel: new fields.StringField({ blank: true, initial: "" }),
      recommended: new fields.StringField({ blank: true, initial: "" }),
      appearance: new fields.StringField({ blank: true, initial: "" }),
      habitat: new fields.StringField({ blank: true, initial: "" }),
      strongAgainst: new fields.StringField({ blank: true, initial: "" }),
      weakAgainst: new fields.StringField({ blank: true, initial: "" })
    });

    schema.gatherables = new fields.StringField({ blank: true, initial: "" });
    schema.tactics = new fields.HTMLField({ required: false, blank: true });
    schema.runningMonster = new fields.HTMLField({ required: false, blank: true });
    schema.official = new fields.SchemaField({
      enabled: new fields.BooleanField({ initial: false }),
      hp: int(0),
      mana: int(0),
      ap: int(0),
      rp: int(0),
      initiative: int(0),
      evasion: int(0),
      dodgeEvasion: int(0),
      guard: int(0),
      blockGuard: int(0),
      movement: int(0),
      lightAttack: new fields.StringField({ blank: true, initial: "" }),
      heavyAttack: new fields.StringField({ blank: true, initial: "" }),
      notableSkills: new fields.StringField({ blank: true, initial: "" })
    });
    schema.source = new fields.ObjectField({ required: true, nullable: false, initial: {} });

    return schema;
  }

  /* -------------------------------------------- */

  prepareDerivedData() {
    super.prepareDerivedData();

    if (this.official.enabled) {
      this.hp.max = this.official.hp;
      this.mana.max = this.official.mana;
      this.hp.over = this.hp.value > this.hp.max;
      this.mana.over = this.mana.value > this.mana.max;
      this.ap.max = this.official.ap;
      this.rp.max = this.official.rp;
      this.guard = this.official.guard;
      this.blockGuard = this.official.blockGuard;
      this.evasion = this.official.evasion;
      this.dodgeEvasion = this.official.dodgeEvasion;
      this.initiative.value = this.official.initiative;
      this.movement.total = this.official.movement;
      this._finishPools(this.hp, this.mana);
    } else {
      const economy = LYRIAN.actionEconomy[this.rank] ?? LYRIAN.actionEconomy.grunt;
      this.ap.max = economy.ap + this.ap.bonus;
      this.rp.max = economy.rpFromAgility
        ? economy.rp + this.stats.agility.total + this.rp.bonus
        : economy.rp + this.rp.bonus;
    }
    this._finishPools(this.ap, this.rp);

    // Grunts die outright at 0 HP; heroics and bosses go down first.
    this.diesWhenDropped = this.rank === "grunt";
    this.isHeroic = this.rank !== "grunt";
  }
}
