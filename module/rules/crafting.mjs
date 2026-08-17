function whole(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

/** Return a serializable crafting project with safe schema defaults. */
export function normalizeCraftProject(project = {}) {
  return {
    name: String(project.name ?? ""),
    skill: String(project.skill ?? "blacksmith"),
    dc: whole(project.dc, 15),
    materials: Array.from(project.materials ?? [], (material) => ({
      itemId: String(material?.itemId ?? ""),
      quantity: Math.max(0, whole(material?.quantity, 0))
    })),
    outputUuid: String(project.outputUuid ?? ""),
    outputName: String(project.outputName ?? ""),
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

/** Build the stable payload stored on craft chat messages and emitted by the hook. */
export function buildCraftPayload({
  actorUuid,
  projectIndex,
  project,
  skillLabel,
  roll,
  success,
  materials,
  consumed
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
    attempts: project.attempts
  };
}
