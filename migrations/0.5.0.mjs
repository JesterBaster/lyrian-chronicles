import { forEachDocument } from "./migrate.mjs";

/** 0.5.0 — class progression now stores level 1–8 instead of steps 0–7. */
export async function runMigration() {
  const racePack = game.packs.get("lyrian-chronicles.races");
  const raceSources = new Map();
  if (racePack) {
    const index = await racePack.getIndex({
      fields: ["system.stableId", "flags.lyrian-chronicles.stableId"]
    });
    for (const entry of index) {
      const stableId = entry.system?.stableId ??
        foundry.utils.getProperty(entry, "flags.lyrian-chronicles.stableId");
      if (!stableId) continue;
      const document = await racePack.getDocument(entry._id);
      if (document) raceSources.set(stableId, document);
    }
  }

  await forEachDocument("Item", async (item) => {
    if (item.type === "class") {
      const oldStep = Number(item._source?.system?.abilitiesUnlocked ?? 0);
      const level = Math.max(1, Math.min(8, oldStep + 1));
      if (level !== oldStep) await item.update({ "system.abilitiesUnlocked": level });
      return;
    }

    if (item.type !== "race" || !item.parent) return;
    const stableId = item.system.stableId ?? item.getFlag("lyrian-chronicles", "stableId");
    const source = raceSources.get(stableId);
    if (!source) return;

    // Preserve choices made on the owned item while importing automation data
    // introduced in 0.5.0 from its official compendium source.
    await item.update({
      "system.ambitionExp": source.system.ambitionExp,
      "system.attributeBonuses": foundry.utils.deepClone(source.system.attributeBonuses ?? {}),
      "system.variants": foundry.utils.deepClone(source.system.variants ?? []),
      "system.relationships": foundry.utils.deepClone(source.system.relationships ?? {})
    });
  });

  for (const actor of game.actors.filter((entry) => entry.type === "character")) {
    await actor.syncProgressionFeatures?.();
  }
}
