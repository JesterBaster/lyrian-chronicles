import { proficiencyKey } from "./proficiencies.mjs";

const WEAPON_GROUPS = Object.freeze([
  [/saboteur thread dagger/i, "threadDagger"],
  [/set of missiles/i, "missiles"],
  [/smith['’]s hammer/i, "smithHammer"],
  [/giant scissors/i, "scissors"],
  [/heavy blade/i, "heavyBlade"],
  [/light sword/i, "lightSword"],
  [/small weapons?/i, "small"],
  [/bludgeoning weapon/i, "bludgeoning"],
  [/dueling weapon/i, "dueling"],
  [/sniper rifle/i, "sniper"],
  [/shepherd['’]s sling|\bsling\b/i, "sling"],
  [/power gauntlets?|\bgauntlets?\b/i, "gauntlet"],
  [/twinblade/i, "twinblade"],
  [/longsword/i, "longsword"],
  [/crossbow/i, "crossbow"],
  [/shotgun/i, "shotgun"],
  [/pickaxe/i, "pickaxe"],
  [/polearm/i, "polearm"],
  [/katana/i, "katana"],
  [/pistol|stun gun|shock stick/i, "pistol"],
  [/musket/i, "musket"],
  [/scythe/i, "scythe"],
  [/\bstaff\b/i, "staff"],
  [/\bwand\b/i, "wand"],
  [/\blance\b/i, "lance"],
  [/\bwhip\b/i, "whip"],
  [/\bsickle\b/i, "sickle"],
  [/\bhori\b/i, "hori"],
  [/\bbow\b/i, "bow"],
  [/\baxe\b/i, "axe"],
  [/\bthrown\b/i, "thrown"]
]);

const WEAPON_PROFICIENCIES = Object.freeze({
  small: "Small Weapons",
  polearm: "Polearm",
  lightSword: "Light Swords",
  longsword: "Longsword",
  dueling: "Dueling Weapons",
  axe: "Axe",
  bludgeoning: "Bludgeoning Weapons",
  katana: "Katana",
  heavyBlade: "Heavy Blades",
  twinblade: "Twinblade",
  thrown: "Thrown Weapons",
  missiles: "Set of Missiles",
  bow: "Bow",
  crossbow: "Crossbow",
  musket: "Musket",
  sling: "Sling",
  pistol: "Pistol",
  shotgun: "Shotgun",
  sniper: "Sniper Rifle",
  threadDagger: "Saboteur Thread Daggers",
  lance: "Lance",
  whip: "Whip",
  gauntlet: "Gauntlets",
  wand: "Channeling Weapons",
  staff: "Channeling Weapons",
  scythe: "Scythe",
  scissors: "Giant Scissors",
  pickaxe: "Pickaxe",
  hori: "Hori",
  sickle: "Sickle",
  smithHammer: "Smith's Hammer"
});

const ARMOR_PROFICIENCIES = Object.freeze({
  light: "Light Armor",
  medium: "Medium Armor",
  heavy: "Heavy Armor",
  shield: "Shields",
  greatshield: "Greatshields"
});

function numberFrom(value) {
  const match = String(value ?? "").replaceAll(",", "").match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function commonSystem(system) {
  return {
    description: system.description ?? "",
    source: system.source ?? "",
    sourceUrl: system.sourceUrl ?? "",
    sourceHash: system.sourceHash ?? "",
    rulebookVersion: system.rulebookVersion ?? "",
    stableId: system.stableId ?? "",
    relationships: system.relationships ?? {}
  };
}

function flagsWithReference(data) {
  const flags = structuredClone(data.flags ?? {});
  flags["lyrian-chronicles"] ??= {};
  flags["lyrian-chronicles"].officialEquipment = {
    sourceItemId: data._id ?? "",
    category: data.system?.category ?? "",
    subType: data.system?.subType ?? "",
    cost: data.system?.cost ?? "",
    burden: data.system?.burden ?? ""
  };
  return flags;
}

function hasProficiency(values, expected) {
  if (!expected) return true;
  const expectedKey = proficiencyKey(expected);
  return values.some((value) => proficiencyKey(value) === expectedKey);
}

function weaponGroup(name) {
  return WEAPON_GROUPS.find(([pattern]) => pattern.test(name))?.[1] ?? "improvised";
}

function armorCategory(name) {
  if (/^armor \(clothing\)$/i.test(name)) return "clothing";
  if (/^armor \(light\)$/i.test(name)) return "light";
  if (/^armor \(medium\)$/i.test(name)) return "medium";
  if (/^armor \(heavy\)$/i.test(name)) return "heavy";
  if (/^shield \(great\)$/i.test(name)) return "greatshield";
  if (/^shield$/i.test(name)) return "shield";
  return null;
}

/** True when an official reference entry represents an equippable weapon. */
export function isOfficialWeapon(data) {
  return /weapon/i.test(data?.system?.subType ?? "");
}

/**
 * Convert a generic official compendium entry into the sheet's automated type.
 * Unknown and consumable entries become Gear so they remain lossless and usable.
 */
export function convertOfficialEquipment(data, proficiencies = {}) {
  if (data?.type !== "equipment") return null;
  const system = data.system ?? {};
  const base = {
    name: data.name,
    img: data.img,
    flags: flagsWithReference(data)
  };
  const burden = numberFrom(system.burden);
  const value = numberFrom(system.cost);
  const armor = armorCategory(data.name ?? "");

  if (armor) {
    return {
      ...base,
      type: "armor",
      system: {
        ...commonSystem(system),
        category: armor,
        equipped: Boolean(system.equipped),
        proficient: armor === "clothing"
          || hasProficiency(proficiencies.armor ?? [], ARMOR_PROFICIENCIES[armor]),
        guardBonus: 0,
        blockBonus: 0,
        burden,
        value,
        modification: ""
      }
    };
  }

  if (isOfficialWeapon(data)) {
    const group = weaponGroup(data.name ?? "");
    return {
      ...base,
      type: "weapon",
      system: {
        ...commonSystem(system),
        group,
        hands: /two-handed/i.test(data.name ?? "") ? "two" : "one",
        damageType: "physical",
        equipped: Boolean(system.equipped),
        proficient: hasProficiency(proficiencies.weapons ?? [], WEAPON_PROFICIENCIES[group]),
        offHand: false,
        accuracyBonus: 0,
        damageBonus: 0,
        critThreshold: 20,
        rangeOverride: 0,
        burden,
        value,
        enchantment: "",
        poison: { name: "", hitsRemaining: 0 }
      }
    };
  }

  return {
    ...base,
    type: "gear",
    system: {
      ...commonSystem(system),
      quantity: numberFrom(system.quantity) || 1,
      burden,
      value,
      combatItem: burden > 0,
      isKit: /\bkit\b/i.test(system.subType ?? ""),
      materialType: system.category === "Crafting" ? system.subType ?? "" : "",
      units: 0
    }
  };
}
