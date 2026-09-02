/**
 * Token Action HUD Core integration.
 *
 * TAH Core normally expects a companion module: it listens for
 * `tokenActionHudSystemReady` and reads `.api.SystemManager` off whatever is
 * handed to it. Nothing in that contract requires a real module, so the system
 * registers itself and a table needs only TAH Core (and socketlib, which TAH
 * Core requires of everyone) rather than hunting for a separate package that
 * does not exist for this system.
 *
 * Every class is built inside the `tokenActionHudCoreApiReady` hook because
 * they extend classes that only exist once TAH Core has loaded. Nothing here
 * runs, or throws, when TAH Core is absent.
 */
import { LYRIAN } from "../config.mjs";

const SYSTEM_ID = "lyrian-chronicles";

/**
 * Major version only. TAH Core compares the parts it is given and ignores the
 * ones it is not, so "2" accepts every 2.x while still refusing a future 3.x
 * that changes the API — a refusal with a warning beats a HUD that throws.
 */
const REQUIRED_CORE_VERSION = "2";

/** Group ids, which double as the keys of the layout below. */
const GROUP = Object.freeze({
  weapons: { id: "weapons", name: "LYRIAN.TAH.Group.Weapons", type: "system" },
  attacks: { id: "attacks", name: "LYRIAN.TAH.Group.Attacks", type: "system" },
  actions: { id: "actions", name: "LYRIAN.TAH.Group.Actions", type: "system" },
  reactions: { id: "reactions", name: "LYRIAN.TAH.Group.Reactions", type: "system" },
  passives: { id: "passives", name: "LYRIAN.TAH.Group.Passives", type: "system" },
  downtime: { id: "downtime", name: "LYRIAN.TAH.Group.Downtime", type: "system" },
  stats: { id: "stats", name: "LYRIAN.TAH.Group.Stats", type: "system" },
  skills: { id: "skills", name: "LYRIAN.TAH.Group.Skills", type: "system" },
  artisan: { id: "artisan", name: "LYRIAN.TAH.Group.Artisan", type: "system" },
  gathering: { id: "gathering", name: "LYRIAN.TAH.Group.Gathering", type: "system" },
  armor: { id: "armor", name: "LYRIAN.TAH.Group.Armor", type: "system" },
  gear: { id: "gear", name: "LYRIAN.TAH.Group.Gear", type: "system" },
  utility: { id: "utility", name: "LYRIAN.TAH.Group.Utility", type: "system" }
});

/**
 * Where an ability's timing puts it.
 *
 * Everything not listed here is an action. Crafting, gathering and interlude
 * abilities are not spent in a fight, so putting them on the combat shelf
 * buried the abilities that are — an encounter's opening and closing beats
 * still belong there, because they happen in one.
 */
const REACTION_TIMINGS = new Set(["reaction"]);
const DOWNTIME_TIMINGS = new Set(["interlude", "crafting", "gathering"]);

/**
 * Which attack a click means.
 *
 * One button per weapon rather than three keeps the HUD the size a HUD should
 * be. The modifiers are named in every weapon's tooltip so they are not folk
 * knowledge.
 */
export function attackTypeForEvent({ ctrl = false, alt = false } = {}) {
  if (ctrl) return "heavy";
  if (alt) return "precise";
  return "light";
}

