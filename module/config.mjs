/**
 * Static rules data for The Lyrian Chronicles.
 * Everything a GM might want to reskin lives here, not in the logic files.
 */
export const LYRIAN = {};

/* -------------------------------------------- */
/*  Stats                                        */
/* -------------------------------------------- */

/** Main stats. Character creation array: 5, 4, 4, 3. */
LYRIAN.mainStats = {
  power: "LYRIAN.Stat.Power",
  focus: "LYRIAN.Stat.Focus",
  agility: "LYRIAN.Stat.Agility",
  toughness: "LYRIAN.Stat.Toughness"
};

/** Sub stats. Character creation array: 5, 4, 3, 2, 1. */
LYRIAN.subStats = {
  fitness: "LYRIAN.Stat.Fitness",
  cunning: "LYRIAN.Stat.Cunning",
  reason: "LYRIAN.Stat.Reason",
  awareness: "LYRIAN.Stat.Awareness",
  presence: "LYRIAN.Stat.Presence"
};

LYRIAN.mainStatArray = [5, 4, 4, 3];
LYRIAN.subStatArray = [5, 4, 3, 2, 1];

/* -------------------------------------------- */
/*  Skills                                       */
/* -------------------------------------------- */

/** Main skills keyed to their governing sub stat. */
LYRIAN.skills = {
  athletics: { label: "LYRIAN.Skill.Athletics", stat: "fitness" },
  riding: { label: "LYRIAN.Skill.Riding", stat: "fitness" },

  deception: { label: "LYRIAN.Skill.Deception", stat: "cunning" },
  roguecraft: { label: "LYRIAN.Skill.Roguecraft", stat: "cunning" },
  stealth: { label: "LYRIAN.Skill.Stealth", stat: "cunning" },

  artifice: { label: "LYRIAN.Skill.Artifice", stat: "reason" },
  appraise: { label: "LYRIAN.Skill.Appraise", stat: "reason" },
  commonKnowledge: { label: "LYRIAN.Skill.CommonKnowledge", stat: "reason" },
  flight: { label: "LYRIAN.Skill.Flight", stat: "reason" },
  history: { label: "LYRIAN.Skill.History", stat: "reason" },
  linguistics: { label: "LYRIAN.Skill.Linguistics", stat: "reason" },
  magic: { label: "LYRIAN.Skill.Magic", stat: "reason" },
  medicine: { label: "LYRIAN.Skill.Medicine", stat: "reason" },
  religion: { label: "LYRIAN.Skill.Religion", stat: "reason" },

  animalHusbandry: { label: "LYRIAN.Skill.AnimalHusbandry", stat: "awareness" },
  insight: { label: "LYRIAN.Skill.Insight", stat: "awareness" },
  perception: { label: "LYRIAN.Skill.Perception", stat: "awareness" },
  survival: { label: "LYRIAN.Skill.Survival", stat: "awareness" },

  art: { label: "LYRIAN.Skill.Art", stat: "presence" },
  intimidation: { label: "LYRIAN.Skill.Intimidation", stat: "presence" },
  negotiation: { label: "LYRIAN.Skill.Negotiation", stat: "presence" }
};

/** Artisan skills. Capped at 10 points and 10 expertise, no sub stat applies. */
LYRIAN.artisanSkills = {
  blacksmith: "LYRIAN.Artisan.Blacksmith",
  alchemist: "LYRIAN.Artisan.Alchemist",
  farmer: "LYRIAN.Artisan.Farmer",
  carpenter: "LYRIAN.Artisan.Carpenter",
  armorsmith: "LYRIAN.Artisan.Armorsmith",
  artificer: "LYRIAN.Artisan.Artificer"
};

/** Gathering skills. Capped at 15, no expertise possible. */
LYRIAN.gatheringSkills = {
  mining: "LYRIAN.Gathering.Mining",
  woodcutting: "LYRIAN.Gathering.Woodcutting",
  botany: "LYRIAN.Gathering.Botany",
  hunting: "LYRIAN.Gathering.Hunting",
  fishing: "LYRIAN.Gathering.Fishing"
};

