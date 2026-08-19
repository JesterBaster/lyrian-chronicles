function whole(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

/**
 * Item types a project may forge from scratch.
 *
 * Anything else — abilities, classes, races — is granted by progression rather
 * than crafted, so allowing them here would produce items no rule can price.
 */
export const CUSTOM_OUTPUT_TYPES = Object.freeze(["weapon", "armor", "gear"]);

/** Return a serializable crafting project with safe schema defaults. */
export function normalizeCraftProject(project = {}) {
  const customType = String(project.customType ?? "");
  return {
    name: String(project.name ?? ""),
    skill: String(project.skill ?? "blacksmith"),
    dc: whole(project.dc, 15),
    materials: Array.from(project.materials ?? [], (material) => ({
      itemId: String(material?.itemId ?? ""),
      quantity: Math.max(0, whole(material?.quantity, 0))
    })),
    mods: Array.from(project.mods ?? [], (mod) => ({
      itemId: String(mod?.itemId ?? "")
    })),
    outputUuid: String(project.outputUuid ?? ""),
    outputName: String(project.outputName ?? ""),
    customType: CUSTOM_OUTPUT_TYPES.includes(customType) ? customType : "",
    customName: String(project.customName ?? ""),
    attempts: Math.max(0, whole(project.attempts, 0)),
    completed: Boolean(project.completed)
  };
}

function ownedItem(items, itemId) {
  if (typeof items?.get === "function") return items.get(itemId);
  return Array.from(items ?? []).find((item) => item?.id === itemId);
}

/**
 * Validate and aggregate material consumption without mutating documents.
 * Repeated rows for the same stack are combined before availability is tested.
 */
export function planCraftMaterials({ materials = [], items = [], consume = true } = {}) {
  if (!consume) return { ok: true, shortages: [], updates: [], spent: [] };

  const required = new Map();
  for (const line of materials) {
    const itemId = String(line?.itemId ?? "");
    const quantity = Math.max(0, whole(line?.quantity, 0));
    if (!itemId || !quantity) continue;
    required.set(itemId, (required.get(itemId) ?? 0) + quantity);
  }

  const shortages = [];
  const updates = [];
  const spent = [];
  for (const [itemId, quantity] of required) {
    const item = ownedItem(items, itemId);
    const available = item?.type === "gear"
      ? Math.max(0, whole(item.system?.quantity, 0))
      : 0;
    if (!item || item.type !== "gear" || available < quantity) {
      shortages.push({
        itemId,
        name: item?.name ?? itemId,
        required: quantity,
        available
      });
      continue;
    }
    updates.push({ _id: item.id, "system.quantity": available - quantity });
    spent.push({ itemId: item.id, name: item.name, quantity });
  }

  return { ok: shortages.length === 0, shortages, updates, spent };
}

/**
 * Decide what a successful attempt should create.
 *
 * A project either copies a linked document, forges a bare item of a chosen
 * type, or does both — a linked base renamed by `customName` is how a player
 * makes "their" longsword rather than a stock one. Stats on a forged item are
 * left at their schema defaults and edited on the item sheet afterwards;
 * inventing values here would invent balance the rulebook does not set.
 */
export function resolveCraftOutput({ project = {}, base = null, fallbackName = "" } = {}) {
  const customName = String(project.customName ?? "").trim();

  if (base?.toObject) {
    const data = base.toObject();
    delete data._id;
    if (customName) data.name = customName;
    return { ok: true, data, custom: Boolean(customName), fromBase: true };
  }

  const customType = String(project.customType ?? "");
  if (CUSTOM_OUTPUT_TYPES.includes(customType)) {
    const name = customName || String(project.name ?? "").trim() || fallbackName;
    return {
      ok: true,
      custom: true,
      fromBase: false,
      data: { name, type: customType, system: {} }
    };
  }

  return { ok: false, custom: false, fromBase: false, data: null };
}

/**
 * Resolve the owned Mods a project installs into its result.
 *
 * Rows naming a stack that is no longer carried are reported rather than
 * silently dropped, so a stale project does not quietly forge a bare item.
 * A Mod that does not fit what is being made is reported the same way: the
 * output is checked before any material is spent, because installing an
 * armour Mod into a sword is not a thing the rules allow.
 *
 * @param {object}   [options]
 * @param {object[]} [options.mods]     The project's mod rows.
 * @param {object[]} [options.items]    Everything the actor owns.
 * @param {object}   [options.output]   The item data a success would create.
 * @param {(mod: object, target: object) => boolean} [options.isCompatible]
 */
export function planCraftMods({
  mods = [],
  items = [],
  output = null,
  isCompatible = null
} = {}) {
  const missing = [];
  const incompatible = [];
  const resolved = [];
  const seen = new Set();

  for (const line of mods) {
    const itemId = String(line?.itemId ?? "");
    if (!itemId) continue;
    const item = ownedItem(items, itemId);
    if (!item) {
      missing.push({ itemId, name: itemId });
      continue;
    }
    // One stack installs once. A row repeated by a mis-click would otherwise
    // install the same Mod twice and consume a stack that is not there.
    if (seen.has(itemId)) continue;
    seen.add(itemId);
    if (output && isCompatible && !isCompatible(item, output)) {
      incompatible.push({ itemId, name: item.name ?? itemId });
      continue;
    }
    resolved.push(item);
  }

  return {
    ok: missing.length === 0 && incompatible.length === 0,
    missing,
    incompatible,
    mods: resolved
  };
}

/** Build the stable payload stored on craft chat messages and emitted by the hook. */
export function buildCraftPayload({
  actorUuid,
  projectIndex,
  project,
  skillLabel,
  roll,
  success,
  materials,
  consumed,
  mods = [],
  custom = false,
  outputType = ""
}) {
  return {
    actorUuid,
    projectIndex,
    projectName: project.name,
    skill: project.skill,
    skillLabel,
    dc: project.dc,
    roll: { total: roll.total, formula: roll.formula },
    success: Boolean(success),
    materials: Array.from(materials ?? [], ({ itemId, name, quantity }) => ({
      itemId, name, quantity
    })),
    consumed: Boolean(consumed),
    outputUuid: project.outputUuid,
    outputName: project.outputName,
    custom: Boolean(custom),
    outputType: String(outputType ?? ""),
    mods: Array.from(mods ?? [], ({ id, name }) => ({ itemId: id, name })),
    attempts: project.attempts
  };
}
