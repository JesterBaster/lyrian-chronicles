import { LYRIAN } from "../config.mjs";

const fields = foundry.data.fields;

function int(initial = 0, extra = {}) {
  return new fields.NumberField({ required: true, integer: true, initial, ...extra });
}

/* -------------------------------------------- */

export class LyrianItemBase extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField({ required: false, blank: true }),
      source: new fields.StringField({ blank: true, initial: "" })
    };
  }
}

/* -------------------------------------------- */
/*  Weapons                                      */
/* -------------------------------------------- */

export class LyrianWeapon extends LyrianItemBase {
  static defineSchema() {
    const schema = super.defineSchema();

    schema.group = new fields.StringField({
      required: true,
      initial: "lightSword",
      choices: Object.keys(LYRIAN.weaponGroups)
    });

    schema.hands = new fields.StringField({
      required: true,
      initial: "one",
      choices: Object.keys(LYRIAN.weaponHands)
    });

    schema.damageType = new fields.StringField({
      required: true,
      initial: "physical",
      choices: Object.keys(LYRIAN.damageTypes)
    });

    schema.equipped = new fields.BooleanField({ initial: false });
    schema.proficient = new fields.BooleanField({ initial: true });
    schema.offHand = new fields.BooleanField({ initial: false });

    schema.accuracyBonus = int(0);
    schema.damageBonus = int(0);
    schema.critThreshold = int(20, { min: 2, max: 20 });
    schema.rangeOverride = int(0);
    schema.burden = int(1, { min: 0 });
    schema.value = int(0, { min: 0 });

    schema.enchantment = new fields.StringField({ blank: true, initial: "" });
    schema.poison = new fields.SchemaField({
      name: new fields.StringField({ blank: true, initial: "" }),
      hitsRemaining: int(0, { min: 0 })
    });

    return schema;
  }

  /* -------------------------------------------- */

  prepareDerivedData() {
    const group = LYRIAN.weaponGroups[this.group] ?? {};
    this.groupData = group;
    this.isRanged = !!group.ranged;
    this.isTwoHanded = this.hands === "two";
    this.isChanneling = !!group.channeling;
    this.isArtisan = !!group.artisan;
    this.isImprovised = this.group === "improvised";
    this.isUnarmed = this.group === "unarmed";

    // Katana and similar groups widen the crit range.
    this.effectiveCrit = Math.min(this.critThreshold, group.critThreshold ?? 20);

    // Effective range. Group overrides beat the generic 60/120 default.
    if (this.rangeOverride > 0) {
      this.range = this.rangeOverride;
    } else if (this.isRanged) {
      this.range = group.range?.[this.hands] ?? LYRIAN.rangedDefaults[this.hands];
    } else {
      this.range = LYRIAN.meleeRange + (group.rangeBonus ?? 0);
    }

    this.threatenedRange = this.isRanged ? 0 : LYRIAN.meleeRange + (group.rangeBonus ?? 0);
    this.propertyLabel = group.property ?? "";
  }

  /* -------------------------------------------- */

  /**
   * Build the damage formula for a given basic attack type.
   * @param {string} attackType   "light" | "heavy" | "precise"
   * @param {number} power        The attacker's Power total.
   * @returns {{formula: string, flat: number}}
   */
  getDamageFormula(attackType, power) {
    const profile = LYRIAN.attackTypes[attackType];
    if (!profile) return { formula: "0", flat: 0 };

    // Improvised weapons use their own reduced table.
    if (this.isImprovised) {
      const imp = LYRIAN.improvisedDamage[attackType];
      const flat = power * imp.powerMultiplier + this.damageBonus;
      return { formula: imp.formula, flat };
    }

    // Unarmed without proficiency is a flat 1.
    if (this.isUnarmed && !this.proficient) return { formula: "0", flat: 1 };

    let dice = profile.damage;
    if (attackType === "heavy" && this.isTwoHanded && !this.isRanged) {
      dice = profile.twoHandedMeleeDamage;
    }

    const flat = power * profile.powerMultiplier + this.damageBonus;
    return { formula: dice, flat };
  }
}

