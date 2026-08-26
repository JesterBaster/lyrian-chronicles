import { forEachDocument } from "./migrate.mjs";

/**
 * 0.6.40 — crafting projects gain a tool's two bonuses.
 *
 * The source spreadsheet prices crafting tools with a crafting bonus ("+1 (or
 * +2) to each crafting dice roll") and a finish bonus ("+5 (or +10) once at
 * the end of your craft"). Neither existed on a project, so a player using a
 * Tamahagane hammer had nowhere to record it.
 *
 * Both backfill to 0, which is exactly what a project crafted bare-handed
 * gets — no existing craft changes value.
 */
export async function runMigration() {
  await forEachDocument("Actor", async (actor) => {
    if (actor.type !== "character") return;
    const projects = actor._source?.system?.crafting?.projects;
    if (!Array.isArray(projects) || !projects.length) return;

    let changed = false;
    const migrated = projects.map((project) => {
      const next = { ...project };
      if (typeof next.diceBonus !== "number") { next.diceBonus = 0; changed = true; }
      if (typeof next.finishBonus !== "number") { next.finishBonus = 0; changed = true; }
      return next;
    });

    if (changed) await actor.update({ "system.crafting.projects": migrated });
  }, { includeLockedSystemPacks: true });
}