LYRIAN.skillCaps = {
  base: 15,
  skyboundBonus: 5,
  skyboundThreshold: 5000,
  uncappedThreshold: 10000,
  artisan: 10,
  gathering: 15
};

/** Task difficulty ladder used for GM target numbers. */
LYRIAN.taskDifficulty = {
  10: "LYRIAN.Task.Initiate",
  15: "LYRIAN.Task.Professional",
  20: "LYRIAN.Task.Expert",
  25: "LYRIAN.Task.Specialist",
  30: "LYRIAN.Task.Master"
};

/* -------------------------------------------- */
/*  Combat                                       */
/* -------------------------------------------- */

LYRIAN.combatantTypes = {
  grunt: "LYRIAN.Combatant.Grunt",
  heroic: "LYRIAN.Combatant.Heroic",
  boss: "LYRIAN.Combatant.Boss"
};

/** Default action economy by combatant type. */
LYRIAN.actionEconomy = {
  grunt: { ap: 2, rp: 1, rpFromAgility: false },
  heroic: { ap: 4, rp: 2, rpFromAgility: true },
  boss: { ap: 4, rp: 2, rpFromAgility: true }
};

/** Basic attack profiles. Damage strings are resolved against the actor at roll time. */
LYRIAN.attackTypes = {
  light: {
    label: "LYRIAN.Attack.Light",
    ap: 1,
    accuracy: "focus",
    damage: "2d4",
    powerMultiplier: 1
  },
  heavy: {
    label: "LYRIAN.Attack.Heavy",
    ap: 2,
    accuracy: "focus",
    damage: "4d6",
    twoHandedMeleeDamage: "5d6",
    powerMultiplier: 2
  },
  precise: {
    label: "LYRIAN.Attack.Precise",
    ap: 2,
    accuracy: "doubleFocus",
    damage: "2d4",
    powerMultiplier: 1,
    pinpoint: true
  }
};

LYRIAN.defenceReactions = {
  none: "LYRIAN.Defence.None",
  dodge: "LYRIAN.Defence.Dodge",
  block: "LYRIAN.Defence.Block"
};

/** Dodge raises Evasion to 20 + Agility, i.e. a flat +13 over the 7 + Agility base. */
LYRIAN.dodgeBonus = 13;

LYRIAN.cover = {
  none: { label: "LYRIAN.Cover.None", evasion: 0, guard: 0 },
  low: { label: "LYRIAN.Cover.Low", evasion: 4, guard: 0 },
  high: { label: "LYRIAN.Cover.High", evasion: 6, guard: 1 },
  full: { label: "LYRIAN.Cover.Full", evasion: 0, guard: 0, untargetable: true }
};

LYRIAN.creatureSizes = {
  tiny: { label: "LYRIAN.Size.Tiny", space: 0 },
  small: { label: "LYRIAN.Size.Small", space: 1 },
  medium: { label: "LYRIAN.Size.Medium", space: 1 },
  large: { label: "LYRIAN.Size.Large", space: 2 },
  huge: { label: "LYRIAN.Size.Huge", space: 3 }
};

LYRIAN.baseSpeed = 20;
LYRIAN.roundSeconds = 10;
LYRIAN.burdenLimit = 10;

/* -------------------------------------------- */
/*  Damage                                       */
/* -------------------------------------------- */

LYRIAN.damageTypes = {
  physical: { label: "LYRIAN.Damage.Physical", group: "physical" },
  slashing: { label: "LYRIAN.Damage.Slashing", group: "physical", parent: "physical" },
  piercing: { label: "LYRIAN.Damage.Piercing", group: "physical", parent: "physical" },
  bludgeoning: { label: "LYRIAN.Damage.Bludgeoning", group: "physical", parent: "physical" },
  poison: { label: "LYRIAN.Damage.Poison", group: "physical" },

  arcane: { label: "LYRIAN.Damage.Arcane", group: "magic" },
  fire: { label: "LYRIAN.Damage.Fire", group: "magic" },
  water: { label: "LYRIAN.Damage.Water", group: "magic" },
  earth: { label: "LYRIAN.Damage.Earth", group: "magic" },
  acid: { label: "LYRIAN.Damage.Acid", group: "magic", parent: "earth" },
  wind: { label: "LYRIAN.Damage.Wind", group: "magic" },
  lightning: { label: "LYRIAN.Damage.Lightning", group: "magic" },
  frost: { label: "LYRIAN.Damage.Frost", group: "magic" },

  holy: { label: "LYRIAN.Damage.Holy", group: "divine" },
  dark: { label: "LYRIAN.Damage.Dark", group: "divine" },
  necrotic: { label: "LYRIAN.Damage.Necrotic", group: "divine", parent: "dark" },

  astra: { label: "LYRIAN.Damage.Astra", group: "astra" }
};