export function registerTokenActionHud() {
  Hooks.once("tokenActionHudCoreApiReady", (coreModule) => {
    const { Utils } = coreModule.api;
    const i18n = (key) => Utils.i18n(key);

    class LyrianActionHandler extends coreModule.api.ActionHandler {
      /** @override */
      async buildSystemActions() {
        const actor = this.actor;
        if (!actor) return;
        this.items = coreModule.api.Utils.sortItemsByName(actor.items);

        this.#buildWeapons();
        this.#buildUniversalAttacks();
        this.#buildAbilities();
        this.#buildStats();
        this.#buildSkillGroup("skills", "skill", LYRIAN.skills, "skills");
        this.#buildSkillGroup("artisan", "artisan", LYRIAN.artisanSkills, "artisan");
        this.#buildSkillGroup("gathering", "gathering", LYRIAN.gatheringSkills, "gathering");
        this.#buildInventory();
        this.#buildUtility();
      }

      /** Every item of a type, as HUD actions. */
      #itemActions(types, actionType, decorate = null) {
        return Array.from(this.items ?? [])
          .map(([, item]) => item)
          .filter((item) => types.includes(item.type))
          .map((item) => {
            const action = {
              id: item.id,
              name: item.name,
              listName: `${i18n(`LYRIAN.TAH.ActionType.${actionType}`)}: ${item.name}`,
              encodedValue: [actionType, item.id].join(this.delimiter),
              img: coreModule.api.Utils.getImage(item),
              cssClass: item.system?.equipped ? "active" : ""
            };
            return decorate ? decorate(action, item) : action;
          });
      }

      #buildWeapons() {
        const actions = this.#itemActions(["weapon"], "weapon", (action, item) => {
          const damage = item.system?.damageBonus;
          const accuracy = item.system?.accuracyBonus;
          if (Number.isFinite(accuracy) && accuracy) {
            action.info1 = { text: signed(accuracy), title: i18n("LYRIAN.UI.Accuracy") };
          }
          if (Number.isFinite(damage) && damage) {
            action.info2 = { text: signed(damage), title: i18n("LYRIAN.UI.Damage") };
          }
          action.tooltip = i18n("LYRIAN.TAH.Tooltip.Weapon");
          return action;
        });
        if (actions.length) this.addActions(actions, GROUP.weapons);
      }

      #buildUniversalAttacks() {
        const isCharacter = this.actor.type === "character";
        // A monster's official profile has no precise attack, so offering one
        // would be a button that declines every time it is pressed.
        const types = isCharacter ? ["light", "heavy", "precise"] : ["light", "heavy"];
        const actions = types.map((type) => ({
          id: `universal-${type}`,
          name: i18n(LYRIAN.attackTypes[type].label),
          listName: `${i18n("LYRIAN.TAH.ActionType.attack")}: ${i18n(LYRIAN.attackTypes[type].label)}`,
          encodedValue: ["attack", type].join(this.delimiter),
          info1: { text: `${LYRIAN.attackTypes[type].ap} AP`, title: i18n("LYRIAN.UI.ActionPoints") }
        }));
        this.addActions(actions, GROUP.attacks);
      }

      #buildAbilities() {
        const decorate = (action, item) => {
          const costs = [
            item.system?.apCost ? `${item.system.apCost} AP` : "",
            item.system?.rpCost ? `${item.system.rpCost} RP` : "",
            item.system?.manaCost ? `${item.system.manaCost} MP` : ""
          ].filter(Boolean).join(" · ");
          if (costs) action.info1 = { text: costs, title: i18n("LYRIAN.UI.Cost") };
          return action;
        };
        const all = this.#itemActions(["ability", "monsterAbility"], "ability", decorate);
        if (!all.length) return;

        const timingOf = (id) => this.actor.items.get(id)?.system?.timing ?? "action";
        const shelf = (timing) => {
          if (timing === "passive") return "passives";
          if (REACTION_TIMINGS.has(timing)) return "reactions";
          if (DOWNTIME_TIMINGS.has(timing)) return "downtime";
          return "actions";
        };

        const shelves = { actions: [], reactions: [], passives: [], downtime: [] };
        for (const action of all) shelves[shelf(timingOf(action.id))].push(action);
        for (const [group, actions] of Object.entries(shelves)) {
          if (actions.length) this.addActions(actions, GROUP[group]);
        }
      }

      #buildStats() {
        // The config tables are named `mainStats` and `subStats`; the actor
        // stores them at `system.stats` and `system.subStats`. Reading the
        // config name as a data path silently showed every main stat as +0.
        const entries = [
          ...Object.keys(LYRIAN.mainStats).map((key) => [key, LYRIAN.mainStats[key], "stats"]),
          ...Object.keys(LYRIAN.subStats).map((key) => [key, LYRIAN.subStats[key], "subStats"])
        ];
        const actions = entries.map(([key, label, group]) => ({
          id: `stat-${key}`,
          name: i18n(label),
          listName: `${i18n("LYRIAN.TAH.ActionType.stat")}: ${i18n(label)}`,
          encodedValue: ["stat", key].join(this.delimiter),
          info1: { text: signed(this.actor.system?.[group]?.[key]?.total ?? 0) }
        }));
        // The save is a check like any other and belongs beside the stats it
        // is rolled against.
        actions.push({
          id: "save",
          name: i18n("LYRIAN.Roll.Save"),
          listName: `${i18n("LYRIAN.TAH.ActionType.stat")}: ${i18n("LYRIAN.Roll.Save")}`,
          encodedValue: ["save", "save"].join(this.delimiter)
        });
        this.addActions(actions, GROUP.stats);
      }

      #buildSkillGroup(groupKey, actionType, definitions, systemKey) {
        const owned = this.actor.system?.[systemKey];
        if (!owned) return;
        const actions = Object.entries(definitions).map(([key, definition]) => {
          const label = typeof definition === "string" ? definition : definition.label;
          const skill = owned[key] ?? {};
          return {
            id: `${actionType}-${key}`,
            name: i18n(label),
            listName: `${i18n(`LYRIAN.TAH.ActionType.${actionType}`)}: ${i18n(label)}`,
            encodedValue: [actionType, key].join(this.delimiter),
            info1: { text: signed(skill.total ?? skill.rank ?? 0) },
            cssClass: skill.atCap ? "active" : ""
          };
        });
        if (actions.length) this.addActions(actions, GROUP[groupKey]);
      }

      #buildInventory() {
        const armor = this.#itemActions(["armor"], "item");
        if (armor.length) this.addActions(armor, GROUP.armor);

        const gear = this.#itemActions(["gear", "equipment"], "item", (action, item) => {
          const quantity = item.system?.quantity;
          if (Number.isFinite(quantity) && quantity !== 1) {
            action.info1 = { text: String(quantity), title: i18n("LYRIAN.UI.Quantity") };
          }
          return action;
        });
        if (gear.length) this.addActions(gear, GROUP.gear);
      }

      #buildUtility() {
        const utilities = [
          ["initiative", "LYRIAN.Roll.Initiative"],
          ["rest", "LYRIAN.Action.Rest"],
          ["injury", "LYRIAN.Roll.Injury"]
        ];
        this.addActions(utilities.map(([key, label]) => ({
          id: `utility-${key}`,
          name: i18n(label),
          listName: `${i18n("LYRIAN.TAH.ActionType.utility")}: ${i18n(label)}`,
          encodedValue: ["utility", key].join(this.delimiter)
        })), GROUP.utility);
      }
    }

    class LyrianRollHandler extends coreModule.api.RollHandler {
      /** @override */
      async handleActionClick(event, encodedValue) {
        const [actionType, id] = String(encodedValue ?? "").split(this.delimiter);
        const actor = this.actor;
        if (!actor) return;

        // Right-click opens the sheet instead of spending the resource, which
        // is how every other TAH system behaves.
        if (this.isRenderItem() && ["weapon", "ability", "item"].includes(actionType)) {
          return this.renderItem(actor, id);
        }

        switch (actionType) {
          case "weapon":
            return actor.items.get(id)?.rollAttack(
              attackTypeForEvent({ ctrl: this.isCtrl, alt: this.isAlt })
            );
          case "ability":
            return actor.items.get(id)?.rollAbility();
          case "item":
            return actor.items.get(id)?.postToChat();
          case "attack":
            return actor.type === "character"
              ? actor.rollUniversalAttack(id, { free: this.isShift })
              : actor.rollMonsterAttack(id);
          case "stat":
            return actor.rollStat(id);
          case "save":
            return actor.rollSave();
          case "skill":
            return actor.rollSkill(id);
          case "artisan":
            return actor.rollArtisan(id);
          case "gathering":
            return actor.rollGathering(id);
          case "utility":
            if (id === "initiative") return actor.rollInitiativeCheck();
            if (id === "rest") return actor.takeRest();
            if (id === "injury") return actor.rollInjury();
            return undefined;
          default:
            return undefined;
        }
      }
    }

    class LyrianSystemManager extends coreModule.api.SystemManager {
      /** @override */
      getActionHandler() { return new LyrianActionHandler(); }

      /** @override */
      getAvailableRollHandlers() { return { core: "Lyrian Chronicles" }; }

      /** @override */
      getRollHandler() { return new LyrianRollHandler(); }

      /** @override */
      async registerDefaults() {
        const groups = Object.fromEntries(Object.entries(GROUP).map(([key, group]) => [
          key,
          { ...group, name: i18n(group.name), listName: `Group: ${i18n(group.name)}` }
        ]));
        return {
          layout: [
            {
              nestId: "combat",
              id: "combat",
              name: i18n("LYRIAN.TAH.Tab.Combat"),
              groups: [
                { ...groups.weapons, nestId: "combat_weapons" },
                { ...groups.attacks, nestId: "combat_attacks" },
                { ...groups.actions, nestId: "combat_actions" },
                { ...groups.reactions, nestId: "combat_reactions" }
              ]
            },
            {
              nestId: "checks",
              id: "checks",
              name: i18n("LYRIAN.TAH.Tab.Checks"),
              groups: [
                { ...groups.stats, nestId: "checks_stats" },
                { ...groups.skills, nestId: "checks_skills" },
                { ...groups.artisan, nestId: "checks_artisan" },
                { ...groups.gathering, nestId: "checks_gathering" }
              ]
            },
            {
              nestId: "inventory",
              id: "inventory",
              name: i18n("LYRIAN.TAH.Tab.Inventory"),
              groups: [
                { ...groups.armor, nestId: "inventory_armor" },
                { ...groups.gear, nestId: "inventory_gear" }
              ]
            },
            {
              nestId: "utility",
              id: "utility",
              name: i18n("LYRIAN.TAH.Tab.Utility"),
              groups: [
                { ...groups.passives, nestId: "utility_passives" },
                { ...groups.downtime, nestId: "utility_downtime" },
                { ...groups.utility, nestId: "utility_utility" }
              ]
            }
          ],
          groups: Object.values(groups)
        };
      }
    }

    // TAH Core reads only `.api`, so a module-shaped object is enough and the
    // system needs no companion package to be installed alongside it.
    Hooks.callAll("tokenActionHudSystemReady", {
      id: SYSTEM_ID,
      api: {
        requiredCoreModuleVersion: REQUIRED_CORE_VERSION,
        SystemManager: LyrianSystemManager
      }
    });
  });
}

function signed(value) {
  const number = Number(value) || 0;
  return number >= 0 ? `+${number}` : String(number);
}
