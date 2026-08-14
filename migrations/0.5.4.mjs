import { forEachDocument } from "./migrate.mjs";
import { collectActorProficiencies } from "../module/rules/proficiencies.mjs";
import { convertOfficialEquipment } from "../module/rules/equipment-import.mjs";

/** 0.5.4 — convert generic official equipment into automated inventory types. */
export async function runMigration() {
  await forEachDocument("Actor", async (actor) => {
    if (actor.type !== "character") return;
    const originals = actor.items.filter((item) => item.type === "equipment");
    if (!originals.length) return;

    const proficiency = collectActorProficiencies(actor).groups;
    const context = {
      weapons: proficiency.weapons.map((entry) => entry.name),
      armor: proficiency.armor.map((entry) => entry.name)
    };
    const alreadyConverted = new Set(actor.items
      .filter((item) => item.type !== "equipment")
      .map((item) => item.getFlag("lyrian-chronicles", "officialEquipment")?.sourceItemId)
      .filter(Boolean));
    const pending = originals.filter((item) => !alreadyConverted.has(item.id));
    const converted = pending
      .map((item) => convertOfficialEquipment(item.toObject(), context))
      .filter(Boolean);

    // Persist every replacement before removing the old reference documents.
    const created = converted.length
      ? await actor.createEmbeddedDocuments("Item", converted)
      : [];
    if (created.length !== pending.length) {
      if (created.length) {
        await actor.deleteEmbeddedDocuments("Item", created.map((item) => item.id));
      }
      throw new Error(`Created ${created.length} of ${pending.length} converted inventory items.`);
    }
    await actor.deleteEmbeddedDocuments("Item", originals.map((item) => item.id));
  });
}
