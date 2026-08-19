import { LYRIAN } from "../config.mjs";
import { adjustResourcePool } from "../rules/resource-utils.mjs";
import {
  canonicalProficiency,
  collectActorProficiencies,
  proficiencyKey
} from "../rules/proficiencies.mjs";
import {
  normalizeClassLevel,
  raceAncestryRequirement,
  raceSkillGrant,
  selectedRaceSkillBonuses
} from "../rules/progression.mjs";
import { collectWorshipBenefits, DIVINES } from "../rules/worship.mjs";
import { convertOfficialEquipment } from "../rules/equipment-import.mjs";
import { confirmItemRequirements } from "../rules/requirements.mjs";
import {
  compatibleModTargets,
  installedModFlag,
  isCompatibleModTarget,
  isCraftingMod
} from "../rules/mod-installation.mjs";
import { hybridAncestryFamily } from "../rules/hybrid-race.mjs";
import { isHeaderOnlyRender } from "../rules/sheet-refresh.mjs";
import { captureScroll, restoreScroll } from "../rules/scroll-state.mjs";
import { withCollapsed } from "../rules/collapsible.mjs";
import { weaponsDisplacedBy } from "../rules/weapon-slots.mjs";
import { pendingDualWieldWeaponId } from "../rules/dual-wield.mjs";
import { damageTypeChoices, resolveDamageType } from "../rules/damage-types.mjs";
import { queueDocumentWrite } from "../rules/action-transactions.mjs";
import {
  CUSTOM_OUTPUT_TYPES,
  normalizeCraftProject
} from "../rules/crafting.mjs";

const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Character and NPC sheet.
 */