/* -------------------------------------------- */
/*  Weapons                                      */
/* -------------------------------------------- */

/**
 * Weapon groups and the passive property each grants.
 * `critThreshold` and `rangeBonus` are applied mechanically; the rest are
 * reminder text surfaced on the sheet and in chat cards.
 */
LYRIAN.weaponGroups = {
  small: { label: "LYRIAN.Weapon.Small", property: "LYRIAN.WeaponProp.HiddenWeapon", hands: ["one"] },
  polearm: { label: "LYRIAN.Weapon.Polearm", property: "LYRIAN.WeaponProp.Polearm", rangeBonus: 5, threatenMin: 5 },
  lightSword: { label: "LYRIAN.Weapon.LightSword", property: "LYRIAN.WeaponProp.Nimble", hands: ["one"] },
  longsword: { label: "LYRIAN.Weapon.Longsword", property: "LYRIAN.WeaponProp.Versatile", versatile: true },
  dueling: { label: "LYRIAN.Weapon.Dueling", property: "LYRIAN.WeaponProp.Dueling", hands: ["one"] },
  axe: { label: "LYRIAN.Weapon.Axe", property: "LYRIAN.WeaponProp.WildSwing", missDamage: { light: 4, heavy: 8, precise: 8 } },
  bludgeoning: { label: "LYRIAN.Weapon.Bludgeoning", property: "LYRIAN.WeaponProp.HollowBlow", blockPunish: { light: 2, precise: 2, heavy: 4 } },
  katana: { label: "LYRIAN.Weapon.Katana", property: "LYRIAN.WeaponProp.Keen", critThreshold: 19 },
  heavyBlade: { label: "LYRIAN.Weapon.HeavyBlade", property: "LYRIAN.WeaponProp.Overpower", hands: ["two"] },
  twinblade: { label: "LYRIAN.Weapon.Twinblade", property: "LYRIAN.WeaponProp.TwinStrike", hands: ["two"] },

  thrown: { label: "LYRIAN.Weapon.Thrown", property: "LYRIAN.WeaponProp.Thrown", ranged: true, range: { one: 30, two: 60 } },
  missiles: { label: "LYRIAN.Weapon.Missiles", property: "LYRIAN.WeaponProp.SetOfMissiles", ranged: true, hands: ["one"], range: { one: 30 } },
  bow: { label: "LYRIAN.Weapon.Bow", property: "LYRIAN.WeaponProp.HighGround", ranged: true, hands: ["two"], range: { two: 240 } },
  crossbow: { label: "LYRIAN.Weapon.Crossbow", property: "LYRIAN.WeaponProp.ArmorPierce", ranged: true },
  musket: { label: "LYRIAN.Weapon.Musket", property: "LYRIAN.WeaponProp.ArmorPierceOne", ranged: true, hands: ["two"] },
  sling: { label: "LYRIAN.Weapon.Sling", property: "LYRIAN.WeaponProp.GiantKiller", ranged: true, hands: ["one"] },

  pistol: { label: "LYRIAN.Weapon.Pistol", property: "LYRIAN.WeaponProp.TwoHandedGrip", ranged: true, specialized: true, hands: ["one"] },
  shotgun: { label: "LYRIAN.Weapon.Shotgun", property: "LYRIAN.WeaponProp.PointBlank", ranged: true, specialized: true, range: { one: 15, two: 30 } },
  sniper: { label: "LYRIAN.Weapon.Sniper", property: "LYRIAN.WeaponProp.Snipe", ranged: true, specialized: true, hands: ["two"], range: { two: 720 } },
  threadDagger: { label: "LYRIAN.Weapon.ThreadDagger", property: "LYRIAN.WeaponProp.WiredWeapon", specialized: true, hands: ["one"] },
  lance: { label: "LYRIAN.Weapon.Lance", property: "LYRIAN.WeaponProp.ChargerWeapon", specialized: true, hands: ["one"], rangeBonus: 5 },
  whip: { label: "LYRIAN.Weapon.Whip", property: "LYRIAN.WeaponProp.WhipCrack", specialized: true, hands: ["one"], rangeBonus: 5 },
  gauntlet: { label: "LYRIAN.Weapon.Gauntlet", property: "LYRIAN.WeaponProp.UnarmedCombat", specialized: true, hands: ["one"] },

  wand: { label: "LYRIAN.Weapon.Wand", property: "LYRIAN.WeaponProp.MagicBlast", ranged: true, channeling: true },
  staff: { label: "LYRIAN.Weapon.Staff", property: "LYRIAN.WeaponProp.StaffPush", channeling: true },

  scythe: { label: "LYRIAN.Weapon.Scythe", property: "LYRIAN.WeaponProp.SweepingArc", artisan: true, hands: ["two"] },
  scissors: { label: "LYRIAN.Weapon.Scissors", property: "LYRIAN.WeaponProp.Shearing", artisan: true, hands: ["two"] },
  pickaxe: { label: "LYRIAN.Weapon.Pickaxe", property: "LYRIAN.WeaponProp.AsAxe", artisan: true },
  hori: { label: "LYRIAN.Weapon.Hori", property: "LYRIAN.WeaponProp.AsSmall", artisan: true, hands: ["one"] },
  sickle: { label: "LYRIAN.Weapon.Sickle", property: "LYRIAN.WeaponProp.AsAxe", artisan: true, hands: ["one"] },
  smithHammer: { label: "LYRIAN.Weapon.SmithHammer", property: "LYRIAN.WeaponProp.AsBludgeoning", artisan: true },

  unarmed: { label: "LYRIAN.Weapon.Unarmed", property: "LYRIAN.WeaponProp.Unarmed", hands: ["one"] },
  improvised: { label: "LYRIAN.Weapon.Improvised", property: "LYRIAN.WeaponProp.Improvised" }
};

