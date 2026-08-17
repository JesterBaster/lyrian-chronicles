import { LYRIAN } from "./config.mjs";
import { LyrianActorBase, LyrianCharacter, LyrianNPC } from "./data/actor.mjs";
import {
  LyrianItemBase,
  LyrianKeyword,
  LyrianWeapon,
  LyrianArmor,
  LyrianAbility,
  LyrianClass,
  LyrianBreakthrough,
  LyrianRace,
  LyrianEquipment,
  LyrianMonsterAbility,
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
import { resolveDefence } from "./rules/defence-resolution.mjs";
import { resolvedAttackFlagUpdate } from "./rules/resolved-attacks.mjs";
import { boundedDamage, legitimateAttackProfile } from "./rules/attack-verification.mjs";
import { actorHeaderNeedsRefresh } from "./rules/sheet-refresh.mjs";
import { normalizeHealingAmount } from "./rules/healing.mjs";
import {
  actionLockWarningKey,
  initializeActionTransactions,
  runExclusiveActorAction
} from "./rules/action-transactions.mjs";

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
    npc: LyrianNPC,
    monster: LyrianNPC
  };

  CONFIG.Item.dataModels = {
    keyword: LyrianKeyword,
    weapon: LyrianWeapon,
    armor: LyrianArmor,
    ability: LyrianAbility,
    class: LyrianClass,
    breakthrough: LyrianBreakthrough,
    race: LyrianRace,
    equipment: LyrianEquipment,
    monsterAbility: LyrianMonsterAbility,
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
/*  Live actor-sheet refresh                     */
/* -------------------------------------------- */

/**
 * ApplicationV2 sheets do not consistently repaint the persistent header
 * after a resource update arrives from a chat-card action. Refresh only that
 * part on every client that currently has the affected Actor sheet open.
 */
Hooks.on("updateActor", (actor, changes) => {
  if (!actorHeaderNeedsRefresh(changes)) return;
  const sheet = actor._sheet;
  if (!sheet?.rendered) return;
  void sheet.render({ parts: ["header"] });
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
    types: ["character", "npc", "monster"],
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

  game.settings.register(SYSTEM_ID, "announceExpSpending", {
    name: "LYRIAN.Settings.AnnounceExpSpending.Name",
    hint: "LYRIAN.Settings.AnnounceExpSpending.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(SYSTEM_ID, "craftingConsumesMaterials", {
    name: "LYRIAN.Settings.CraftingConsumesMaterials.Name",
    hint: "LYRIAN.Settings.CraftingConsumesMaterials.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(SYSTEM_ID, "craftingPlayerProjects", {
    name: "LYRIAN.Settings.CraftingPlayerProjects.Name",
    hint: "LYRIAN.Settings.CraftingPlayerProjects.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
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
    "actor/tab-proficiencies",
    "actor/tab-abilities",
    "actor/tab-inventory",
    "actor/tab-crafting",
    "actor/tab-progression",
    "actor/tab-biography",
    "actor/tab-setup",
    "apps/character-creation",
    "item/header",
    "item/body",
    "item/description",
    "chat/attack-card",
    "chat/check-card",
    "chat/craft-card",
    "chat/healing-card",
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

  Handlebars.registerHelper("lyrianInstalledMods", (mods, targetId) =>
    Array.from(mods ?? []).filter((mod) =>
      mod.getFlag("lyrian-chronicles", "installedMod")?.targetItemId === targetId));

  Handlebars.registerHelper("lyrianModSlot", (mod) =>
    mod?.getFlag("lyrian-chronicles", "installedMod")?.slot ?? "");
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
 * Apply a rolled healing amount to every controlled token.
 *
 * The amount comes from the message flags rather than the rendered card, so a
 * client cannot inflate it by editing the HTML. Ownership is still checked per
 * actor, and applyHealing itself caps at maximum HP.
 */
async function applyHealingFromCard(healing) {
  const amount = normalizeHealingAmount(healing.total);
  if (!amount) return;

  const targets = canvas.tokens.controlled.filter((token) => token.actor);
  if (!targets.length) {
    return ui.notifications.warn(game.i18n.localize("LYRIAN.Warn.NoTargetSelected"));
  }

  for (const token of targets) {
    const actor = token.actor;
    if (!game.user.isGM && !actor.isOwner) {
      ui.notifications.warn(game.i18n.format("LYRIAN.Warn.NotOwner", { name: actor.name }));
      continue;
    }
    await actor.applyHealing(amount);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p>${game.i18n.format("LYRIAN.Msg.HealingApplied", {
        name: actor.name,
        amount
      })}</p>`
    });
  }
}

/**
 * Resolve the defender's reaction and apply damage from an attack card.
 */
async function onChatAction(event, message) {
  event.preventDefault();
  const button = event.currentTarget;
  const action = button.dataset.lyrianAction;
  const flags = message.flags[SYSTEM_ID] ?? {};

  if (action === "applyHealing") return applyHealingFromCard(flags.healing ?? {});
  if (action !== "applyDamage") return;

  const defence = ["none", "dodge", "block"].includes(button.dataset.defence)
    ? button.dataset.defence
    : "none";
  const attack = flags.attack ?? {};
  const targetIndex = button.dataset.targetIndex;
  const indexedTarget = targetIndex === undefined ? null : attack.targets?.[Number(targetIndex)];

  let defenders = [];
  if (indexedTarget) {
    const document = await fromUuid(indexedTarget.tokenUuid ?? indexedTarget.actorUuid);
    const actor = document?.actor ?? document;
    if (actor) defenders = [{ actor, target: indexedTarget }];
  } else {
    const attackerDocument = attack.actorUuid ? await fromUuid(attack.actorUuid) : null;
    const attacker = attackerDocument?.actor ?? attackerDocument;
    defenders = canvas.tokens.controlled
      .filter((token) => token.actor)
      .map((token) => {
        const cover = token.document?.getFlag(SYSTEM_ID, "cover") ?? "none";
        const values = token.actor.getDefencesAgainst({ cover, attacker });
        return {
          actor: token.actor,
          target: {
            actorUuid: token.actor.uuid,
            tokenUuid: token.document.uuid,
            dodgeEvasion: values.dodgeEvasion,
            untargetable: values.untargetable,
            hit: !values.untargetable && (attack.sureHit || attack.accuracy?.total >= values.evasion)
          }
        };
      });
  }

  if (!defenders.length) {
    return ui.notifications.warn(game.i18n.localize("LYRIAN.Warn.NoTargetSelected"));
  }

  for (const { actor, target } of defenders) {
    if (!game.user.isGM && !actor.isOwner) {
      ui.notifications.warn(game.i18n.format("LYRIAN.Warn.NotOwner", { name: actor.name }));
      continue;
    }

    const resolution = await runExclusiveActorAction(actor, async () => {
      // Re-read inside the active-GM lock. Another browser may have resolved
      // this card while this client was waiting for the authority response.
      const resolved = actor.getFlag(SYSTEM_ID, "resolvedAttacks") ?? {};
      if (resolved[message.id]) return { duplicate: true };

      const outcome = resolveDefence({
        defence,
        attackTotal: attack.accuracy?.total,
        sureHit: attack.sureHit,
        originalHit: target.hit,
        untargetable: target.untargetable,
        dodgeEvasion: target.dodgeEvasion
      });
      const verifiedAttack = outcome.hits
        ? await legitimateAttackProfile({ attack })
        : null;
      if (outcome.hits && !verifiedAttack && !game.user.isGM) {
        ui.notifications.warn(game.i18n.localize("LYRIAN.Warn.AttackSourceUnverified"));
        return { cancelled: true };
      }

      if (outcome.rpCost && !(await actor.spendResources({ rp: outcome.rpCost }))) {
        return { cancelled: true };
      }

      // Store the claim on the defender and explicitly delete old keys.
      // Foundry merges flag objects, so setFlag alone cannot prune omitted entries.
      await actor.update(resolvedAttackFlagUpdate({
        systemId: SYSTEM_ID,
        resolved,
        messageId: message.id,
        value: { defence, at: Date.now() }
      }));

      if (!outcome.hits) {
        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor }),
          content: `<p>${game.i18n.format(
            outcome.reason === "dodged" ? "LYRIAN.Msg.AttackDodged" : "LYRIAN.Msg.AttackMissed",
            { name: actor.name }
          )}</p>`
        });
        return { resolved: true };
      }

      const claimedDamage = attack.damage?.total ?? flags.damage ?? 0;
      let damage = claimedDamage;
      let pierce = {
        fullPierce: Boolean(flags.fullPierce),
        halfPierce: Boolean(flags.halfPierce),
        pinpoint: flags.pinpoint ?? 0
      };

      if (verifiedAttack) {
        const bounded = boundedDamage({ claimed: claimedDamage, ceiling: verifiedAttack.ceiling });
        damage = bounded.amount;
        pierce = verifiedAttack.pierce;
        if (bounded.clamped) {
          console.warn("Lyrian Chronicles | Rejected forged attack damage", {
            messageId: message.id,
            actorUuid: attack.actorUuid,
            sourceUuid: attack.sourceUuid,
            claimed: claimedDamage,
            ceiling: verifiedAttack.ceiling
          });
        }

        // Blocking prevents a critical hit. Re-roll only the verified source formula.
        if (defence === "block" && attack.damage?.maximised) {
          damage = (await new Roll(verifiedAttack.formula, verifiedAttack.rollData).evaluate()).total;
        }
      } else if (defence === "block" && attack.damage?.maximised && attack.damage.formula) {
        // GM-only compatibility fallback for cards whose source no longer resolves.
        const source = attack.sourceUuid ? await fromUuid(attack.sourceUuid) : null;
        const attacker = attack.actorUuid ? await fromUuid(attack.actorUuid) : null;
        const rollData = source?.getRollData?.() ?? attacker?.getRollData?.() ?? {};
        damage = (await new Roll(attack.damage.formula, rollData).evaluate()).total;
      }

      const result = await actor.applyDamage(damage, {
        defence,
        ...pierce
      });

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<p>${game.i18n.format("LYRIAN.Msg.DamageApplied", {
          name: actor.name,
          amount: result.applied,
          guard: result.guardUsed,
          defence: game.i18n.localize(LYRIAN.defenceReactions[defence])
        })}</p>`
      });
      return { resolved: true };
    });

    if (!resolution.started) {
      ui.notifications.warn(game.i18n.localize(actionLockWarningKey(resolution.reason)));
      continue;
    }
    if (resolution.value?.duplicate) {
      ui.notifications.warn(game.i18n.format("LYRIAN.Warn.AttackResolved", { name: actor.name }));
      continue;
    }
    if (resolution.value?.resolved) button.disabled = true;
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

for (const hook of ["createItem", "updateItem", "deleteItem"]) {
  Hooks.on(hook, async (item) => {
    if (!item.actor || !["race", "class"].includes(item.type)) return;
    await item.actor.syncProgressionFeatures();
  });
}

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
  if (item.type === "ability" || item.type === "monsterAbility") return item.rollAbility();
  return item.postToChat();
}

/* -------------------------------------------- */

Hooks.once("ready", async function () {
  console.log("Lyrian Chronicles | Ready");
  initializeActionTransactions({
    socket: game.socket,
    users: () => game.users,
    user: () => game.user,
    resolveUuid: (uuid) => fromUuid(uuid)
  });

  // Refresh the official source documents first. Migrations can then hydrate
  // older owned race items from the current compendium schema.
  if (game.settings.get(SYSTEM_ID, "autoSeedContent")) {
    await seedSystemPacks();
  }

  await runMigrations(SYSTEM_ID, game.system.version);
});
