import { LYRIAN } from "./config.mjs";
import { LyrianActorBase, LyrianCharacter, LyrianNPC } from "./data/actor.mjs";
import {
  LyrianItemBase,
  LyrianWeapon,
  LyrianArmor,
  LyrianAbility,
  LyrianClass,
  LyrianBreakthrough,
  LyrianRace,
  LyrianGear,
  LyrianInjury
} from "./data/item.mjs";
import { LyrianActor } from "./documents/actor.mjs";
import { LyrianItem } from "./documents/item.mjs";
import { LyrianCombat, LyrianCombatant } from "./documents/combat.mjs";
import { LyrianActorSheet } from "./sheets/actor-sheet.mjs";
import { LyrianItemSheet } from "./sheets/item-sheet.mjs";
import { runMigrations } from "../migrations/migrate.mjs";
import { LyrianAPI } from "./api.mjs";
import { seedSystemPacks, resetSystemPacks } from "./content/seed-packs.mjs";
import { runCharacterCreation } from "./apps/character-creation.mjs";

const SYSTEM_ID = "lyrian-chronicles";

/* -------------------------------------------- */
/*  Initialisation                               */
/* -------------------------------------------- */

Hooks.once("init", function () {
  console.log("Lyrian Chronicles | Initialising system");

  game.lyrian = {
    LyrianActor,
    LyrianItem,
    config: LYRIAN,
    rollItemMacro,
    // Public surface for third-party modules. See module/api.mjs.
    api: LyrianAPI,
    seedSystemPacks,
    resetSystemPacks,
    runCharacterCreation
  };

  CONFIG.LYRIAN = LYRIAN;

  // Documents.
  CONFIG.Actor.documentClass = LyrianActor;
  CONFIG.Item.documentClass = LyrianItem;
  CONFIG.Combat.documentClass = LyrianCombat;
  CONFIG.Combatant.documentClass = LyrianCombatant;

  // Data models, keyed to the subtypes declared in system.json.
  CONFIG.Actor.dataModels = {
    character: LyrianCharacter,
    npc: LyrianNPC
  };

  CONFIG.Item.dataModels = {
    weapon: LyrianWeapon,
    armor: LyrianArmor,
    ability: LyrianAbility,
    class: LyrianClass,
    breakthrough: LyrianBreakthrough,
    race: LyrianRace,
    gear: LyrianGear,
    injury: LyrianInjury
  };

  // Initiative: 1d4 + Agility, adjusted by armour.
  CONFIG.Combat.initiative = {
    formula: "1d4 + @initiative.value",
    decimals: 0
  };

  // Custom conditions on top of the core set.
  for (const status of LYRIAN.statusEffects) {
    if (!CONFIG.statusEffects.find((s) => s.id === status.id)) {
      CONFIG.statusEffects.push(status);
    }
  }

  registerSheets();
  registerHandlebarsHelpers();
  registerSettings();

  return preloadTemplates();
});

/* -------------------------------------------- */

function registerSheets() {
  const { Actors, Items } = foundry.documents.collections;
  const { DocumentSheetConfig } = foundry.applications.apps;

  try {
    DocumentSheetConfig.unregisterSheet(Actor, "core", foundry.applications.sheets.ActorSheetV2);
    DocumentSheetConfig.unregisterSheet(Item, "core", foundry.applications.sheets.ItemSheetV2);
  } catch (err) {
    console.warn("Lyrian Chronicles | Could not unregister a core sheet", err);
  }

  Actors.registerSheet(SYSTEM_ID, LyrianActorSheet, {
    types: ["character", "npc"],
    makeDefault: true,
    label: "LYRIAN.SheetLabel.Actor"
  });

  Items.registerSheet(SYSTEM_ID, LyrianItemSheet, {
    makeDefault: true,
    label: "LYRIAN.SheetLabel.Item"
  });
}

/* -------------------------------------------- */

