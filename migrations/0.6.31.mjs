import { forEachDocument } from "./migrate.mjs";

/**
 * 0.6.31 — give every actor a purse.
 *
 * `clim` used to live on characters alone, so an NPC had nowhere to keep coin
 * and a trade with a shopkeeper could only ever move money one way. The field
 * is additive with a default of zero, so the DataModel fills it in on read;
 * backfilling the stored source keeps an NPC written before the change
 * round-tripping identically to one written after it.
 *
 * Characters are left untouched: they already store their own value, and
 * writing a default over it would empty every purse in the world.
 */
export async function runMigration() {
  await forEachDocument("Actor", async (actor) => {
    const source = actor._source?.system ?? {};
    if (typeof source.clim === "number") return;
    await actor.update({ "system.clim": 0 });
  }, { includeLockedSystemPacks: true });
}
