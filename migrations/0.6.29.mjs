import { forEachDocument } from "./migrate.mjs";

/**
 * 0.6.29 — add the damage type an unarmed strike deals.
 *
 * A weapon carries its own type on the Item; the universal attack had nowhere
 * to keep one and was hardcoded to physical. The field is additive with a
 * default, so the DataModel fills it in on read. Backfilling the stored source
 * anyway keeps an actor written before the change round-tripping identically
 * to one written after it.
 */
export async function runMigration() {
  await forEachDocument("Actor", async (actor) => {
    const source = actor._source?.system ?? {};
    if (typeof source.universalDamageType === "string") return;
    await actor.update({ "system.universalDamageType": "physical" });
  }, { includeLockedSystemPacks: true });
}