LYRIAN.weaponHands = {
  one: "LYRIAN.Hands.One",
  two: "LYRIAN.Hands.Two"
};

/** Default effective ranges when a group does not override them. */
LYRIAN.rangedDefaults = { one: 60, two: 120 };
LYRIAN.meleeRange = 5;
LYRIAN.thrownRange = 15;

/** Improvised weapons swap in weaker dice and lose the Power bonus on light attacks. */
LYRIAN.improvisedDamage = {
  light: { formula: "2d4", powerMultiplier: 0 },
  heavy: { formula: "2d6", powerMultiplier: 1 },
  precise: { formula: "2d4", powerMultiplier: 0 }
};

/* -------------------------------------------- */
/*  Armour                                       */
/* -------------------------------------------- */

LYRIAN.armorCategories = {
  clothing: { label: "LYRIAN.Armor.Clothing", guard: 0, initiative: 0, evasion: 0, block: 0, burden: 0 },
  light: { label: "LYRIAN.Armor.Light", guard: 1, initiative: -1, evasion: -2, block: 4, burden: 1 },
  medium: { label: "LYRIAN.Armor.Medium", guard: 2, initiative: -2, evasion: -4, block: 8, burden: 2 },
  heavy: { label: "LYRIAN.Armor.Heavy", guard: 3, initiative: -3, evasion: -6, block: 12, burden: 3 },
  shield: { label: "LYRIAN.Armor.Shield", guard: 0, initiative: 0, evasion: 0, block: 4, burden: 1, isShield: true },
  greatshield: { label: "LYRIAN.Armor.Greatshield", guard: 1, initiative: -1, evasion: -2, block: 8, burden: 2, isShield: true }
};

/** Non-proficient use: guard down 1, evasion penalty up 1. */
LYRIAN.nonProficientArmorPenalty = { guard: -1, evasion: -1 };

/* -------------------------------------------- */
/*  Abilities                                    */
/* -------------------------------------------- */

