import { forEachDocument } from "./migrate.mjs";

/** 0.5.5 — remove duplicate generated race and class abilities. */
export async function runMigration() {
  await forEachDocument("Actor", async (actor) => {
    if (actor.type !== "character") return;
    await actor.syncProgressionFeatures?.();
  });
}
