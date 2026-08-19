import { forEachDocument } from "./migrate.mjs";

/**
 * 0.6.28 — add the per-turn state block that tracks the dual wield window.
 *
 * The fields are additive with defaults, so the DataModel fills them in on
 * read. Backfilling the stored source anyway keeps an actor written before the
 * change round-tripping identically to one written after it, and means a GM
 * reading raw actor data does not see the key present on some actors only.
 */
export async function runMigration() {
  await forEachDocument("Actor", async (actor) => {
    const source = actor._source?.system ?? {};
    const turn = source.turn ?? {};
    const update = {};
    if (typeof turn.dualWieldOpenerId !== "string") {
      update["system.turn.dualWieldOpenerId"] = "";
    }
    if (typeof turn.dualWieldUsed !== "boolean") {
      update["system.turn.dualWieldUsed"] = false;
    }
    if (Object.keys(update).length) await actor.update(update);
  }, { includeLockedSystemPacks: true });
}