/* -------------------------------------------- */
/*  Armour                                       */
/* -------------------------------------------- */

export class LyrianArmor extends LyrianItemBase {
  static defineSchema() {
    const schema = super.defineSchema();

    schema.category = new fields.StringField({
      required: true,
      initial: "light",
      choices: Object.keys(LYRIAN.armorCategories)
    });

    schema.equipped = new fields.BooleanField({ initial: false });
    schema.proficient = new fields.BooleanField({ initial: true });

    schema.guardBonus = int(0);
    schema.blockBonus = int(0);
    schema.burden = int(1, { min: 0 });
    schema.value = int(0, { min: 0 });
    schema.modification = new fields.StringField({ blank: true, initial: "" });

    return schema;
  }

  prepareDerivedData() {
    const cat = LYRIAN.armorCategories[this.category] ?? {};
    this.categoryData = cat;
    this.isShield = !!cat.isShield;
    this.guard = (cat.guard ?? 0) + this.guardBonus;
    this.blockValue = (cat.block ?? 0) + this.blockBonus;
    this.evasionPenalty = cat.evasion ?? 0;
    this.initiativePenalty = cat.initiative ?? 0;
  }
}

/* -------------------------------------------- */
/*  Abilities                                    */
/* -------------------------------------------- */

export class LyrianAbility extends LyrianItemBase {
  static defineSchema() {
    const schema = super.defineSchema();

    schema.apCost = int(1, { min: 0 });
    schema.rpCost = int(0, { min: 0 });
    schema.manaCost = int(0, { min: 0 });
    schema.upkeep = int(0, { min: 0 });

    schema.timing = new fields.StringField({
      required: true,
      initial: "action",
      choices: Object.keys(LYRIAN.abilityTiming)
    });

    // Unconstrained on purpose. Keywords listed in LYRIAN.abilityKeywords are
    // mechanically enforced; anything else is carried through and displayed as
    // a label. A real ability list uses far more keywords than this system
    // automates, and rejecting them would make importing content impossible.
    schema.keywords = new fields.SetField(
      new fields.StringField({ blank: true }),
      { required: false }
    );

    // Fields imported content may carry. Kept so a round trip is lossless.
    schema.rawKeywords = new fields.StringField({ blank: true, initial: "" });
    schema.rawCost = new fields.StringField({ blank: true, initial: "" });
    schema.otherCosts = new fields.StringField({ blank: true, initial: "" });
    schema.benefits = new fields.HTMLField({ required: false, blank: true });
    schema.isKeyAbility = new fields.BooleanField({ initial: false });
    schema.patchVersion = new fields.StringField({ blank: true, initial: "" });

    schema.range = new fields.StringField({ blank: true, initial: "" });
    schema.requirement = new fields.StringField({ blank: true, initial: "" });

    // Optional attack payload so an ability can roll like a weapon strike.
    schema.hasAttack = new fields.BooleanField({ initial: false });
    schema.attackType = new fields.StringField({
      required: true,
      initial: "light",
      choices: Object.keys(LYRIAN.attackTypes)
    });
    schema.damageFormula = new fields.StringField({ blank: true, initial: "" });
    schema.damageType = new fields.StringField({
      required: true,
      initial: "physical",
      choices: Object.keys(LYRIAN.damageTypes)
    });
    schema.usesWeapon = new fields.BooleanField({ initial: false });

    // Ability tracking.
    schema.classSource = new fields.StringField({ blank: true, initial: "" });
    schema.classStep = int(0, { min: 0, max: 7 });
    schema.usedThisRound = new fields.BooleanField({ initial: false });

    return schema;
  }

  prepareDerivedData() {
    this.isRapid = this.keywords?.has("rapid") ?? false;
    this.isSecretArt = (this.keywords?.has("secretArt") ?? false) || this.timing === "secretArt";
    this.isReaction = this.rpCost > 0 && this.apCost === 0;
    this.costLabel = [
      this.apCost ? `${this.apCost} AP` : null,
      this.rpCost ? `${this.rpCost} RP` : null,
      this.manaCost ? `${this.manaCost} Mana` : null
    ]
      .filter(Boolean)
      .join(", ") || "—";
  }
}