LYRIAN.abilityKeywords = {
  rapid: "LYRIAN.Keyword.Rapid",
  lockOn: "LYRIAN.Keyword.LockOn",
  sureHit: "LYRIAN.Keyword.SureHit",
  fullPierce: "LYRIAN.Keyword.FullPierce",
  halfPierce: "LYRIAN.Keyword.HalfPierce",
  pinpoint: "LYRIAN.Keyword.Pinpoint",
  trickAttack: "LYRIAN.Keyword.TrickAttack",
  stealth: "LYRIAN.Keyword.Stealth",
  upkeep: "LYRIAN.Keyword.Upkeep",
  secretArt: "LYRIAN.Keyword.SecretArt",
  downed: "LYRIAN.Keyword.Downed"
};

LYRIAN.abilityTiming = {
  action: "LYRIAN.Timing.Action",
  reaction: "LYRIAN.Timing.Reaction",
  encounterStart: "LYRIAN.Timing.EncounterStart",
  encounterConclusion: "LYRIAN.Timing.EncounterConclusion",
  interlude: "LYRIAN.Timing.Interlude",
  passive: "LYRIAN.Timing.Passive",
  crafting: "LYRIAN.Timing.Crafting",
  gathering: "LYRIAN.Timing.Gathering"
};

/* -------------------------------------------- */
/*  Progression                                  */
/* -------------------------------------------- */

LYRIAN.progression = {
  startingBreakthroughExp: 300,
  startingClassExp: 1000,
  startingInterludePoints: 3,
  startingSkillPoints: 10,
  startingClim: 3000,
  classCostPerTier: 100,
  abilityCost: 100,
  maxClassLevel: 8
};

/** Spirit core milestones. Purely informational on the sheet. */
LYRIAN.spiritCoreTiers = [
  { threshold: 0, label: "LYRIAN.Tier.Grounded" },
  { threshold: 5000, label: "LYRIAN.Tier.Skybound" },
  { threshold: 10000, label: "LYRIAN.Tier.Ascendant" }
];

/** The 1d10 injury table rolled after being downed. */
LYRIAN.injuryTable = {
  1: { key: "mainHand", label: "LYRIAN.Injury.MainHand" },
  2: { key: "muscle", label: "LYRIAN.Injury.Muscle", changes: { rp: -2 } },
  3: { key: "spiritCircuit", label: "LYRIAN.Injury.SpiritCircuit" },
  4: { key: "offHand", label: "LYRIAN.Injury.OffHand" },
  5: { key: "leg", label: "LYRIAN.Injury.Leg", changes: { speed: -10 } },
  6: { key: "head", label: "LYRIAN.Injury.Head", changes: { ap: -1 } },
  7: { key: "wound", label: "LYRIAN.Injury.Wound", changes: { evasion: -2 } },
  8: { key: "eye", label: "LYRIAN.Injury.Eye", changes: { accuracy: -3 } },
  9: { key: "laceration", label: "LYRIAN.Injury.Laceration" },
  10: { key: "foot", label: "LYRIAN.Injury.Foot", changes: { speed: -5 } }
};

/* -------------------------------------------- */
/*  Status effects                               */
/* -------------------------------------------- */

LYRIAN.statusEffects = [
  { id: "downed", name: "LYRIAN.Status.Downed", img: "icons/svg/falling.svg" },
  { id: "mortalWound", name: "LYRIAN.Status.MortalWound", img: "icons/svg/blood.svg" },
  { id: "prone", name: "LYRIAN.Status.Prone", img: "icons/svg/falling.svg" },
  { id: "hiding", name: "LYRIAN.Status.Hiding", img: "icons/svg/invisible.svg" },
  { id: "rooted", name: "LYRIAN.Status.Rooted", img: "icons/svg/net.svg" },
  { id: "grappled", name: "LYRIAN.Status.Grappled", img: "icons/svg/net.svg" },
  { id: "surprised", name: "LYRIAN.Status.Surprised", img: "icons/svg/daze.svg" },
  { id: "overwatch", name: "LYRIAN.Status.Overwatch", img: "icons/svg/eye.svg" },
  { id: "defending", name: "LYRIAN.Status.Defending", img: "icons/svg/shield.svg" }
];
