import { forEachDocument } from "./migrate.mjs";

/** 0.5.3 — add character identity and worship fields. */
export async function runMigration() {
  await forEachDocument("Actor", async (actor) => {
    if (actor.type !== "character") return;
    const details = actor.system.details ?? {};
    await actor.update({
      "system.details.gender": details.gender ?? "",
      "system.details.age": details.age ?? "",
      "system.details.height": details.height ?? "",
      "system.details.weight": details.weight ?? "",
      "system.details.worship": details.worship ?? ""
    });
  });
}
