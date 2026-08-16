const SYSTEM_ID = "lyrian-chronicles";

/** True when an official equipment reference is a crafting Mod. */
export function isCraftingMod(item) {
  return item?.type === "equipment"
    && item.system?.category === "Crafting Mods"
    && Boolean(item.system?.modSlot);
}

/** Normalize display-name variants used by the approved Mod target lists. */
export function normalizeModTargetName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[’']/g, "")
    .replace(/\bshepards?\b/gi, "shepherd")
    .replace(/\bshepherds?\b/gi, "shepherd")
    .replace(/\bcamoflage\b/gi, "camouflage")
    .replace(/\bcross[ -]?bow\b/gi, "crossbow")
    .replace(/\bone[ -]?handed\b/gi, "one handed")
    .replace(/\btwo[ -]?handed\b/gi, "two handed")
    .replace(/\(treated as[^)]*\)/gi, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function targetAliases(item) {
  const aliases = new Set([normalizeModTargetName(item?.name)]);
  if (/^cannon \(two-handed\)$/i.test(item?.name ?? "")) {
    aliases.add(normalizeModTargetName("Cannon"));
  }
  if (/^chainsaw artifice \(two-handed weapon\)$/i.test(item?.name ?? "")) {
    aliases.add(normalizeModTargetName("Chainsaw"));
  }
  if (/^longsword \(one-handed\/two-handed\)$/i.test(item?.name ?? "")) {
    aliases.add(normalizeModTargetName("Longsword (Versatile)"));
  }
  if (item?.type === "armor") {
    const categories = {
      clothing: ["Clothing", "Armor (Clothing)"],
      light: ["Light Armor", "Armor (Light)"],
      medium: ["Medium Armor", "Armor (Medium)"],
      heavy: ["Heavy Armor", "Armor (Heavy)"],
      shield: ["Shield"],
      greatshield: ["Greatshield", "Great Shield", "Shield (Great)"]
    };
    for (const alias of categories[item.system?.category] ?? []) {
      aliases.add(normalizeModTargetName(alias));
    }
  }
  return aliases;
}

function isInstalledMod(item) {
  return Boolean(item?.getFlag?.(SYSTEM_ID, "installedMod")
    ?? item?.flags?.[SYSTEM_ID]?.installedMod);
}

/** Determine whether one owned Item is a valid installation target. */
export function isCompatibleModTarget(mod, target) {
  if (!target || isInstalledMod(target)) return false;
  const craftingType = String(mod?.system?.craftingType ?? "");

  if (craftingType === "Universal Weapon") return target.type === "weapon";
  if (craftingType === "Universal Armor") {
    return target.type === "armor"
      && ["clothing", "light", "medium", "heavy"].includes(target.system?.category);
  }
  if (craftingType === "Universal Artifice") {
    const official = target.getFlag?.(SYSTEM_ID, "officialEquipment")
      ?? target.flags?.[SYSTEM_ID]?.officialEquipment;
    return /artifice/i.test(official?.category ?? "");
  }

  const allowed = mod?.system?.compatibleTargets ?? [];
  if (!allowed.length) return false;
  const aliases = targetAliases(target);
  return allowed.some((name) => aliases.has(normalizeModTargetName(name)));
}

/** Return all compatible owned targets without changing their order. */
export function compatibleModTargets(mod, items) {
  return Array.from(items ?? []).filter((item) => isCompatibleModTarget(mod, item));
}

/** Serializable association stored on the installed embedded Mod copy. */
export function installedModFlag(mod, target) {
  return {
    targetItemId: target.id,
    targetName: target.name,
    slot: mod.system?.modSlot ?? "",
    craftingType: mod.system?.craftingType ?? "",
    compatibleTargets: Array.from(mod.system?.compatibleTargets ?? []),
    stableId: mod.system?.stableId ?? "",
    sourceUuid: mod.uuid ?? ""
  };
}
