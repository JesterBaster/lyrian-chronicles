/**
 * Schema migrations.
 *
 * Foundry records the system version a world was last opened with. When that is
 * older than the current version, every migration between the two runs in order.
 * Without this, changing a field in module/data/ silently strands documents that
 * were created before the change.
 *
 * Adding a migration:
 *   1. Create migrations/<version>.mjs exporting `runMigration()`.
 *   2. Append that version string to VERSIONS below, in order.
 *
 * Never delete an old migration. A world can sit unopened for a year and needs
 * to walk every step from where it stopped.
 */

/** Every version that ships a migration, oldest first. */
const VERSIONS = [
  "0.3.1",
  "0.3.4",
  "0.5.0",
  "0.5.1",
  "0.5.2",
  "0.5.3",
  "0.5.4",
  "0.5.5"
];

/* -------------------------------------------- */

/**
 * Walk every document of a type that could hold stale system data.
 *
 * Iterating game.actors alone is not enough. Unlinked tokens carry their own
 * copy of actor data, and compendium documents are stored separately again —
 * miss either and a migration leaves half the world on the old schema.
 *
 * @param {"Actor"|"Item"} documentName
 * @param {(doc: Document) => Promise<void>} callback
 */
export async function forEachDocument(documentName, callback) {
  const collection = documentName === "Actor" ? game.actors : game.items;

  // 1. World documents.
  for (const doc of collection) await callback(doc);

  // 2. Unlinked tokens, which hold their own actor data rather than pointing at one.
  if (documentName === "Actor") {
    for (const scene of game.scenes) {
      for (const token of scene.tokens) {
        if (token.actorLink || !token.actor) continue;
        await callback(token.actor);
      }
    }
  }

  // 3. Embedded items on every actor reached above.
  if (documentName === "Item") {
    for (const actor of game.actors) {
      for (const item of actor.items) await callback(item);
    }
  }

  // 4. Unlocked compendiums belonging to this world or system.
  for (const pack of game.packs) {
    if (pack.documentName !== documentName) continue;
    if (pack.locked) continue;
    const documents = await pack.getDocuments();
    for (const doc of documents) await callback(doc);
  }
}

/* -------------------------------------------- */

/**
 * Decide what needs to run and run it. Called from a `ready` hook, GM only.
 * @param {string} systemId
 * @param {string} currentVersion
 */
export async function runMigrations(systemId, currentVersion) {
  if (!game.user.isGM) return;

  const last = game.settings.get(systemId, "lastMigration");
  const documentCount = game.actors.size + game.items.size + game.scenes.size;

  // A brand new world has nothing to migrate. Stamp it and move on.
  if (!last && documentCount === 0) {
    return game.settings.set(systemId, "lastMigration", currentVersion);
  }

  // A world predating migrations needs every script from the beginning.
  const startIndex = last ? VERSIONS.indexOf(last) : -1;
  const pending = VERSIONS.slice(startIndex + 1).filter(
    (v) => !foundry.utils.isNewerVersion(v, currentVersion)
  );

  if (!pending.length) {
    return game.settings.set(systemId, "lastMigration", currentVersion);
  }

  for (const version of pending) {
    const notice = ui.notifications.info(
      `Lyrian Chronicles: migrating to ${version}. Leave this window open.`,
      { permanent: true }
    );

    try {
      const migration = await import(`./${version}.mjs`);
      await migration.runMigration();
      await game.settings.set(systemId, "lastMigration", version);
      console.log(`Lyrian Chronicles | Migrated to ${version}`);
    } catch (err) {
      console.error(`Lyrian Chronicles | Migration ${version} failed`, err);
      ui.notifications.error(
        `Migration to ${version} failed. Restore a backup before continuing.`,
        { permanent: true }
      );
      return;
    } finally {
      ui.notifications.remove?.(notice);
    }
  }

  await game.settings.set(systemId, "lastMigration", currentVersion);
  ui.notifications.info("Lyrian Chronicles: migrations complete.");
}
