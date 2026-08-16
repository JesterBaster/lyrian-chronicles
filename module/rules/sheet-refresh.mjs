const HEADER_RESOURCES = ["hp", "mana", "ap", "rp"];

/**
 * Return whether an Actor update changes a resource shown in the persistent
 * sheet header. Foundry may provide either nested or flattened update data.
 */
export function actorHeaderNeedsRefresh(changes = {}) {
  const system = changes.system;
  return HEADER_RESOURCES.some((resource) =>
    Object.hasOwn(changes, `system.${resource}`) ||
    Object.hasOwn(changes, `system.${resource}.value`) ||
    Object.hasOwn(changes, `system.${resource}.temp`) ||
    Object.hasOwn(changes, `system.${resource}.max`) ||
    (system && Object.hasOwn(system, resource))
  );
}

/** True when ApplicationV2 requested only the persistent actor-sheet header. */
export function isHeaderOnlyRender(options = {}) {
  const parts = Array.from(options.parts ?? []);
  return parts.length === 1 && parts[0] === "header";
}
