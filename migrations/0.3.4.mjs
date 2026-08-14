import { forEachDocument } from "./migrate.mjs";

/**
 * 0.3.4 — a skill held one expertise; it now holds a list of named ones.
 *
 * The old `expertise` and `expertiseRank` keys no longer exist on the schema,
 * so they are read from _source rather than the prepared document, and deleted
 * afterwards with the -= prefix so they do not linger in the database.
 */
export async function runMigration() {
  await forEachDocument("Actor", async (actor) => {
    if (actor.type !== "character") return;

    const update = {};

    for (const group of ["skills", "artisan"]) {
      const source = actor._source?.system?.[group] ?? {};

      for (const [key, skill] of Object.entries(source)) {
        const name = skill.expertise;
        const rank = skill.expertiseRank;
        if (name === undefined && rank === undefined) continue;

        // Only carry it over if it was actually used.
        const existing = Array.isArray(skill.expertises) ? skill.expertises : [];
        if (!existing.length && (name || rank)) {
          update[`system.${group}.${key}.expertises`] = [
            { name: name ?? "", rank: rank ?? 0 }
          ];
        }

        update[`system.${group}.${key}.-=expertise`] = null;
        update[`system.${group}.${key}.-=expertiseRank`] = null;
      }
    }

    if (Object.keys(update).length) await actor.update(update);
  });
}
