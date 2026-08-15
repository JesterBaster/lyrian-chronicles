const SYSTEM_ID = "lyrian-chronicles";

/** Bump when content JSON changes so worlds pick up additions. */
export const CONTENT_VERSION = "0.6.2-rulebook-0.13.1-flos-madness-item-mods";

/** Reviewed pack names, in mandatory rulebook review order. */
const PACK_NAMES = [
  "rules-setting-guide",
  "keywords",
  "breakthroughs",
  "player-abilities",
  "races",
  "classes",
  "weapons",
  "armor-shields",
  "consumables",
  "gear-kits",
  "artifices",
  "materials",
  "mods",
  "crafting-guide",
  "monsters",
  "monster-abilities"
];

/* -------------------------------------------- */

/**
 * Populate system compendia from JSON.
 *
 * Idempotent by design: every source document carries a stable seedKey, so
 * running this again adds only what is missing rather than duplicating.
 * System packs ship locked, so each is unlocked for the write and re-locked
 * afterwards — a GM who deliberately unlocked a pack keeps it unlocked.
 *
 * @param {object} [options]
 * @param {boolean} [options.force]  Re-check every pack even if the version matches.
 * @returns {Promise<object>} Per-pack summary.
 */
export async function seedSystemPacks({ force = false } = {}) {
  if (!game.user?.isGM) return { skipped: "not-gm" };

  const seeded = game.settings.get(SYSTEM_ID, "contentSeedVersion");
  if (!force && seeded === CONTENT_VERSION) return { skipped: "up-to-date" };

  const summary = {};
  let total = 0;
  const catalog = await _loadContentIndex();
  if (!catalog) throw new Error("Lyrian Chronicles compendium index is missing");

  for (const packName of PACK_NAMES) {
    const pack = game.packs.get(`${SYSTEM_ID}.${packName}`);
    if (!pack) {
      summary[packName] = { error: "Compendium is not registered" };
      continue;
    }

    const fileNames = catalog.packs?.[packName]?.files;
    if (!Array.isArray(fileNames) || !fileNames.length) {
      summary[packName] = { error: "Content index has no files for this pack" };
      continue;
    }

    let source;
    try {
      source = await _loadContent(fileNames);
    } catch (err) {
      console.error(`Lyrian Chronicles | Loading ${packName} failed`, err);
      summary[packName] = { error: err.message };
      continue;
    }

    // Read the index rather than hydrating documents — the ability pack can be
    // very large and getDocuments() on it is painfully slow.
    await pack.getIndex({
      fields: [
        `flags.${SYSTEM_ID}.seedKey`,
        `flags.${SYSTEM_ID}.sourceHash`,
        `flags.${SYSTEM_ID}.contentBuild`
      ]
    });
    const present = new Map(
      pack.index
        .map((entry) => [
          foundry.utils.getProperty(entry, `flags.${SYSTEM_ID}.seedKey`),
          entry
        ])
        .filter(([key]) => key)
    );

    const missing = source.filter((d) => {
      const key = foundry.utils.getProperty(d, `flags.${SYSTEM_ID}.seedKey`);
      return key && !present.has(key);
    });
    const changed = source.filter((document) => {
      const key = foundry.utils.getProperty(document, `flags.${SYSTEM_ID}.seedKey`);
      const current = present.get(key);
      if (!current) return false;
      const incomingHash = foundry.utils.getProperty(document, `flags.${SYSTEM_ID}.sourceHash`);
      const currentHash = foundry.utils.getProperty(current, `flags.${SYSTEM_ID}.sourceHash`);
      const incomingBuild = foundry.utils.getProperty(document, `flags.${SYSTEM_ID}.contentBuild`);
      const currentBuild = foundry.utils.getProperty(current, `flags.${SYSTEM_ID}.contentBuild`);
      return (incomingHash && incomingHash !== currentHash) || incomingBuild !== currentBuild;
    });

    if (!missing.length && !changed.length) {
      summary[packName] = { created: 0, updated: 0, total: source.length };
      continue;
    }

    const wasLocked = pack.locked;
    try {
      if (wasLocked) await pack.configure({ locked: false });

      // Chunked so hosted Foundry instances do not reject an oversized payload.
      for (let i = 0; i < missing.length; i += 100) {
        await pack.documentClass.createDocuments(missing.slice(i, i + 100), {
          pack: pack.collection,
          keepId: true
        });
      }

      for (let i = 0; i < changed.length; i += 100) {
        await pack.documentClass.updateDocuments(changed.slice(i, i + 100), {
          pack: pack.collection,
          diff: false,
          recursive: false
        });
      }

      summary[packName] = {
        created: missing.length,
        updated: changed.length,
        total: source.length
      };
      total += missing.length + changed.length;
      console.log(
        `Lyrian Chronicles | ${packName}: created ${missing.length}, updated ${changed.length}`
      );
    } catch (err) {
      console.error(`Lyrian Chronicles | Seeding ${packName} failed`, err);
      summary[packName] = { error: err.message };
    } finally {
      if (wasLocked) {
        try { await pack.configure({ locked: true }); }
        catch (err) { console.warn(`Lyrian Chronicles | Could not re-lock ${packName}`, err); }
      }
    }
  }

  const clean = Object.keys(summary).length === PACK_NAMES.length &&
    !Object.values(summary).some((result) => result.error);
  if (clean) await game.settings.set(SYSTEM_ID, "contentSeedVersion", CONTENT_VERSION);
  else {
    ui.notifications.error(
      "Lyrian Chronicles: some compendium packs could not be refreshed. Check the console for details.",
      { permanent: true }
    );
  }

  if (total) {
    ui.notifications.info(
      game.i18n.format("LYRIAN.Msg.SeedComplete", { count: total })
    );
  }

  return summary;
}

/* -------------------------------------------- */

async function _loadContentIndex() {
  try {
    const response = await fetch(`systems/${SYSTEM_ID}/content/compendium-index.json`);
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

async function _loadContent(fileNames) {
  const chunks = await Promise.all(fileNames.map(async (fileName) => {
    const response = await fetch(`systems/${SYSTEM_ID}/content/${fileName}`);
    if (!response.ok) throw new Error(`${fileName}: ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error(`${fileName}: expected an array`);
    return data;
  }));
  return chunks.flat();
}

/* -------------------------------------------- */

/** Wipe every seeded document, for rebuilding after a content change. */
export async function resetSystemPacks() {
  if (!game.user.isGM) return;

  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize("LYRIAN.Seed.ResetTitle") },
    content: `<p>${game.i18n.localize("LYRIAN.Seed.ResetWarning")}</p>`
  });
  if (!confirmed) return;

  for (const packName of PACK_NAMES) {
    const pack = game.packs.get(`${SYSTEM_ID}.${packName}`);
    if (!pack) continue;

    const wasLocked = pack.locked;
    try {
      if (wasLocked) await pack.configure({ locked: false });

      await pack.getIndex({ fields: [`flags.${SYSTEM_ID}.seedKey`] });
      const ids = pack.index
        .filter((e) => foundry.utils.getProperty(e, `flags.${SYSTEM_ID}.seedKey`))
        .map((e) => e._id);

      if (ids.length) {
        await pack.documentClass.deleteDocuments(ids, { pack: pack.collection });
      }
    } finally {
      if (wasLocked) await pack.configure({ locked: true });
    }
  }

  await game.settings.set(SYSTEM_ID, "contentSeedVersion", "");
  ui.notifications.info(game.i18n.localize("LYRIAN.Seed.ResetDone"));
}
