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
import { pendingMigrationVersions } from "../module/rules/versioning.mjs";

const SYSTEM_ID = "lyrian-chronicles";

const VERSIONS = [
  "0.3.1",
  "0.3.4",
  "0.5.0",
  "0.5.1",
  "0.5.2",
  "0.5.3",
  "0.5.4",
  "0.5.5",
  "0.6.14",
  "0.6.25",
  "0.6.26"
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
 * @param {object} [options]
 * @param {boolean} [options.includeLockedSystemPacks=false]
 */
export async function forEachDocument(documentName, callback, { includeLockedSystemPacks = false } = {}) {
  if (!["Actor", "Item"].includes(documentName)) {
    throw new Error(`Unsupported migration document type: ${documentName}`);
  }

  const seen = new Set();
  let count = 0;
  const visit = async (document) => {
    if (!document || seen.has(document)) return;
    seen.add(document);
    count += 1;
    await callback(document);
  };

  const actors = [...game.actors];
  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      if (!token.actorLink && token.actor) actors.push(token.actor);
    }
  }

  if (documentName === "Actor") {
    for (const actor of actors) await visit(actor);
    for (const pack of game.packs) {
      if (pack.documentName !== "Actor") continue;
      await withMigratablePack(pack, includeLockedSystemPacks, async () => {
        for (const actor of await pack.getDocuments()) await visit(actor);
      });
    }
  } else {
    for (const item of game.items) await visit(item);
    for (const actor of actors) {
      for (const item of actor.items ?? []) await visit(item);
    }
    for (const pack of game.packs) {
      if (pack.documentName === "Actor") {
        await withMigratablePack(pack, includeLockedSystemPacks, async () => {
          for (const actor of await pack.getDocuments()) {
            for (const item of actor.items ?? []) await visit(item);
          }
        });
      }
      if (pack.documentName === "Item") {
        await withMigratablePack(pack, includeLockedSystemPacks, async () => {
          for (const item of await pack.getDocuments()) await visit(item);
        });
      }
    }
  }
  return count;
}

/** Visit unlocked packs plus locked system-owned packs, restoring their lock. */
async function withMigratablePack(pack, includeLockedSystemPacks, callback) {
  const systemOwned = String(pack.collection ?? "").startsWith(`${SYSTEM_ID}.`);
  if (pack.locked && (!systemOwned || !includeLockedSystemPacks)) return;
  const wasLocked = pack.locked;
  try {
    if (wasLocked) await pack.configure({ locked: false });
    await callback();
  } finally {
    if (wasLocked) await pack.configure({ locked: true });
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

  // Compare versions rather than looking up the package version in VERSIONS.
  // Package releases without a migration are intentionally absent from that list.
  const pending = pendingMigrationVersions(last, currentVersion, VERSIONS);

  if (!pending.length) {
    return game.settings.set(systemId, "lastMigration", currentVersion);
  }

  for (const version of pending) {
    const notice = ui.notifications.info(
      game.i18n.format("LYRIAN.Migration.Progress", { version }),
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
        game.i18n.format("LYRIAN.Migration.Failed", { version }),
        { permanent: true }
      );
      return;
    } finally {
      ui.notifications.remove?.(notice);
    }
  }

  await game.settings.set(systemId, "lastMigration", currentVersion);
  ui.notifications.info(game.i18n.localize("LYRIAN.Migration.Complete"));
}
