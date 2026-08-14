import { forEachDocument } from "./migrate.mjs";

/** 0.5.1 — hydrate race stat and restricted racial skill automation. */
export async function runMigration() {
  const pack = game.packs.get("lyrian-chronicles.races");
  if (!pack) return;

  const index = await pack.getIndex({
    fields: ["system.stableId", "flags.lyrian-chronicles.stableId"]
  });
  const sources = new Map();
  for (const entry of index) {
    const stableId = entry.system?.stableId ??
      foundry.utils.getProperty(entry, "flags.lyrian-chronicles.stableId");
    if (!stableId) continue;
    const document = await pack.getDocument(entry._id);
    if (document) sources.set(stableId, document);
  }

  await forEachDocument("Item", async (item) => {
    if (item.type !== "race" || !item.parent) return;
    const stableId = item.system.stableId ?? item.getFlag("lyrian-chronicles", "stableId");
    const source = sources.get(stableId);
    if (!source) return;
    await item.update({
      "system.attributeBonuses": foundry.utils.deepClone(source.system.attributeBonuses ?? {}),
      "system.skillGrant": foundry.utils.deepClone(source.system.skillGrant ?? {}),
      "system.relationships": foundry.utils.deepClone(source.system.relationships ?? {}),
      "system.variants": foundry.utils.deepClone(source.system.variants ?? [])
    });
  });

  for (const actor of game.actors.filter((entry) => entry.type === "character")) {
    await actor.syncProgressionFeatures?.();
  }
}
