import { forEachDocument } from "./migrate.mjs";
import {
  normalizeSchemaVersion,
  schemaPreservationReporter
} from "../module/rules/schema-versioning.mjs";

/**
 * 0.6.14 — establish independent persisted schema revisions for every Actor
 * and Item. Earlier package migrations already normalized the stored fields;
 * this migration records that each surviving document now matches baseline 1.
 */
export async function runMigration() {
  const report = schemaPreservationReporter("0.6.14");
  for (const documentName of ["Actor", "Item"]) {
    await forEachDocument(documentName, async (document) => {
      const current = normalizeSchemaVersion(document.system?.schemaVersion);
      if (current > 1) {
        report.preserve(documentName, document, current);
        return;
      }
      if (current < 1) await document.update({ "system.schemaVersion": 1 });
    }, { includeLockedSystemPacks: true });
  }
  report.summarize();
}
