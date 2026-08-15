import { forEachDocument } from "./migrate.mjs";
import { planDocumentSchemaMigration } from "../module/rules/schema-versioning.mjs";

/**
 * 0.6.14 — establish independent persisted schema revisions for every Actor
 * and Item. Earlier package migrations already normalized the stored fields;
 * this migration records that each surviving document now matches baseline 1.
 */
export async function runMigration() {
  for (const documentName of ["Actor", "Item"]) {
    await forEachDocument(documentName, async (document) => {
      const plan = planDocumentSchemaMigration(documentName, document.system?.schemaVersion);
      if (plan.status === "future") {
        console.warn(
          `Lyrian Chronicles | Preserving future ${documentName} schema ${plan.current} on ${document.uuid}`
        );
        return;
      }
      if (plan.update) await document.update(plan.update);
    }, { includeLockedSystemPacks: true });
  }
}
