export const HYBRID_TYPES = Object.freeze({
  faerieChimera: Object.freeze({
    key: "faerieChimera",
    name: "Faerie-Chimera Hybrid (Race)",
    displayName: "Faerie-Chimera Hybrid",
    breakthroughStableId: "breakthrough--faerie-chimera-hybrid-race",
    cost: 200,
    primaryRaces: Object.freeze(["Fae", "Chimera"])
  }),
  humanChimera: Object.freeze({
    key: "humanChimera",
    name: "Human-Chimera Hybrid (Race)",
    displayName: "Human-Chimera Hybrid",
    breakthroughStableId: "breakthrough--human-chimera-hybrid-race",
    cost: 200,
    primaryRaces: Object.freeze(["Human"])
  })
});

export const HYBRID_BREAKTHROUGH_IDS = Object.freeze(
  Object.values(HYBRID_TYPES).map((rule) => rule.breakthroughStableId)
);

/** Return one supported Hybrid rule, or null for a normal race choice. */
export function hybridRule(type) {
  return HYBRID_TYPES[type] ?? null;
}

/** True when one Breakthrough is restricted to the character-creation Hybrid flow. */
export function isHybridBreakthrough(item) {
  const stableId = item?.system?.stableId ?? item?.stableId ?? "";
  return HYBRID_BREAKTHROUGH_IDS.includes(stableId);
}

/** The ancestry family a Hybrid must choose for the selected primary race. */
export function hybridAncestryFamily(type, primaryRace) {
  if (type === "humanChimera" && primaryRace === "Human") return "Chimera";
  if (type === "faerieChimera" && primaryRace === "Fae") return "Chimera";
  if (type === "faerieChimera" && primaryRace === "Chimera") return "Fae";
  return "";
}

/** Validate the complete rule choice without depending on Foundry documents. */
export function validateHybridSelection({ type, primaryRace, ancestryPrimaryRace, budget } = {}) {
  const rule = hybridRule(type);
  if (!rule) return { valid: false, reason: "type" };
  if (!rule.primaryRaces.includes(primaryRace)) return { valid: false, reason: "primary" };
  if (hybridAncestryFamily(type, primaryRace) !== ancestryPrimaryRace) {
    return { valid: false, reason: "ancestry" };
  }
  if ((Number(budget) || 0) < rule.cost) return { valid: false, reason: "budget" };
  return { valid: true, reason: "" };
}

function cloneData(data) {
  return structuredClone(data ?? {});
}

function withoutStableId(values, stableId) {
  return Array.from(values ?? []).filter((value) => value !== stableId);
}

/** Apply Hybrid exceptions to the owned primary-race copy. */
export function prepareHybridPrimaryData(data, type) {
  const out = cloneData(data);
  const system = out.system ??= {};
  const relationships = system.relationships ??= {};

  if (type === "humanChimera") {
    const adaptability = "ability--human-adaptability";
    system.ambition = "";
    system.ambitionExp = 0;
    relationships.abilities = withoutStableId(relationships.abilities, adaptability);
    relationships._links = Array.from(relationships._links ?? [])
      .filter((link) => link.stableId !== adaptability);
  }

  if (type === "faerieChimera" && out.name === "Chimera") {
    system.grantedProficiencies = "You can speak, read and write Common and Sylvan.";
  }
  return out;
}

/** Apply cross-race language and High Fae exceptions to the owned ancestry copy. */
export function prepareHybridAncestryData(data, { type, primaryRace, faerieFlashLink } = {}) {
  const out = cloneData(data);
  const system = out.system ??= {};

  if (type === "faerieChimera" && primaryRace === "Fae") {
    system.grantedProficiencies = "You gain the special dialect of your Chimera subrace.";
  }

  if (type === "faerieChimera" && primaryRace === "Chimera" && out.name === "High Fae") {
    const relationships = system.relationships ??= {};
    const upgraded = "ability--faerie-flash-ii";
    const base = "ability--faerie-flash";
    relationships.traits = Array.from(relationships.traits ?? [])
      .map((stableId) => stableId === upgraded ? base : stableId);
    relationships._links = Array.from(relationships._links ?? [])
      .filter((link) => link.stableId !== upgraded && link.stableId !== base);
    if (faerieFlashLink) relationships._links.push(cloneData(faerieFlashLink));
  }
  return out;
}

/** Stable metadata placed on the owned primary race for later validation/display. */
export function hybridRaceFlag(type, primaryRace, ancestry) {
  const rule = hybridRule(type);
  if (!rule) return null;
  return {
    type,
    displayName: rule.displayName,
    breakthroughStableId: rule.breakthroughStableId,
    primaryRace,
    ancestry,
    ancestryPrimaryRace: hybridAncestryFamily(type, primaryRace)
  };
}
