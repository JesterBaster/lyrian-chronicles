import { forEachDocument } from "./migrate.mjs";
import { dedupeProficiencies } from "../module/rules/proficiencies.mjs";

/** 0.5.2 — add languages and normalize duplicate manual proficiencies. */
export async function runMigration() {
  await forEachDocument("Actor", async (actor) => {
    if (actor.type !== "character") return;
    await actor.update({
      "system.proficiencies.weapons": dedupeProficiencies(actor.system.proficiencies?.weapons, "weapons"),
      "system.proficiencies.armor": dedupeProficiencies(actor.system.proficiencies?.armor, "armor"),
      "system.proficiencies.languages": dedupeProficiencies(actor.system.proficiencies?.languages, "languages")
    });
  });
}
