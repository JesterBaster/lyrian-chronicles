/**
 * Matching for the creation wizard's pick-list search boxes.
 *
 * Kept out of the application class so the semantics — trimmed, case
 * insensitive, substring rather than prefix — are pinned by tests rather than
 * only observable by typing into a live sheet.
 */

/** Normalize a typed query. An all-whitespace query matches everything. */
export function normalizeSearchQuery(value) {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * Whether one entry's name satisfies the query.
 * An empty query matches, so clearing the box restores the full list.
 */
export function matchesSearch(name, query) {
  const needle = normalizeSearchQuery(query);
  if (!needle) return true;
  return String(name ?? "").toLowerCase().includes(needle);
}
