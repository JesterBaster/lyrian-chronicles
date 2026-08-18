/**
 * Persisted document schema revisions are independent from package releases.
 * Increase only the affected document type when its stored `system` shape
 * changes, then add a migration step before stamping the new revision.
 */
export const DOCUMENT_SCHEMA_VERSIONS = Object.freeze({
  Actor: 2,
  Item: 1
});

/**
 * Whether a document belongs to one of the system's own shipped packs.
 *
 * Pack content is stamped at the current revision when it is built, so every
 * historical migration necessarily finds it ahead of the baseline that
 * migration froze at. That is expected and says nothing is wrong — unlike a
 * *world* document being ahead, which means the system was rolled back and is
 * worth seeing. Reporting them the same way buried the second under one line
 * per shipped monster.
 */
export function isSystemPackDocument(document, systemId = "lyrian-chronicles") {
  return typeof document?.pack === "string" && document.pack.startsWith(`${systemId}.`);
}

/**
 * Collect documents a migration left alone for being ahead of its baseline.
 * World documents are reported individually; shipped pack content is counted
 * and summarized in a single line.
 */
export function schemaPreservationReporter(version) {
  let shipped = 0;

  return {
    preserve(documentName, document, current) {
      if (isSystemPackDocument(document)) {
        shipped += 1;
        return;
      }
      console.warn(
        `Lyrian Chronicles | Preserving future ${documentName} schema ${current} on ${document.uuid}`
      );
    },
    summarize() {
      if (!shipped) return;
      console.log(
        `Lyrian Chronicles | ${version}: left ${shipped} shipped compendium documents at their own schema revision`
      );
    }
  };
}

export function normalizeSchemaVersion(value) {
  const version = Number(value);
  return Number.isInteger(version) && version >= 0 ? version : 0;
}

export function currentDocumentSchemaVersion(documentName) {
  const version = DOCUMENT_SCHEMA_VERSIONS[documentName];
  if (!version) throw new Error(`Unsupported Lyrian document type: ${documentName}`);
  return version;
}

/** Plan a monotonic per-document migration without mutating the document. */
export function planDocumentSchemaMigration(documentName, sourceVersion) {
  const current = normalizeSchemaVersion(sourceVersion);
  const target = currentDocumentSchemaVersion(documentName);
  if (current > target) return { status: "future", current, target, update: null };
  if (current === target) return { status: "current", current, target, update: null };
  return {
    status: "pending",
    current,
    target,
    update: { "system.schemaVersion": target }
  };
}

/** New documents start current, while future-version imports are never downgraded. */
export function schemaVersionForCreation(documentName, sourceVersion) {
  const current = normalizeSchemaVersion(sourceVersion);
  const target = currentDocumentSchemaVersion(documentName);
  return current > target ? current : target;
}

/** Stamp source data used for compendium create/update operations. */
export function stampDocumentSourceSchema(documentName, source) {
  if (!(documentName in DOCUMENT_SCHEMA_VERSIONS)) return source;
  return {
    ...source,
    system: {
      ...(source.system ?? {}),
      schemaVersion: schemaVersionForCreation(documentName, source.system?.schemaVersion)
    }
  };
}
