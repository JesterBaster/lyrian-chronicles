import { forEachDocument } from "./migrate.mjs";

/**
 * 0.3.1 — temp pools were added to AP and RP, and pools gained derived totals.
 * Documents from 0.2.x have no `temp` key on ap/rp, which the schema fills with
 * 0 on load; this writes it through so stored data matches.
 *
 * Numbered 0.3.1 rather than 0.3.0 deliberately. A separate 0.3.0 build exists,
 * and any world stamped "0.3.0" would skip a migration of that same name.
 */
export async function runMigration() {
  await forEachDocument("Actor", async (actor) => {
    const update = {};
    if (actor.system.ap?.temp === undefined) update["system.ap.temp"] = 0;
    if (actor.system.rp?.temp === undefined) update["system.rp.temp"] = 0;
    if (Object.keys(update).length) await actor.update(update);
  });
}