/* -------------------------------------------- */
/*  Classes                                      */
/* -------------------------------------------- */

export class LyrianClass extends LyrianItemBase {
  static defineSchema() {
    const schema = super.defineSchema();

    schema.tier = int(1, { min: 1, max: 5 });
    schema.abilitiesUnlocked = int(0, { min: 0, max: 7 });
    schema.keyAbilities = new fields.StringField({ blank: true, initial: "" });
    schema.requirements = new fields.StringField({ blank: true, initial: "" });
    schema.artisan = new fields.BooleanField({ initial: false });
    schema.gathering = new fields.BooleanField({ initial: false });

    return schema;
  }

  prepareDerivedData() {
    const p = LYRIAN.progression;
    this.unlockCost = this.tier * p.classCostPerTier;
    this.mastered = this.abilitiesUnlocked >= p.abilitiesPerClass;
    // Unlock cost plus 100 per ability step purchased so far.
    this.expInvested = this.unlockCost + this.abilitiesUnlocked * p.abilityCost;
    this.nextAbilityCost = this.mastered ? 0 : p.abilityCost;
  }
}

/* -------------------------------------------- */
/*  Breakthroughs                                */
/* -------------------------------------------- */

export class LyrianBreakthrough extends LyrianItemBase {
  static defineSchema() {
    const schema = super.defineSchema();
    schema.expCost = int(100, { min: 0 });
    schema.level = int(1, { min: 1 });
    schema.requirements = new fields.StringField({ blank: true, initial: "" });
    schema.repeatable = new fields.BooleanField({ initial: false });
    return schema;
  }
}

/* -------------------------------------------- */
/*  Races                                        */
/* -------------------------------------------- */

export class LyrianRace extends LyrianItemBase {
  static defineSchema() {
    const schema = super.defineSchema();
    schema.subrace = new fields.StringField({ blank: true, initial: "" });
    schema.clan = new fields.StringField({ blank: true, initial: "" });
    schema.grantedProficiencies = new fields.StringField({ blank: true, initial: "" });
    schema.grantedSkills = new fields.StringField({ blank: true, initial: "" });
    schema.size = new fields.StringField({
      required: true,
      initial: "medium",
      choices: Object.keys(LYRIAN.creatureSizes)
    });
    schema.speed = int(LYRIAN.baseSpeed);
    return schema;
  }
}

/* -------------------------------------------- */
/*  Gear, consumables, materials                 */
/* -------------------------------------------- */

export class LyrianGear extends LyrianItemBase {
  static defineSchema() {
    const schema = super.defineSchema();
    schema.quantity = int(1, { min: 0 });
    schema.burden = int(0, { min: 0 });
    schema.value = int(0, { min: 0 });
    schema.combatItem = new fields.BooleanField({ initial: true });
    schema.isKit = new fields.BooleanField({ initial: false });
    schema.materialType = new fields.StringField({ blank: true, initial: "" });
    schema.units = int(0, { min: 0 });
    return schema;
  }

  prepareDerivedData() {
    // Kits always count as burden even though they are non-combat items.
    this.countsAsBurden = this.combatItem || this.isKit;
    this.totalBurden = this.countsAsBurden ? this.burden * this.quantity : 0;
  }
}

/* -------------------------------------------- */
/*  Injuries                                     */
/* -------------------------------------------- */

export class LyrianInjury extends LyrianItemBase {
  static defineSchema() {
    const schema = super.defineSchema();
    schema.injuryKey = new fields.StringField({ blank: true, initial: "" });
    schema.rolled = int(0, { min: 0, max: 10 });
    schema.fromDowned = new fields.BooleanField({ initial: true });
    schema.suppressed = new fields.BooleanField({ initial: false });
    return schema;
  }
}
