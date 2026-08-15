/**
 * Persisted document schema revisions are independent from package releases.
 * Increase only the affected document type when its stored `system` shape
 * changes, then add a migration step before stamping the new revision.
 */
export const DOCUMENT_SCHEMA_VERSIONS = Object.freeze({
  Actor: 1,
  Item: 1
});

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
