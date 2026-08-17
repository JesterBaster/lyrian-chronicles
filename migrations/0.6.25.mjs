import { forEachDocument } from "./migrate.mjs";
import { planDocumentSchemaMigration } from "../module/rules/schema-versioning.mjs";

/** 0.6.25 — add persistent free-form crafting projects to characters. */
export async function runMigration() {
  await forEachDocument("Actor", async (actor) => {
    const plan = planDocumentSchemaMigration("Actor", actor.system?.schemaVersion);
    if (plan.status === "future") {
      console.warn(
        `Lyrian Chronicles | Preserving future Actor schema ${plan.current} on ${actor.uuid}`
      );
      return;
    }

    const update = { ...(plan.update ?? {}) };
    const sourceProjects = actor._source?.system?.crafting?.projects;
    if (actor.type === "character" && !Array.isArray(sourceProjects)) {
      update["system.crafting.projects"] = [];
    }
    if (Object.keys(update).length) await actor.update(update);
  }, { includeLockedSystemPacks: true });
}
