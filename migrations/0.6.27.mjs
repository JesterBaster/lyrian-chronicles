import { forEachDocument } from "./migrate.mjs";

/**
 * 0.6.27 — add the optional healing payload to abilities.
 *
 * The fields are additive with defaults, so the DataModel fills them in on
 * read. This backfills the stored source anyway, so an ability written before
 * the change round-trips identically to one written after it, and a GM reading
 * raw item data does not see the key missing on some abilities and not others.
 */
export async function runMigration() {
  await forEachDocument("Item", async (item) => {
    if (item.type !== "ability" && item.type !== "monsterAbility") return;

    const source = item._source?.system ?? {};
    const update = {};
    if (typeof source.hasHealing !== "boolean") update["system.hasHealing"] = false;
    if (typeof source.healingFormula !== "string") update["system.healingFormula"] = "";
    if (Object.keys(update).length) await item.update(update);
  }, { includeLockedSystemPacks: true });
}