export class LyrianActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["lyrian", "sheet", "actor"],
    position: { width: 820, height: 800 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      rollSkill: LyrianActorSheet.#onRollSkill,
      addExpertise: LyrianActorSheet.#onAddExpertise,
      removeExpertise: LyrianActorSheet.#onRemoveExpertise,
      rollAttribute: LyrianActorSheet.#onRollAttribute,
      rollArtisan: LyrianActorSheet.#onRollArtisan,
      rollGathering: LyrianActorSheet.#onRollGathering,
      rollSave: LyrianActorSheet.#onRollSave,
      rollInitiative: LyrianActorSheet.#onRollInitiative,
      rollInjury: LyrianActorSheet.#onRollInjury,
      attack: LyrianActorSheet.#onAttack,
      universalAttack: LyrianActorSheet.#onUniversalAttack,
      multiAttack: LyrianActorSheet.#onMultiAttack,
      monsterAttack: LyrianActorSheet.#onMonsterAttack,
      useItem: LyrianActorSheet.#onUseItem,
      postItem: LyrianActorSheet.#onPostItem,
      browsePack: LyrianActorSheet.#onBrowsePack,
      adjustClassLevel: LyrianActorSheet.#onAdjustClassLevel,
      allocateRaceSkills: LyrianActorSheet.#onAllocateRaceSkills,
      chooseRequiredAncestry: LyrianActorSheet.#onChooseRequiredAncestry,
      addProficiency: LyrianActorSheet.#onAddProficiency,
      removeProficiency: LyrianActorSheet.#onRemoveProficiency,
      createItem: LyrianActorSheet.#onCreateItem,
      editItem: LyrianActorSheet.#onEditItem,
      deleteItem: LyrianActorSheet.#onDeleteItem,
      toggleEquip: LyrianActorSheet.#onToggleEquip,
      adjustResource: LyrianActorSheet.#onAdjustResource,
      refreshTurn: LyrianActorSheet.#onRefreshTurn,
      startEncounter: LyrianActorSheet.#onStartEncounter,
      takeRest: LyrianActorSheet.#onTakeRest,
      recoverInjury: LyrianActorSheet.#onRecoverInjury,
      spendExpPrompt: LyrianActorSheet.#onSpendExp,
      openCharacterCreation: LyrianActorSheet.#onOpenCharacterCreation,
      addProject: LyrianActorSheet.#onAddProject,
      removeProject: LyrianActorSheet.#onRemoveProject,
      addProjectMaterial: LyrianActorSheet.#onAddProjectMaterial,
      removeProjectMaterial: LyrianActorSheet.#onRemoveProjectMaterial,
      addProjectMod: LyrianActorSheet.#onAddProjectMod,
      removeProjectMod: LyrianActorSheet.#onRemoveProjectMod,
      attemptCraft: LyrianActorSheet.#onAttemptCraft,
      setProjectOutput: LyrianActorSheet.#onSetProjectOutput
    },
    dragDrop: [{ dragSelector: "[data-drag]", dropSelector: null }]
  };

  /** @override */
  static PARTS = {
    header: { template: "systems/lyrian-chronicles/templates/actor/header.hbs" },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    main: { template: "systems/lyrian-chronicles/templates/actor/tab-main.hbs" },
    skills: { template: "systems/lyrian-chronicles/templates/actor/tab-skills.hbs" },
    proficiencies: { template: "systems/lyrian-chronicles/templates/actor/tab-proficiencies.hbs" },
    abilities: { template: "systems/lyrian-chronicles/templates/actor/tab-abilities.hbs" },
    inventory: { template: "systems/lyrian-chronicles/templates/actor/tab-inventory.hbs" },
    crafting: { template: "systems/lyrian-chronicles/templates/actor/tab-crafting.hbs" },
    progression: { template: "systems/lyrian-chronicles/templates/actor/tab-progression.hbs" },
    biography: { template: "systems/lyrian-chronicles/templates/actor/tab-biography.hbs" },
    setup: { template: "systems/lyrian-chronicles/templates/actor/tab-setup.hbs" }
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "main", icon: "fa-solid fa-shield-halved", label: "LYRIAN.Tab.main" },
        { id: "skills", icon: "fa-solid fa-dice-d20", label: "LYRIAN.Tab.skills" },
        { id: "proficiencies", icon: "fa-solid fa-shield", label: "LYRIAN.Tab.proficiencies" },
        { id: "abilities", icon: "fa-solid fa-wand-sparkles", label: "LYRIAN.Tab.abilities" },
        { id: "inventory", icon: "fa-solid fa-sack", label: "LYRIAN.Tab.inventory" },
        { id: "crafting", icon: "fa-solid fa-hammer", label: "LYRIAN.Tab.crafting" },
        { id: "progression", icon: "fa-solid fa-gem", label: "LYRIAN.Tab.progression" },
        { id: "biography", icon: "fa-solid fa-feather", label: "LYRIAN.Tab.biography" },
        { id: "setup", icon: "fa-solid fa-gears", label: "LYRIAN.Tab.setup" }
      ],
      initial: "main"
    }
  };

  /* -------------------------------------------- */

  /** @override */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    // NPCs have no skill sheet or interlude bookkeeping.
    if (this.document.type === "npc" || this.document.type === "monster") {
      delete parts.skills;
      delete parts.proficiencies;
      delete parts.crafting;
      delete parts.progression;
      delete parts.setup;
    }
    return parts;
  }

  /** @override */
  _prepareTabs(group) {
    const tabs = super._prepareTabs(group);
    if (this.document.type === "npc" || this.document.type === "monster") {
      delete tabs.skills;
      delete tabs.proficiencies;
      delete tabs.crafting;
      delete tabs.progression;
      delete tabs.setup;
    }
    for (const tab of Object.values(tabs)) {
      if (typeof tab.label === "string") tab.label = game.i18n.localize(tab.label);
    }
    return tabs;
  }

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.document;

    context.actor = actor;
    context.system = actor.system;
    context.config = LYRIAN;
    context.isCharacter = actor.type === "character";
    context.isNPC = actor.type === "npc" || actor.type === "monster";
    context.editable = this.isEditable;
    context.isGM = game.user.isGM;
    context.systemFields = actor.system.schema.fields;

    // Resource updates repaint only the persistent header. Avoid enriching
    // biography fields and rebuilding every item/skill bucket for four numbers.
    if (isHeaderOnlyRender(options)) {
      if (context.isCharacter) this._prepareWorship(context);
      return context;
    }

    context.enrichedBiography = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      actor.system.biography ?? "",
      { relativeTo: actor, rollData: actor.getRollData() }
    );

    if (context.isNPC) {
      context.enrichedTactics = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
        actor.system.tactics ?? "",
        { relativeTo: actor }
      );
      context.enrichedRunningMonster = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
        actor.system.runningMonster ?? "",
        { relativeTo: actor }
      );
    }

    this._prepareStats(context);
    this._prepareItems(context);
    context.equipmentConflicts = [
      ...(actor.system.equipment?.armorConflicts ?? []).map(({ slot, active, item }) => ({
        message: game.i18n.format("LYRIAN.Warn.EquipmentConflict", {
          slot: game.i18n.localize(slot === "shield" ? "LYRIAN.UI.Shield" : "LYRIAN.UI.BodyArmour"),
          active: active.name,
          ignored: item.name
        })
      })),
      // A weapon with no hand free is inactive for the same reason a second
      // suit of armour is, and the inventory is where a reader looks to find
      // out why something they equipped is doing nothing.
      ...(actor.system.equipment?.weaponConflicts ?? []).map((item) => ({
        message: game.i18n.format("LYRIAN.Warn.WeaponConflict", { ignored: item.name })
      }))
    ];
    if (context.isCharacter) this._prepareSkills(context);
    if (context.isCharacter) this._prepareCrafting(context);
    if (context.isCharacter) this._prepareProficiencies(context);
    if (context.isCharacter) this._prepareWorship(context);

    return context;
  }

  /* -------------------------------------------- */

  /** @override */
  async _preparePartContext(partId, context) {
    context = await super._preparePartContext(partId, context);
    if (partId in (context.tabs ?? {})) context.tab = context.tabs[partId];
    return context;
  }

  /* -------------------------------------------- */

  /** Build display-friendly stat blocks. */
  _prepareStats(context) {
    context.mainStats = Object.entries(LYRIAN.mainStats).map(([key, label]) => ({
      key,
      label: game.i18n.localize(label),
      ...context.system.stats[key]
    }));

    context.subStatList = Object.entries(LYRIAN.subStats).map(([key, label]) => ({
      key,
      label: game.i18n.localize(label),
      ...context.system.subStats[key]
    }));
  }

  /* -------------------------------------------- */

  /** Group skills under their governing sub stat for display. */
  _prepareSkills(context) {
    const groups = {};
    for (const [key, def] of Object.entries(LYRIAN.skills)) {
      const stat = def.stat;
      groups[stat] ??= {
        key: stat,
        label: game.i18n.localize(LYRIAN.subStats[stat]),
        value: context.system.subStats[stat].total,
        skills: []
      };
      groups[stat].skills.push({
        key,
        label: game.i18n.localize(def.label),
        ...context.system.skills[key]
      });
    }
    context.skillGroups = Object.values(groups);

    context.artisanList = Object.entries(LYRIAN.artisanSkills).map(([key, label]) => ({
      key,
      label: game.i18n.localize(label),
      ...context.system.artisan[key]
    }));

    context.gatheringList = Object.entries(LYRIAN.gatheringSkills).map(([key, label]) => ({
      key,
      label: game.i18n.localize(label),
      ...context.system.gathering[key]
    }));

    context.skillCapLabel = Number.isFinite(context.system.skillCap)
      ? context.system.skillCap
      : "∞";
  }

  /** Prepare free-form projects and owned Gear stacks for the Crafting tab. */
  _prepareCrafting(context) {
    context.craftingProjects = Array.from(
      context.system.crafting?.projects ?? [],
      (project) => normalizeCraftProject(project)
    );
    context.craftingMaterialOptions = this.document.items
      // An installed Mod is Gear carrying a flag, so it would otherwise be
      // offered as raw material and consumed off the item it is fitted to.
      .filter((item) => item.type === "gear"
        && !item.getFlag("lyrian-chronicles", "installedMod"))
      .map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.system.quantity ?? 0
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    context.craftingModOptions = this.document.items
      .filter((item) => isCraftingMod(item)
        && !item.getFlag("lyrian-chronicles", "installedMod"))
      .map((item) => ({ id: item.id, name: item.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    context.craftingOutputTypes = CUSTOM_OUTPUT_TYPES.map((type) => ({
      key: type,
      label: game.i18n.localize(`LYRIAN.Craft.OutputType.${type}`)
    }));
    // Players author their own projects only when the table has opted in.
    context.canEditProjects = context.isGM
      || game.settings.get("lyrian-chronicles", "craftingPlayerProjects");
    context.taskDifficulties = Object.entries(LYRIAN.taskDifficulty).map(([dc, label]) => ({
      dc: Number(dc),
      label: game.i18n.localize(label)
    }));
  }

  /** Collect automatic and player-selected proficiencies without duplicates. */
  _prepareProficiencies(context) {
    const proficiency = collectActorProficiencies(this.document);
    proficiency.automatic = Object.fromEntries(
      Object.entries(proficiency.groups).map(([kind, entries]) => [
        kind, entries.filter((entry) => entry.granted)
      ])
    );
    for (const source of proficiency.sources) {
      for (const choice of source.choices) choice.title = game.i18n.localize(choice.titleKey);
    }
    context.proficiency = proficiency;
  }

  /** Explain whether the selected worship has an active rules benefit. */
  _prepareWorship(context) {
    context.divines = Object.values(DIVINES);
    context.worship = collectWorshipBenefits(this.document);
  }

  /* -------------------------------------------- */

  /** Sort owned items into sheet sections. */
  _prepareItems(context) {
    const buckets = {
      weapons: [],
      armor: [],
      abilities: [],
      reactions: [],
      encounterStart: [],
      encounterConclusion: [],
      passives: [],
      classes: [],
      breakthroughs: [],
      races: [],
      gear: [],
      equipment: [],
      injuries: [],
      installedMods: [],
      modStock: []
    };

    for (const item of this.document.items) {
      switch (item.type) {
        case "weapon":
          buckets.weapons.push(item);
          break;
        case "armor":
          buckets.armor.push(item);
          break;
        case "ability":
        case "monsterAbility":
          if (item.system.timing === "passive") buckets.passives.push(item);
          else if (item.system.timing === "encounterStart") buckets.encounterStart.push(item);
          else if (item.system.timing === "encounterConclusion")
            buckets.encounterConclusion.push(item);
          else if (item.system.isReaction) buckets.reactions.push(item);
          else buckets.abilities.push(item);
          break;
        case "class":
          buckets.classes.push(item);
          break;
        case "breakthrough":
          buckets.breakthroughs.push(item);
          break;
        case "race":
          buckets.races.push(item);
          break;
        case "gear":
          if (item.getFlag("lyrian-chronicles", "installedMod")) buckets.installedMods.push(item);
          else buckets.gear.push(item);
          break;
        case "equipment":
          // Mods keep the equipment type so their install data survives, but
          // they are stock for crafting, not "other official gear".
          if (isCraftingMod(item)) buckets.modStock.push(item);
          else buckets.equipment.push(item);
          break;
        case "injury":
          buckets.injuries.push(item);
          break;
      }
    }

    context.items = buckets;
    // Always offered. An ability can call for an unarmed strike while a weapon
    // is held, and hiding the row left no way to roll one.
    context.showUniversalAttacks = context.isCharacter;
    context.heldWeapons = context.system.equipment?.weapons ?? [];
    context.weaponConflicts = context.system.equipment?.weaponConflicts ?? [];
    context.dualWielding = Boolean(context.system.equipment?.dualWielding);

    // The overview lists what is in hand. Everything else is offered as a
    // switch rather than a second set of attack buttons, so the sheet can
    // never show two weapons swinging at once.
    const heldIds = new Set(context.heldWeapons.map((weapon) => weapon.id));
    // The off-hand light attack that is currently free, so the button can say
    // 0 AP rather than leaving the player to spend AP finding out.
    const freeWeaponId = pendingDualWieldWeaponId({
      mainHandId: context.system.equipment?.mainHand?.id ?? "",
      offHandId: context.system.equipment?.offHand?.id ?? "",
      dualWielding: context.dualWielding,
      openerId: context.system.turn?.dualWieldOpenerId ?? "",
      used: Boolean(context.system.turn?.dualWieldUsed)
    });
    context.weaponRows = buckets.weapons.map((weapon) => ({
      item: weapon,
      held: heldIds.has(weapon.id),
      // Equipped, but there is no hand free for it.
      conflicted: Boolean(weapon.system.equipped) && !heldIds.has(weapon.id),
      dualWieldFree: weapon.id === freeWeaponId,
      // Grouped per row with the current type already marked, so the picker
      // needs no comparison and no depth-climbing in the template.
      damageTypeChoices: damageTypeChoices(LYRIAN.damageTypes, {
        localize: (key) => game.i18n.localize(key),
        selected: weapon.system.damageType
      })
    }));

    // The same picker for unarmed strikes, whose type lives on the actor
    // because there is no weapon Item to carry it.
    context.universalDamageTypeChoices = damageTypeChoices(LYRIAN.damageTypes, {
      localize: (key) => game.i18n.localize(key),
      selected: context.system.universalDamageType
    });

    // A deleted target must not make its installed Mod disappear from the sheet.
    const ownedIds = new Set(this.document.items.map((item) => item.id));
    const orphaned = buckets.installedMods.filter((mod) =>
      !ownedIds.has(mod.getFlag("lyrian-chronicles", "installedMod")?.targetItemId));
    if (orphaned.length) {
      buckets.gear.push(...orphaned);
      buckets.installedMods = buckets.installedMods.filter((mod) => !orphaned.includes(mod));
    }

    const granted = this.document.items.filter(
      (item) => item.type === "ability" && item.getFlag("lyrian-chronicles", "featureSource")
    );
    const grantedIds = new Set(granted.map((item) => item.id));
    for (const key of ["abilities", "reactions", "encounterStart", "encounterConclusion", "passives"]) {
      buckets[key] = buckets[key].filter((item) => !grantedIds.has(item.id));
    }

    // One list rather than four. Splitting actions, reactions and the two
    // encounter timings into separate sections meant deciding which heading an
    // ability belonged under before you could find it; the timing is shown on
    // each row instead. Order still reads actions, reactions, then encounter.
    buckets.activeAbilities = [
      ...buckets.abilities,
      ...buckets.reactions,
      ...buckets.encounterStart,
      ...buckets.encounterConclusion
    ];

    const featureView = (item) => ({
      item,
      role: item.getFlag("lyrian-chronicles", "featureSource")?.role ?? "Trait",
      requiredLevel: item.getFlag("lyrian-chronicles", "featureSource")?.requiredLevel ?? 0,
      usable: item.system.timing !== "passive"
    });
    context.racialTraits = granted.filter(
      (item) => item.getFlag("lyrian-chronicles", "featureSource")?.kind === "race"
    ).map(featureView);
    context.classGroups = buckets.classes.map((classItem) => ({
      item: classItem,
      level: classItem.system.abilitiesUnlocked,
      features: granted
        .filter((item) => item.getFlag("lyrian-chronicles", "featureSource")?.sourceItemId === classItem.id)
        .sort((a, b) => (a.system.classStep ?? 0) - (b.system.classStep ?? 0))
        .map(featureView)
    }));

    const primaryRace = buckets.races.find((item) => item.system.raceKind === "primary");
    const ancestry = buckets.races.find((item) => item.system.raceKind === "ancestry");
    const hybrid = primaryRace?.getFlag("lyrian-chronicles", "hybridRace");
    const variant = primaryRace?.system.variants?.find(
      (choice) => choice.key === primaryRace.system.selectedVariant
    );
    context.raceSummary = primaryRace ? {
      primary: primaryRace,
      ancestry,
      variant,
      displayName: hybrid?.displayName ?? primaryRace.name
    } : null;
    const expectedAncestryRace = hybrid?.ancestryPrimaryRace
      || hybridAncestryFamily(hybrid?.type, primaryRace?.name)
      || primaryRace?.name;
    const ancestryRule = raceAncestryRequirement(expectedAncestryRace);
    context.ancestryRequirement = ancestryRule ? {
      ...ancestryRule,
      missing: !ancestry || ancestry.system.primaryRace !== expectedAncestryRace
    } : null;
    context.raceRows = buckets.races.map((item) => {
      const selection = selectedRaceSkillBonuses(item.system);
      return { item, ...selection };
    });

    // EXP actually committed to classes and breakthroughs, for cross-checking Spirit Core.
    context.expInClasses = buckets.classes.reduce((n, c) => n + c.system.expInvested, 0);
    context.expInBreakthroughs = buckets.breakthroughs.reduce(
      (n, b) => n + b.system.expCost,
      0
    );
  }

  /* -------------------------------------------- */

  /**
   * Expertise inputs are handled by hand.
   *
   * Foundry expands a form name like `system.skills.athletics.expertises.0.name`
   * into an object keyed "0", which an ArrayField rejects. So these inputs are
   * kept out of the form submission and written as a complete array instead.
   */
  /** Offsets held between the pre-sync capture and the post-render restore. */
  #scrollOffsets = null;

  /**
   * @override
   * Capture once, before the first part is swapped out. Nineteen handlers here
   * write to the document and each write re-renders, so without this, adding an
   * expertise or stepping a class level threw the reader back to the top.
   */
  _preSyncPartState(partId, newElement, priorElement, state) {
    super._preSyncPartState?.(partId, newElement, priorElement, state);
    this.#scrollOffsets ??= captureScroll(this.element);
  }

  /**
   * Attach a listener to each element exactly once.
   *
   * _onRender runs after every render, including the header-only repaint that
   * follows any resource change — and that repaint leaves the other parts'
   * DOM untouched. Binding unconditionally therefore stacked another listener
   * on the same element every time a player spent AP, so one later click on a
   * section header ran the fold handler several times and flipped it back and
   * forth. Replaced elements are new nodes without the mark, so they still get
   * wired exactly once.
   *
   * The mark records the selector as well as the event type. Keyed on the type
   * alone, a second same-type listener on an element already bound by another
   * selector would be dropped without a trace.
   */
  #bindOnce(selector, type, handler) {
    const key = `${type}|${selector}`;
    for (const element of this.element.querySelectorAll(selector)) {
      const bound = element.dataset.lyrianBound?.split("\n") ?? [];
      if (bound.includes(key)) continue;
      element.dataset.lyrianBound = [...bound, key].join("\n");
      element.addEventListener(type, handler);
    }
  }

  _onRender(context, options) {
    super._onRender?.(context, options);

    // Remember which sections the reader folded away. Stored on the User, so
    // two players viewing one sheet do not overwrite each other's view.
    // Folding is driven by a deliberate click on the header, never by the
    // toggle event. Several headers carry an Add button, and a click anywhere
    // in a summary opens or closes the section — so listening to toggle meant
    // pressing Add both created the item and folded away the list it went
    // into, which then also shortened the page and threw the scroll to the top.
    this.#bindOnce("details[data-collapse-scope] > summary", "click", async (event) => {
      // Let controls inside the header do their own job, without folding.
      if (event.target.closest("button, a, input, select, textarea, [data-action]")) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      const section = event.currentTarget.closest("details[data-collapse-scope]");
      const { collapseScope, collapseId } = section.dataset;
      const collapsed = section.open;
      section.open = !collapsed;
      // Serialized: folding two sections quickly meant both handlers read the
      // same stored value and the second write dropped the first fold.
      await queueDocumentWrite(game.user, async () => {
        const state = game.user.getFlag("lyrian-chronicles", "collapsedSections") ?? {};
        await game.user.setFlag(
          "lyrian-chronicles",
          "collapsedSections",
          withCollapsed(state, collapseScope, collapseId, collapsed)
        );
      });
    });

    this.#bindOnce("[data-expertise-field]", "change", async (event) => {
      const { group, skill } = event.currentTarget.dataset;
      const rows = this.element.querySelectorAll(
        `[data-expertise-row][data-group="${group}"][data-skill="${skill}"]`
      );

      const expertises = Array.from(rows).map((row) => ({
        name: row.querySelector("[data-expertise-name]")?.value ?? "",
        rank: Number(row.querySelector("[data-expertise-rank]")?.value ?? 0)
      }));

      await this.document.update({ [`system.${group}.${skill}.expertises`]: expertises });
    });

    // Proficiency choices save as soon as the player changes them. These
    // controls intentionally have no form names, so the normal sheet submit
    // cannot duplicate or flatten the source-owned selection data.
    this.#bindOnce("[data-proficiency-choice-value]", "change", async (event) => {
      const row = event.currentTarget.closest("[data-proficiency-choice]");
      if (row) await LyrianActorSheet.#onSaveProficiencyChoice.call(this, event, row);
    });

    // Project fields have no form names because nested ArrayFields do not round-trip
    // through Foundry form expansion. Persist the complete project list instead.
    this.#bindOnce("[data-crafting-field]", "change", async () => {
      // The controls are also disabled in the template, but that is markup a
      // client can edit. Every other project write checks this, so this one must.
      if (!this._mayEditProjects()) return;
      await this.document.update({
        "system.crafting.projects": this._readCraftingProjects()
      });
    });

    // Damage type pickers on the attack rows. No form names: a weapon's type
    // lives on the Item, and a name= here would aim the actor's own submit at
    // a path it does not have.
    this.#bindOnce("[data-damage-type]", "change", async (event) => {
      const select = event.currentTarget;
      const damageType = select.value;
      if (!LYRIAN.damageTypes[damageType]) return;
      if (select.dataset.damageType === "universal") {
        await this.document.update({ "system.universalDamageType": damageType });
        return;
      }
      const itemId = select.closest("[data-item-id]")?.dataset.itemId;
      await this.document.items.get(itemId)?.update({ "system.damageType": damageType });
    });

    // Last, once every part is in place and the page is its final height.
    restoreScroll(this.element, this.#scrollOffsets);
    this.#scrollOffsets = null;
  }

  /** Complete race-specific choices when a Race is dragged from a compendium. */
  async _onDropItem(event, item) {
    const outputDrop = event.target?.closest?.("[data-craft-output-drop]");
    const projectRow = outputDrop?.closest?.("[data-crafting-project]");
    if (projectRow && this.document.type === "character") {
      if (!this._mayEditProjects()) return null;
      const index = Number(projectRow.dataset.projectIndex);
      const projects = this._readCraftingProjects();
      if (!projects[index]) return null;
      projects[index].outputUuid = item.uuid;
      projects[index].outputName = item.name;
      projects[index].completed = false;
      await this.document.update({ "system.crafting.projects": projects });
      return item;
    }

    // A Mod installs only when it is dropped onto the item it goes into.
    //
    // It used to install wherever it landed, guessing a target from whatever
    // was compatible. Every Mod in the book is a Universal Armor or Universal
    // Weapon Mod, so that path caught all of them: none could ever be dropped
    // into the inventory as stock, which left the crafting project's Mod list
    // permanently empty — and a Mod dropped with no compatible target owned
    // was discarded with a warning rather than kept.
    if (isCraftingMod(item) && item.system.craftingType !== "Universal Crafting") {
      const targetId = event.target?.closest?.("[data-item-id]")?.dataset.itemId;
      const target = targetId ? this.document.items.get(targetId) : null;
      if (target && isCompatibleModTarget(item, target)) {
        return this.#installMod(event, item);
      }
      // Anything else keeps the Mod: it lands in the inventory as stock, ready
      // to be listed on a crafting project or dragged onto a real target later.
    }

    const result = await super._onDropItem(event, item);
    const owned = Array.isArray(result) ? result[0] : result;
    if (!owned) return result;

    // A Mod that lands in the inventory as stock keeps its own type. Converting
    // it to Gear drops craftingType, modSlot and compatibleTargets — the only
    // fields that make it a Mod — so isCraftingMod stopped recognising it, the
    // crafting tab's Mod list stayed empty and it could no longer be installed
    // on anything either.
    if (owned.type === "equipment" && !isCraftingMod(owned)) {
      const isCharacter = this.document.type === "character";
      const proficiency = isCharacter ? collectActorProficiencies(this.document).groups : null;
      const convertedData = convertOfficialEquipment(owned.toObject(), isCharacter ? {
        weapons: proficiency.weapons.map((entry) => entry.name),
        armor: proficiency.armor.map((entry) => entry.name)
      } : { assumeProficient: true });
      if (!convertedData) return result;

      // Create first so a validation failure never destroys the dropped source.
      const [converted] = await this.document.createEmbeddedDocuments("Item", [convertedData]);
      try {
        await owned.delete();
      } catch (error) {
        await converted.delete();
        throw error;
      }
      const section = game.i18n.localize(`LYRIAN.Inventory.Section.${converted.type}`);
      ui.notifications.info(game.i18n.format("LYRIAN.Inventory.DropAdded", {
        name: converted.name,
        section
      }));
      return Array.isArray(result) ? [converted] : converted;
    }

    if (this.document.type !== "character") return result;
    if (owned.type === "class") {
      const duplicate = this.document.items.find((item) =>
        item.id !== owned.id && item.type === "class" &&
        item.system.stableId && item.system.stableId === owned.system.stableId);
      if (duplicate) {
        await owned.delete();
        ui.notifications.warn(game.i18n.format("LYRIAN.Requirement.Duplicate", { name: owned.name }));
        return null;
      }
      const meetsRequirements = await confirmItemRequirements(this.document, owned);
      if (!meetsRequirements) {
        await owned.delete();
        return null;
      }
      const exp = Number(owned.system.unlockCost ?? owned.system.tier * LYRIAN.progression.classCostPerTier);
      if (this.document.system.exp.available < exp || this.document.system.interlude.points < 1) {
        await owned.delete();
        ui.notifications.warn(game.i18n.format("LYRIAN.Progression.UnlockCost", {
          name: owned.name,
          exp
        }));
        return null;
      }
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.format("LYRIAN.Progression.UnlockTitle", { name: owned.name }) },
        content: `<p>${game.i18n.format("LYRIAN.Progression.UnlockPrompt", { exp })}</p>`
      });
      if (!confirmed) {
        await owned.delete();
        return null;
      }
      await this.document.update({
        "system.exp.spent": this.document.system.exp.spent + exp,
        "system.interlude.points": this.document.system.interlude.points - 1
      });
      await this.document.syncProgressionFeatures();
      return result;
    }
    if (owned.type === "breakthrough") {
      const duplicate = this.document.items.find((item) =>
        item.id !== owned.id && item.type === "breakthrough" &&
        item.system.stableId && item.system.stableId === owned.system.stableId);
      if (duplicate && !owned.system.repeatable) {
        await owned.delete();
        ui.notifications.warn(game.i18n.format("LYRIAN.Requirement.Duplicate", { name: owned.name }));
        return null;
      }
      const meetsRequirements = await confirmItemRequirements(this.document, owned);
      if (!meetsRequirements) {
        await owned.delete();
        return null;
      }
      return result;
    }
    if (owned.type !== "race") return result;

    if (owned.system.raceKind === "ancestry") {
      const primary = this.document.items.find(
        (entry) => entry.type === "race" && entry.system.raceKind === "primary"
      );
      const hybrid = primary?.getFlag("lyrian-chronicles", "hybridRace");
      const expectedPrimaryRace = hybrid?.ancestryPrimaryRace
        || hybridAncestryFamily(hybrid?.type, primary?.name)
        || primary?.name;
      if (!primary || expectedPrimaryRace !== owned.system.primaryRace) {
        await owned.delete();
        ui.notifications.warn(game.i18n.format("LYRIAN.Race.PrimaryRequired", {
          name: owned.name,
          race: expectedPrimaryRace || owned.system.primaryRace
        }));
        return null;
      }
      const older = this.document.items.filter(
        (entry) => entry.type === "race" && entry.id !== owned.id &&
          entry.system.raceKind === "ancestry"
      );
      if (older.length) {
        await this.document.deleteEmbeddedDocuments("Item", older.map((entry) => entry.id));
      }
      await this._promptRaceSkillAllocation(owned);
      await this.document.syncProgressionFeatures();
      return result;
    }

    if (owned.system.raceKind === "primary") {
      const ancestryRule = raceAncestryRequirement(owned.name);
      const ancestrySource = ancestryRule
        ? await this._selectRequiredAncestry(owned, ancestryRule)
        : null;
      if (ancestryRule && !ancestrySource) {
        await owned.delete();
        ui.notifications.warn(game.i18n.format("LYRIAN.Race.AncestryRequired", {
          race: ancestryRule.name,
          count: ancestryRule.count
        }));
        return null;
      }

      const older = this.document.items.filter(
        (entry) => entry.type === "race" && entry.id !== owned.id
      );
      if (older.length) {
        await this.document.deleteEmbeddedDocuments("Item", older.map((entry) => entry.id));
      }

      const automation = owned.system.attributeBonuses ?? {};
      const variants = owned.system.variants ?? [];
      if (automation.chooseMain || automation.chooseSub || variants.length) {
        const options = (table) => Object.entries(table)
          .map(([key, label]) => `<option value="${key}">${game.i18n.localize(label)}</option>`)
          .join("");
        const variantOptions = variants
          .map((choice) => `<option value="${choice.key}">${choice.name}</option>`)
          .join("");
        const choice = await foundry.applications.api.DialogV2.prompt({
          window: { title: game.i18n.format("LYRIAN.Race.ChoicesTitle", { name: owned.name }) },
          content: `<div class="lyrian">
            ${automation.chooseMain ? `<label>${game.i18n.format("LYRIAN.Race.MainStatBonus", { bonus: automation.chooseMain })}<select name="main"><option value="">—</option>${options(LYRIAN.mainStats)}</select></label>` : ""}
            ${automation.chooseSub ? `<label>${game.i18n.format("LYRIAN.Race.SubStatBonus", { bonus: automation.chooseSub })}<select name="sub"><option value="">—</option>${options(LYRIAN.subStats)}</select></label>` : ""}
            ${variants.length ? `<label>${game.i18n.localize("LYRIAN.Race.DemonHouse")}<select name="variant"><option value="">—</option>${variantOptions}</select></label>` : ""}
          </div>`,
          ok: {
            callback: (dialogEvent, button) => ({
              main: button.form.elements.main?.value ?? "",
              sub: button.form.elements.sub?.value ?? "",
              variant: button.form.elements.variant?.value ?? ""
            })
          }
        }).catch(() => null);
        if (choice) {
          await owned.update({
            "system.selectedMainStat": choice.main,
            "system.selectedSubStat": choice.sub,
            "system.selectedVariant": choice.variant
          });
        }
      }

      await this._promptRaceSkillAllocation(owned);
      if (ancestrySource) {
        const ancestry = await this._createSelectedAncestry(ancestrySource);
        await this._promptRaceSkillAllocation(ancestry);
      }
    }

    await this.document.syncProgressionFeatures();
    return result;
  }

  /** Install a dropped crafting Mod on one compatible owned Item. */
  async #installMod(event, mod) {
    const candidates = compatibleModTargets(mod, this.document.items);
    const droppedOnId = event.target?.closest?.("[data-item-id]")?.dataset.itemId;
    let target = droppedOnId ? this.document.items.get(droppedOnId) : null;

    if (target && !candidates.includes(target)) {
      return ui.notifications.warn(game.i18n.format("LYRIAN.Mod.Incompatible", {
        mod: mod.name,
        target: target.name
      }));
    }

    if (!target && candidates.length === 1) target = candidates[0];
    if (!target && candidates.length > 1) {
      const options = candidates.map((item) =>
        `<option value="${item.id}">${foundry.utils.escapeHTML(item.name)}</option>`).join("");
      const targetId = await foundry.applications.api.DialogV2.prompt({
        window: { title: game.i18n.format("LYRIAN.Mod.InstallTitle", { mod: mod.name }) },
        content: `<div class="lyrian"><p>${game.i18n.localize("LYRIAN.Mod.InstallPrompt")}</p>
          <select name="targetId">${options}</select></div>`,
        ok: { callback: (dialogEvent, button) => button.form.elements.targetId?.value }
      }).catch(() => null);
      target = targetId ? this.document.items.get(targetId) : null;
    }

    if (!target) {
      return ui.notifications.warn(game.i18n.format("LYRIAN.Mod.NoTarget", { mod: mod.name }));
    }

    const proficiencies = this.document.type === "character"
      ? collectActorProficiencies(this.document).groups
      : { weapons: [], armor: [] };
    const converted = convertOfficialEquipment(mod.toObject(), this.document.type === "character" ? {
      weapons: proficiencies.weapons.map((entry) => entry.name),
      armor: proficiencies.armor.map((entry) => entry.name)
    } : { assumeProficient: true });
    if (!converted) return null;
    foundry.utils.setProperty(
      converted,
      "flags.lyrian-chronicles.installedMod",
      installedModFlag(mod, target)
    );
    const [installed] = await this.document.createEmbeddedDocuments("Item", [converted]);
    // Installing spends the stock. Without this, dragging an owned Mod onto a
    // weapon left the original in the inventory, so one purchased Mod could be
    // installed on an unlimited number of items.
    if (mod.parent === this.document) await mod.delete();
    ui.notifications.info(game.i18n.format("LYRIAN.Mod.Installed", {
      mod: installed.name,
      target: target.name
    }));
    return installed;
  }

  /** Prompt from the official pack for a valid ancestry belonging to a primary race. */
  async _selectRequiredAncestry(primary, rule = raceAncestryRequirement(primary?.name)) {
    if (!rule) return null;
    const pack = game.packs.get("lyrian-chronicles.races");
    if (!pack) {
      ui.notifications.error(game.i18n.localize("LYRIAN.Race.PackMissing"));
      return null;
    }

    const index = await pack.getIndex({
      fields: ["system.raceKind", "system.primaryRace"]
    });
    const choices = Array.from(index)
      .filter((entry) => entry.system?.raceKind === "ancestry" &&
        entry.system?.primaryRace === primary.name)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!choices.length) {
      ui.notifications.error(game.i18n.format("LYRIAN.Race.NoAncestries", { race: primary.name }));
      return null;
    }

    const escape = foundry.utils.escapeHTML;
    const options = choices.map((entry) =>
      `<option value="${entry._id}">${escape(entry.name)}</option>`
    ).join("");
    const selectedId = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.format("LYRIAN.Race.ChooseAncestryTitle", { race: primary.name }) },
      content: `<div class="lyrian"><p>${game.i18n.format("LYRIAN.Race.ChooseAncestryHint", {
        race: primary.name,
        count: choices.length
      })}</p><label>${game.i18n.localize("LYRIAN.Race.Subrace")}<select name="ancestry">${options}</select></label></div>`,
      ok: { callback: (dialogEvent, button) => button.form.elements.ancestry?.value ?? "" }
    }).catch(() => null);
    return selectedId ? pack.getDocument(selectedId) : null;
  }

  /** Replace the Actor's ancestry with an owned copy of the selected official entry. */
  async _createSelectedAncestry(source) {
    const older = this.document.items.filter(
      (entry) => entry.type === "race" && entry.system.raceKind === "ancestry"
    );
    if (older.length) {
      await this.document.deleteEmbeddedDocuments("Item", older.map((entry) => entry.id));
    }
    const data = source.toObject();
    delete data._id;
    const [ancestry] = await this.document.createEmbeddedDocuments("Item", [data]);
    return ancestry;
  }

  /** Allocate an owned race's restricted skill-point pool. */
  async _promptRaceSkillAllocation(item) {
    const grant = Number(item.system.skillGrant?.points)
      ? item.system.skillGrant
      : raceSkillGrant(item.system.grantedSkills);
    const allowed = (grant.allowedSkills ?? []).filter((key) => LYRIAN.skills[key]);
    if (!grant.points || !allowed.length) return;

    const current = item.system.selectedSkillBonuses ?? {};
    const rows = allowed.map((key) => `<label>${game.i18n.localize(LYRIAN.skills[key].label)}
      <input type="number" name="${key}" min="0" max="${grant.points}" value="${Number(current[key]) || 0}">
    </label>`).join("");
    const choice = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.format("LYRIAN.Race.SkillPointsTitle", { name: item.name }) },
      content: `<div class="lyrian"><p>${game.i18n.format("LYRIAN.Race.SkillPointsPrompt", {
        points: grant.points
      })}</p><div class="lyr-field-grid">${rows}</div></div>`,
      ok: {
        callback: (dialogEvent, button) => Object.fromEntries(
          allowed.map((key) => [
            key,
            Math.max(0, Math.floor(Number(button.form.elements[key]?.value) || 0))
          ])
        )
      }
    }).catch(() => null);
    if (!choice) return;
    const total = Object.values(choice).reduce((sum, value) => sum + value, 0);
    if (total > grant.points) {
      return ui.notifications.warn(game.i18n.format("LYRIAN.Race.SkillPointsLimit", {
        name: item.name,
        points: grant.points
      }));
    }
    await item.update({ "system.selectedSkillBonuses": choice });
  }

  /**
   * Whether this user may author crafting projects.
   * Hiding the controls is presentation; this is what actually holds.
   */
  _mayEditProjects() {
    return game.user.isGM
      || game.settings.get("lyrian-chronicles", "craftingPlayerProjects");
  }

  /** Read the current project editor without using nested form names. */
  _readCraftingProjects() {
    const source = Array.from(
      this.document.system.crafting?.projects ?? [],
      (project) => normalizeCraftProject(project)
    );
    const rows = this.element.querySelectorAll("[data-crafting-project]");
    return Array.from(rows, (row) => {
      const index = Number(row.dataset.projectIndex);
      const current = source[index] ?? normalizeCraftProject();
      const materials = Array.from(
        row.querySelectorAll("[data-crafting-material]"),
        (materialRow) => ({
          itemId: materialRow.querySelector("[data-material-item]")?.value ?? "",
          quantity: Number(materialRow.querySelector("[data-material-quantity]")?.value ?? 0)
        })
      );
      const mods = Array.from(
        row.querySelectorAll("[data-crafting-mod]"),
        (modRow) => ({ itemId: modRow.querySelector("[data-mod-item]")?.value ?? "" })
      );
      return normalizeCraftProject({
        ...current,
        name: row.querySelector("[data-project-name]")?.value ?? current.name,
        skill: row.querySelector("[data-project-skill]")?.value ?? current.skill,
        dc: Number(row.querySelector("[data-project-dc]")?.value ?? current.dc),
        customType: row.querySelector("[data-project-custom-type]")?.value ?? current.customType,
        customName: row.querySelector("[data-project-custom-name]")?.value ?? current.customName,
        materials,
        mods
      });
    });
  }

  /* -------------------------------------------- */
  /*  Actions                                      */
  /* -------------------------------------------- */

  static async #onAddProject() {
    if (!this._mayEditProjects()) return;
    const projects = this._readCraftingProjects();
    projects.push(normalizeCraftProject());
    await this.document.update({ "system.crafting.projects": projects });
  }

  static async #onRemoveProject(event, target) {
    if (!this._mayEditProjects()) return;
    const index = Number(target.dataset.projectIndex);
    const projects = this._readCraftingProjects().filter((_, row) => row !== index);
    await this.document.update({ "system.crafting.projects": projects });
  }

  static async #onAddProjectMaterial(event, target) {
    if (!this._mayEditProjects()) return;
    const index = Number(target.dataset.projectIndex);
    const projects = this._readCraftingProjects();
    if (!projects[index]) return;
    projects[index].materials.push({ itemId: "", quantity: 0 });
    await this.document.update({ "system.crafting.projects": projects });
  }

  static async #onRemoveProjectMaterial(event, target) {
    if (!this._mayEditProjects()) return;
    const projectIndex = Number(target.dataset.projectIndex);
    const materialIndex = Number(target.dataset.materialIndex);
    const projects = this._readCraftingProjects();
    if (!projects[projectIndex]) return;
    projects[projectIndex].materials = projects[projectIndex].materials
      .filter((_, index) => index !== materialIndex);
    await this.document.update({ "system.crafting.projects": projects });
  }

  static async #onAddProjectMod(event, target) {
    if (!this._mayEditProjects()) return;
    const index = Number(target.dataset.projectIndex);
    const projects = this._readCraftingProjects();
    if (!projects[index]) return;
    projects[index].mods.push({ itemId: "" });
    await this.document.update({ "system.crafting.projects": projects });
  }

  static async #onRemoveProjectMod(event, target) {
    if (!this._mayEditProjects()) return;
    const projectIndex = Number(target.dataset.projectIndex);
    const modIndex = Number(target.dataset.modIndex);
    const projects = this._readCraftingProjects();
    if (!projects[projectIndex]) return;
    projects[projectIndex].mods = projects[projectIndex].mods
      .filter((_, index) => index !== modIndex);
    await this.document.update({ "system.crafting.projects": projects });
  }

  static async #onAttemptCraft(event, target) {
    const index = Number(target.dataset.projectIndex);
    await this.document.update({
      "system.crafting.projects": this._readCraftingProjects()
    });
    await this.document.attemptCraft(index);
  }

  static async #onSetProjectOutput(event, target) {
    if (!this._mayEditProjects()) return;
    const index = Number(target.dataset.projectIndex);
    const projects = this._readCraftingProjects();
    if (!projects[index]) return;
    projects[index].outputUuid = "";
    projects[index].outputName = "";
    projects[index].completed = false;
    await this.document.update({ "system.crafting.projects": projects });
  }

  static async #onRollSkill(event, target) {
    const index = target.dataset.expertiseIndex;
    await this.document.rollSkill(target.dataset.skill, {
      expertiseIndex: index === undefined ? undefined : Number(index)
    });
  }

  static async #onRollArtisan(event, target) {
    const index = target.dataset.expertiseIndex;
    await this.document.rollArtisan(target.dataset.skill, {
      expertiseIndex: index === undefined ? undefined : Number(index)
    });
  }

  /** Append a blank expertise to a skill. */
  static async #onAddExpertise(event, target) {
    const { group, skill } = target.dataset;
    const path = `system.${group}.${skill}.expertises`;
    const current = foundry.utils.getProperty(this.document, path) ?? [];
    await this.document.update({
      [path]: [...current.map((e) => ({ name: e.name, rank: e.rank })), { name: "", rank: 0 }]
    });
  }

  static async #onRemoveExpertise(event, target) {
    const { group, skill, index } = target.dataset;
    const path = `system.${group}.${skill}.expertises`;
    const current = foundry.utils.getProperty(this.document, path) ?? [];
    const next = current
      .map((e) => ({ name: e.name, rank: e.rank }))
      .filter((_, i) => i !== Number(index));
    await this.document.update({ [path]: next });
  }

  static async #onRollGathering(event, target) {
    await this.document.rollGathering(target.dataset.skill);
  }

  static async #onRollSave() {
    await this.document.rollSave();
  }

  static async #onRollInitiative() {
    await this.document.rollInitiativeCheck();
  }

  static async #onRollInjury() {
    await this.document.rollInjury();
  }

  static async #onAttack(event, target) {
    const item = this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (!item) return;
    await item.rollAttack(target.dataset.attackType, { free: event.shiftKey });
  }

  static async #onUniversalAttack(event, target) {
    await this.document.rollUniversalAttack(target.dataset.attackType, { free: event.shiftKey });
  }

  /** Ask how many of each attack type to make, then resolve them together. */
  static async #onMultiAttack(event, target) {
    const itemId = target.closest("[data-item-id]")?.dataset.itemId ?? "";
    const available = this.document.system.ap.total;
    const rows = Object.entries(LYRIAN.attackTypes).map(([key, profile]) => `
      <label class="lyr-multi-attack__row">
        <span>${game.i18n.localize(profile.label)}</span>
        <em>${game.i18n.format("LYRIAN.Attack.MultiApEach", { ap: profile.ap })}</em>
        <input type="number" name="${key}" value="0" min="0" step="1" />
      </label>`).join("");

    const counts = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("LYRIAN.Attack.MultiTitle") },
      content: `<div class="lyrian lyr-multi-attack">
        <p class="lyr-note">${game.i18n.format("LYRIAN.Attack.MultiHint", { ap: available })}</p>
        ${rows}
      </div>`,
      ok: {
        label: game.i18n.localize("LYRIAN.Attack.MultiConfirm"),
        callback: (dialogEvent, button) => Object.fromEntries(
          Object.keys(LYRIAN.attackTypes).map((key) => [
            key, Number(button.form.elements[key]?.value) || 0
          ])
        )
      }
    }).catch(() => null);
    if (!counts) return;

    await this.document.rollMultiAttack({ itemId, counts, free: event.shiftKey });
  }

  static async #onMonsterAttack(event, target) {
    await this.document.rollMonsterAttack(target.dataset.attackType, { free: event.shiftKey });
  }

  /** Open a system compendium so its entries can be dragged onto the sheet. */
  static async #onBrowsePack(event, target) {
    const packName = target.dataset.pack;
    const allowed = new Set([
      "breakthroughs", "player-abilities", "races", "classes", "crafting-guide",
      "weapons", "armor-shields", "consumables", "gear-kits", "artifices", "materials", "mods",
      "monster-abilities"
    ]);
    if (!allowed.has(packName)) return;

    const pack = game.packs.get(`lyrian-chronicles.${packName}`);
    if (!pack) return ui.notifications.warn(game.i18n.format("LYRIAN.Warn.CompendiumMissing", {
      pack: packName
    }));
    if (typeof pack.render === "function") return pack.render(true);
    return pack.application?.render(true);
  }

  static async #onAdjustClassLevel(event, target) {
    const item = this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (!item || item.type !== "class") return;
    const delta = Number(target.dataset.delta ?? 0);
    const level = normalizeClassLevel(item.system.abilitiesUnlocked + delta);
    if (level === item.system.abilitiesUnlocked) return;

    if (delta < 0) {
      if (!game.user.isGM) return ui.notifications.warn(game.i18n.localize("LYRIAN.Progression.LowerGMOnly"));
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.format("LYRIAN.Progression.LowerTitle", { name: item.name }) },
        content: `<p>${game.i18n.localize("LYRIAN.Progression.LowerPrompt")}</p>`
      });
      if (!confirmed) return;
    } else {
      const exp = LYRIAN.progression.abilityCost;
      if (this.document.system.exp.available < exp) {
        return ui.notifications.warn(game.i18n.format("LYRIAN.Warn.NeedsExp", {
          name: this.document.name,
          exp
        }));
      }
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.format("LYRIAN.Progression.AdvanceTitle", { name: item.name }) },
        content: `<p>${game.i18n.format("LYRIAN.Progression.AdvancePrompt", { exp })}</p>`
      });
      if (!confirmed) return;
      const paid = await this.document.spendExp(exp, game.i18n.format("LYRIAN.Progression.ClassLevel", {
        name: item.name,
        level
      }));
      if (!paid) return;
    }
    await item.update({ "system.abilitiesUnlocked": level });
    await this.document.syncProgressionFeatures();
  }

  static async #onAllocateRaceSkills(event, target) {
    const item = this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (!item || item.type !== "race") return;
    await this._promptRaceSkillAllocation(item);
  }

  static async #onChooseRequiredAncestry() {
    const primary = this.document.items.find(
      (item) => item.type === "race" && item.system.raceKind === "primary"
    );
    const rule = raceAncestryRequirement(primary?.name);
    if (!primary || !rule) return;
    const source = await this._selectRequiredAncestry(primary, rule);
    if (!source) return;
    const ancestry = await this._createSelectedAncestry(source);
    await this._promptRaceSkillAllocation(ancestry);
    await this.document.syncProgressionFeatures();
  }

  static async #onAddProficiency(event, target) {
    const kind = target.dataset.kind;
    if (!["weapons", "armor", "languages"].includes(kind)) return;
    const card = target.closest("[data-proficiency-kind]");
    const input = card?.querySelector("[data-proficiency-input]");
    const canonical = canonicalProficiency(input?.value, kind);
    if (!canonical.name) return;
    if (canonical.kind !== kind) {
      return ui.notifications.warn(game.i18n.format("LYRIAN.Proficiency.WrongGroup", {
        name: canonical.name,
        group: game.i18n.localize(`LYRIAN.Proficiency.Group.${canonical.kind}`)
      }));
    }

    const current = collectActorProficiencies(this.document).groups[kind];
    if (current.some((entry) => entry.key === canonical.key)) {
      return ui.notifications.warn(game.i18n.format("LYRIAN.Proficiency.Duplicate", { name: canonical.name }));
    }
    const manual = Array.from(this.document.system.proficiencies[kind] ?? []);
    await this.document.update({ [`system.proficiencies.${kind}`]: [...manual, canonical.name] });
    if (input) input.value = "";
  }

  static async #onRemoveProficiency(event, target) {
    const kind = target.dataset.kind;
    const key = proficiencyKey(target.dataset.name);
    if (!["weapons", "armor", "languages"].includes(kind) || !key) return;
    const manual = Array.from(this.document.system.proficiencies[kind] ?? [])
      .filter((value) => proficiencyKey(value) !== key);
    await this.document.update({ [`system.proficiencies.${kind}`]: manual });
  }

  static async #onSaveProficiencyChoice(event, target) {
    // Serialized for the same reason the fold state is: this reads the whole
    // selection map and writes it back, so two quick edits would lose one.
    return queueDocumentWrite(this.document, () =>
      LyrianActorSheet.#saveProficiencyChoice.call(this, event, target));
  }

  static async #saveProficiencyChoice(event, target) {
    const row = target.closest("[data-proficiency-choice]");
    const id = row?.dataset.choiceId;
    const index = Number(row?.dataset.choiceIndex);
    const input = row?.querySelector("[data-proficiency-choice-value]");
    if (!id || !Number.isInteger(index) || !input) return;

    const proficiency = collectActorProficiencies(this.document);
    const rule = proficiency.sources.flatMap((source) => source.choices).find((entry) => entry.id === id);
    if (!rule || index < 0 || index >= rule.count) return;

    const raw = input.value.trim();
    const canonical = raw ? canonicalProficiency(raw, rule.kind) : null;
    if (canonical && canonical.kind !== rule.kind) {
      return ui.notifications.warn(game.i18n.format("LYRIAN.Proficiency.WrongGroup", {
        name: canonical.name,
        group: game.i18n.localize(`LYRIAN.Proficiency.Group.${canonical.kind}`)
      }));
    }
    if (canonical && !rule.allowCustom && !rule.options.some((option) => proficiencyKey(option) === canonical.key)) {
      return ui.notifications.warn(game.i18n.format("LYRIAN.Proficiency.NotAllowed", { name: canonical.name }));
    }

    const stored = structuredClone(this.document.system.proficiencyChoiceSelections ?? {});
    const values = Array.isArray(stored[id]) ? [...stored[id]] : [];
    const previous = values[index] ?? "";
    if (canonical && proficiencyKey(previous) !== canonical.key) {
      const duplicate = proficiency.groups[rule.kind].some((entry) => entry.key === canonical.key);
      if (duplicate) {
        return ui.notifications.warn(game.i18n.format("LYRIAN.Proficiency.Duplicate", {
          name: canonical.name
        }));
      }
    }
    values[index] = canonical?.name ?? "";
    stored[id] = values.slice(0, rule.count);
    await this.document.update({ "system.proficiencyChoiceSelections": stored });
  }

  static async #onUseItem(event, target) {
    const item = this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (!item) return;
    if (item.type === "ability" || item.type === "monsterAbility") {
      await item.rollAbility({ free: event.shiftKey });
    }
    else await item.postToChat();
  }

  /**
   * Show an item to the table without using it.
   *
   * Deliberately never rolls and never spends: an ability posted this way
   * costs no AP and is not marked as used, so a player can ask "what does
   * this do?" without committing to it.
   */
  static async #onPostItem(event, target) {
    const item = this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    await item?.postToChat();
  }

  static async #onCreateItem(event, target) {
    const type = target.dataset.type;
    const name = game.i18n.format("LYRIAN.New", {
      type: game.i18n.localize(`TYPES.Item.${type}`)
    });
    await this.document.createEmbeddedDocuments("Item", [{ name, type }]);
  }

  static async #onEditItem(event, target) {
    const item = this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    item?.sheet.render(true);
  }

  static async #onDeleteItem(event, target) {
    const item = this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (!item) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("LYRIAN.Delete") },
      content: `<p>${game.i18n.format("LYRIAN.DeleteConfirm", { name: item.name })}</p>`
    });
    if (confirmed) await item.delete();
  }

  static async #onToggleEquip(event, target) {
    const item = this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (!item || !["weapon", "armor"].includes(item.type)) return;
    const equipping = !item.system.equipped;
    if (equipping && item.type === "armor") {
      const isShield = !!LYRIAN.armorCategories[item.system.category]?.isShield;
      const conflicts = this.document.items.filter((other) =>
        other.id !== item.id &&
        other.type === "armor" &&
        other.system.equipped &&
        !!LYRIAN.armorCategories[other.system.category]?.isShield === isShield
      );
      if (conflicts.length) {
        await this.document.updateEmbeddedDocuments(
          "Item",
          conflicts.map((other) => ({ _id: other.id, "system.equipped": false }))
        );
        ui.notifications.info(game.i18n.format("LYRIAN.Msg.EquipmentReplaced", {
          equipped: item.name,
          stowed: conflicts.map((other) => other.name).join(", ")
        }));
      }

      // A shield needs the off hand, which is exactly where the second weapon
      // of a dual-wielding pair is.
      const offHand = isShield ? this.document.system.equipment?.offHand : null;
      if (offHand) {
        await offHand.update({ "system.equipped": false });
        ui.notifications.info(game.i18n.format("LYRIAN.Msg.EquipmentReplaced", {
          equipped: item.name,
          stowed: offHand.name
        }));
      }
    }

    // Weapons are held in hands, so equipping one is a switch: anything that
    // no longer fits is stowed. Two One-Handed weapons stay held together —
    // that is dual wielding — but a Two-Handed weapon takes both hands.
    if (equipping && item.type === "weapon") {
      const displaced = weaponsDisplacedBy(item, this.document.items, {
        shieldEquipped: Boolean(this.document.system.equipment?.shield),
        proficientWith: (weapon) => weapon.system?.proficient !== false
      });
      if (displaced.length) {
        await this.document.updateEmbeddedDocuments(
          "Item",
          displaced.map((other) => ({ _id: other.id, "system.equipped": false }))
        );
        ui.notifications.info(game.i18n.format("LYRIAN.Msg.EquipmentReplaced", {
          equipped: item.name,
          stowed: displaced.map((other) => other.name).join(", ")
        }));
      }
    }

    await item.update({ "system.equipped": equipping });
  }

  /**
   * Increment or decrement AP, RP, HP or mana from the sheet header.
   * There is no upper bound: overhealing, bonus AP and temporary mana all
   * legitimately push a resource above its normal maximum. The only floor is
   * negative max HP for hit points, since that is where Mortal Wound sits.
   */
  static async #onAdjustResource(event, target) {
    const path = target.dataset.resource;
    const delta = Number(target.dataset.delta ?? 0);
    if (!["hp", "mana", "ap", "rp"].includes(path) || !Number.isFinite(delta) || delta === 0) {
      return;
    }

    const pool = foundry.utils.getProperty(this.document, `system.${path}`);
    const max = Number(pool?.max ?? 0);
    const floor = path === "hp" ? -max : 0;
    const next = adjustResourcePool(pool, delta, { floor });

    await this.document.update({
      [`system.${path}.value`]: next.value,
      [`system.${path}.temp`]: next.temp
    });
  }

  /**
   * Roll d20 plus any displayed value: a main stat, a sub stat, or a
   * defence number the GM wants to contest directly.
   */
  static async #onRollAttribute(event, target) {
    const value = Number(target.dataset.value ?? 0);
    const label = target.dataset.label ?? game.i18n.localize("LYRIAN.Roll.Check");
    await this.document.rollAttribute(label, value);
  }

  static async #onRefreshTurn() {
    await this.document.refreshTurn();
  }

  static async #onStartEncounter() {
    await this.document.startEncounter();
  }

  static async #onTakeRest() {
    await this.document.takeRest();
  }

  static async #onRecoverInjury(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    await this.document.recoverInjury(id);
  }

  static #onOpenCharacterCreation() {
    if (!this.document.isOwner) {
      return ui.notifications.warn(game.i18n.format("LYRIAN.Warn.NotOwner", {
        name: this.document.name
      }));
    }
    return game.lyrian.runCharacterCreation(this.document);
  }

  static async #onSpendExp() {
    const available = this.document.system.exp.available;
    const amount = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("LYRIAN.Interlude.Train") },
      content: `<p>${game.i18n.format("LYRIAN.Interlude.ExpAvailable", { exp: available })}</p>
                <label>${game.i18n.localize("LYRIAN.Interlude.ExpToCommit")} <input type="number" name="exp" value="100" min="0" max="${available}" /></label>
                <label>${game.i18n.localize("LYRIAN.Interlude.Reason")} <input type="text" name="reason" placeholder="${game.i18n.localize("LYRIAN.Interlude.ReasonPlaceholder")}" /></label>`,
      ok: {
        callback: (event, button) => ({
          exp: Number(button.form.elements.exp.value),
          reason: button.form.elements.reason.value
        })
      }
    }).catch(() => null);

    if (!amount?.exp) return;
    await this.document.spendExp(amount.exp, amount.reason);
  }

}
