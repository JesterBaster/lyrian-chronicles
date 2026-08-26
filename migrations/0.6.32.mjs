import { forEachDocument } from "./migrate.mjs";

/**
 * 0.6.32 — crafting becomes a points accumulation rather than one roll.
 *
 * A project used to carry a DC and be settled by a single d10 check. The
 * rulebook runs a craft as a series of actions that add Crafting Points until
 * they reach the item's crafting HP, so a project now carries that target, a
 * Crafting Dice budget, and the state of the craft in progress.
 *
 * The old DC becomes the new target. It is the closest honest reading — a GM
 * who set 15 meant "moderately hard" — and it beats resetting every project
 * to a default, which would quietly retune work already planned.
 */
export async function runMigration() {
  await forEachDocument("Actor", async (actor) => {
    if (actor.type !== "character") return;
    const projects = actor._source?.system?.crafting?.projects;
    if (!Array.isArray(projects) || !projects.length) return;

    let changed = false;
    const migrated = projects.map((project) => {
      const next = { ...project };
      if (typeof next.requiredPoints !== "number") {
        next.requiredPoints = typeof project.dc === "number" ? project.dc : 30;
        changed = true;
      }
      if (typeof next.craftingDice !== "number") { next.craftingDice = 4; changed = true; }
      if (typeof next.points !== "number") { next.points = 0; changed = true; }
      if (typeof next.diceSpent !== "number") { next.diceSpent = 0; changed = true; }
      if (!Array.isArray(next.usedActions)) { next.usedActions = []; changed = true; }
      if (!Array.isArray(next.installedMods)) { next.installedMods = []; changed = true; }
      if (typeof next.finished !== "boolean") {
        // A project already marked complete is a craft that has ended.
        next.finished = Boolean(project.completed);
        changed = true;
      }
      delete next.dc;
      return next;
    });

    if (changed) await actor.update({ "system.crafting.projects": migrated });
  }, { includeLockedSystemPacks: true });
}
