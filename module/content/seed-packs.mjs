const SYSTEM_ID = "lyrian-chronicles";

/** Bump when content JSON changes so worlds pick up additions. */
export const CONTENT_VERSION = "0.3.1";

/**
 * Pack name -> content file. A missing file is skipped quietly, which is what
 * lets you drop in classes.json and abilities.json later without code changes.
 */
const SOURCES = {
  weapons: "weapons.json",
  armor: "armor.json",
  gear: "gear.json",
  injuries: "injuries.json",
  bestiary: "bestiary.json",
  tables: "tables.json",
  classes: "classes.json",
  abilities: "abilities.json",
  breakthroughs: "breakthroughs.json",
  races: "races.json"
};

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

  for (const [packName, fileName] of Object.entries(SOURCES)) {
    const pack = game.packs.get(`${SYSTEM_ID}.${packName}`);
    if (!pack) continue;

    const source = await _loadContent(fileName);
    if (!source) continue;

    // Read the index rather than hydrating documents — the ability pack can be
    // very large and getDocuments() on it is painfully slow.
    await pack.getIndex({ fields: [`flags.${SYSTEM_ID}.seedKey`] });
    const present = new Set(
      pack.index
        .map((e) => foundry.utils.getProperty(e, `flags.${SYSTEM_ID}.seedKey`))
        .filter(Boolean)
    );

    const missing = source.filter((d) => {
      const key = foundry.utils.getProperty(d, `flags.${SYSTEM_ID}.seedKey`);
      return key && !present.has(key);
    });

    if (!missing.length) {
      summary[packName] = { created: 0, total: source.length };
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

      summary[packName] = { created: missing.length, total: source.length };
      total += missing.length;
      console.log(`Lyrian Chronicles | Seeded ${missing.length} into ${packName}`);
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

  const clean = !Object.values(summary).some((r) => r.error);
  if (clean) await game.settings.set(SYSTEM_ID, "contentSeedVersion", CONTENT_VERSION);

  if (total) {
    ui.notifications.info(
      game.i18n.format("LYRIAN.Msg.SeedComplete", { count: total })
    );
  }

  return summary;
}

/* -------------------------------------------- */

async function _loadContent(fileName) {
  try {
    const response = await fetch(`systems/${SYSTEM_ID}/content/${fileName}`);
    if (!response.ok) return null;   // Optional file, not an error.
    const data = await response.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
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

  for (const packName of Object.keys(SOURCES)) {
    const pack = game.packs.get(`${SYSTEM_ID}.${packName}`);
    if (!pack) continue;

    const wasLocked = pack.locked;
    if (wasLocked) await pack.configure({ locked: false });

    await pack.getIndex({ fields: [`flags.${SYSTEM_ID}.seedKey`] });
    const ids = pack.index
      .filter((e) => foundry.utils.getProperty(e, `flags.${SYSTEM_ID}.seedKey`))
      .map((e) => e._id);

    if (ids.length) {
      await pack.documentClass.deleteDocuments(ids, { pack: pack.collection });
    }
    if (wasLocked) await pack.configure({ locked: true });
  }

  await game.settings.set(SYSTEM_ID, "contentSeedVersion", "");
  ui.notifications.info(game.i18n.localize("LYRIAN.Seed.ResetDone"));
}