function registerSettings() {
  game.settings.register(SYSTEM_ID, "autoApplyGuard", {
    name: "LYRIAN.Settings.AutoApplyGuard.Name",
    hint: "LYRIAN.Settings.AutoApplyGuard.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(SYSTEM_ID, "contentSeedVersion", {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  game.settings.register(SYSTEM_ID, "autoSeedContent", {
    name: "LYRIAN.Settings.AutoSeed.Name",
    hint: "LYRIAN.Settings.AutoSeed.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  // Tracks the last version whose migrations have run in this world.
  game.settings.register(SYSTEM_ID, "lastMigration", {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  game.settings.register(SYSTEM_ID, "enforceOncePerRound", {
    name: "LYRIAN.Settings.OncePerRound.Name",
    hint: "LYRIAN.Settings.OncePerRound.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
}

/* -------------------------------------------- */

async function preloadTemplates() {
  const paths = [
    "actor/header",
    "actor/tab-main",
    "actor/tab-skills",
    "actor/tab-abilities",
    "actor/tab-inventory",
    "actor/tab-progression",
    "actor/tab-biography",
    "apps/character-creation",
    "item/header",
    "item/body",
    "item/description",
    "chat/attack-card",
    "chat/item-card"
  ].map((p) => `systems/${SYSTEM_ID}/templates/${p}.hbs`);

  return foundry.applications.handlebars.loadTemplates(paths);
}

/* -------------------------------------------- */

function registerHandlebarsHelpers() {
  Handlebars.registerHelper("lyrianSigned", (value) => {
    const n = Number(value) || 0;
    return n >= 0 ? `+${n}` : `${n}`;
  });

  Handlebars.registerHelper("lyrianLocalizeKey", (table, key) => {
    const entry = CONFIG.LYRIAN[table]?.[key];
    const label = typeof entry === "string" ? entry : entry?.label;
    return label ? game.i18n.localize(label) : key;
  });

  if (!Handlebars.helpers.array) {
    Handlebars.registerHelper("array", (...args) => args.slice(0, -1));
  }
  if (!Handlebars.helpers.concat) {
    Handlebars.registerHelper("concat", (...args) => args.slice(0, -1).join(""));
  }
  if (!Handlebars.helpers.eq) {
    Handlebars.registerHelper("eq", (a, b) => a === b);
  }
  if (!Handlebars.helpers.lt) {
    Handlebars.registerHelper("lt", (a, b) => a < b);
  }

  Handlebars.registerHelper("lyrianPercent", (value, max) => {
    const v = Number(value) || 0;
    const m = Number(max) || 1;
    return Math.clamp(Math.round((v / m) * 100), 0, 100);
  });
}

/* -------------------------------------------- */
/*  Chat card interactivity                      */
/* -------------------------------------------- */

Hooks.on("renderChatMessageHTML", (message, html) => {
  html.querySelectorAll("[data-lyrian-action]").forEach((button) => {
    button.addEventListener("click", (event) => onChatAction(event, message));
  });
});

/**
 * Resolve the defender's reaction and apply damage from an attack card.
 */
async function onChatAction(event, message) {
  event.preventDefault();
  const button = event.currentTarget;
  const action = button.dataset.lyrianAction;
  const flags = message.flags[SYSTEM_ID] ?? {};

  if (action !== "applyDamage") return;

  const defence = button.dataset.defence ?? "none";
  const actorId = button.dataset.actorId;

  // Prefer an explicit target on the card, otherwise fall back to selected tokens.
  let actors = [];
  if (actorId) {
    const actor = game.actors.get(actorId);
    if (actor) actors = [actor];
  } else {
    actors = canvas.tokens.controlled.map((t) => t.actor).filter(Boolean);
  }

  if (!actors.length) {
    return ui.notifications.warn(game.i18n.localize("LYRIAN.Warn.NoTargetSelected"));
  }

  for (const actor of actors) {
    const result = await actor.applyDamage(flags.damage ?? 0, {
      defence,
      fullPierce: flags.fullPierce || (flags.halfPierce && defence === "none"),
      pinpoint: flags.pinpoint ?? 0
    });

    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p>${game.i18n.format("LYRIAN.Msg.DamageApplied", {
        name: actor.name,
        amount: result.applied,
        guard: result.guardUsed,
        defence: game.i18n.localize(LYRIAN.defenceReactions[defence])
      })}</p>`
    });
  }
}

/* -------------------------------------------- */
/*  Hotbar macros                                */
/* -------------------------------------------- */

Hooks.on("hotbarDrop", (bar, data, slot) => {
  if (data.type !== "Item") return;
  createItemMacro(data, slot);
  return false;
});

async function createItemMacro(data, slot) {
  const item = await Item.implementation.fromDropData(data);
  if (!item?.parent) {
    return ui.notifications.warn(game.i18n.localize("LYRIAN.Warn.MacroOwnedOnly"));
  }

  const command = `game.lyrian.rollItemMacro("${item.uuid}");`;
  let macro = game.macros.find((m) => m.name === item.name && m.command === command);
  if (!macro) {
    macro = await Macro.create({
      name: item.name,
      type: "script",
      img: item.img,
      command,
      flags: { [SYSTEM_ID]: { itemMacro: true } }
    });
  }
  game.user.assignHotbarMacro(macro, slot);
}

async function rollItemMacro(itemUuid) {
  const item = await fromUuid(itemUuid);
  if (!item) return ui.notifications.warn(game.i18n.localize("LYRIAN.Warn.MacroMissing"));
  if (item.type === "weapon") return item.rollAttack("light");
  if (item.type === "ability") return item.rollAbility();
  return item.postToChat();
}

/* -------------------------------------------- */

Hooks.once("ready", async function () {
  console.log("Lyrian Chronicles | Ready");
  await runMigrations(SYSTEM_ID, game.system.version);

  if (game.settings.get(SYSTEM_ID, "autoSeedContent")) {
    await seedSystemPacks();
  }
});
