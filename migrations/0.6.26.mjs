import { forEachDocument } from "./migrate.mjs";
import { normalizeCraftProject } from "../module/rules/crafting.mjs";

/**
 * 0.6.26 — crafting projects gain a custom output and an install list.
 *
 * The new keys all carry schema defaults, so a stored project without them
 * still loads. Rewriting them here keeps `_source` and the cleaned data in
 * step, which matters because the sheet reads projects straight off `_source`
 * when it rebuilds the whole array on every edit.
 */
export async function runMigration() {
  await forEachDocument("Actor", async (actor) => {
    if (actor.type !== "character") return;

    const projects = actor._source?.system?.crafting?.projects;
    if (!Array.isArray(projects) || !projects.length) return;

    const needsBackfill = projects.some((project) => project?.customType === undefined
      || project?.customName === undefined
      || !Array.isArray(project?.mods));
    if (!needsBackfill) return;

    await actor.update({
      "system.crafting.projects": projects.map((project) => normalizeCraftProject(project))
    });
  }, { includeLockedSystemPacks: true });
}
