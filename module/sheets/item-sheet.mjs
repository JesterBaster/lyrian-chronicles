import { LYRIAN } from "../config.mjs";

const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * A single sheet class that swaps its body template based on item type.
 */
export class LyrianItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["lyrian", "sheet", "item"],
    position: { width: 680, height: 760 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      toggleKeyword: LyrianItemSheet.#onToggleKeyword
    }
  };

  static PARTS = {
    header: { template: "systems/lyrian-chronicles/templates/item/header.hbs" },
    body: { template: "systems/lyrian-chronicles/templates/item/body.hbs" },
    description: { template: "systems/lyrian-chronicles/templates/item/description.hbs" }
  };

  /* -------------------------------------------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.document;

    context.item = item;
    context.system = item.system;
    context.config = LYRIAN;
    context.editable = this.isEditable;
    context.systemFields = item.system.schema.fields;
    context.type = item.type;
    context.summaryChips = this.#buildSummaryChips(item);
    context.hasSourceLink = /^https?:\/\//.test(item.system.sourceUrl ?? "");

    context.enrichedDescription =
      await foundry.applications.ux.TextEditor.implementation.enrichHTML(
        item.system.description ?? "",
        { relativeTo: item, rollData: item.getRollData() }
      );

    context.enrichedGuide = await this.#enrich(item.system.guide, item);
    context.enrichedRequirements = await this.#enrich(
      item.system.requirements ?? item.system.requirement,
      item
    );
    context.enrichedRelationships = await this.#enrichRelationships(item);

    // Keyword checkboxes for abilities.
    if (item.type === "ability" || item.type === "monsterAbility") {
      // Offer the automated keywords plus whatever this item already carries,
      // so imported keywords stay visible and removable instead of vanishing.
      const known = new Map(Object.entries(LYRIAN.abilityKeywords));
      for (const key of item.system.keywords ?? []) {
        if (!known.has(key)) known.set(key, null);
      }

      context.keywordChoices = Array.from(known, ([key, label]) => ({
        key,
        label: label
          ? game.i18n.localize(label)
          : key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()),
        active: item.system.keywords?.has(key) ?? false,
        automated: !!label
      }));

      context.enrichedBenefits =
        await foundry.applications.ux.TextEditor.implementation.enrichHTML(
          item.system.benefits ?? "",
          { relativeTo: item, rollData: item.getRollData() }
        );
    }

    return context;
  }

  /* -------------------------------------------- */

  async #enrich(content, item) {
    if (!content) return "";
    const html = /<\/?[a-z][\s\S]*>/i.test(content)
      ? content
      : `<p>${this.#escape(String(content))}</p>`;
    return foundry.applications.ux.TextEditor.implementation.enrichHTML(html, {
      relativeTo: item,
      rollData: item.getRollData()
    });
  }

  #escape(value) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  #buildSummaryChips(item) {
    const sys = item.system;
    const chips = [];
    const add = (label, tone = "neutral") => {
      if (label && label !== "—") chips.push({ label, tone });
    };

    switch (item.type) {
      case "keyword":
        add("Keyword", "gold");
        break;
      case "breakthrough":
        add(sys.rawCost || `${sys.expCost} EXP`, "gold");
        if (sys.repeatable) add("Repeatable");
        break;
      case "ability":
        if (sys.isKeyAbility) add("Key Ability", "gold");
        add(sys.costLabel, "resource");
        add(sys.range);
        add(sys.timing && sys.timing !== "action" ? this.#label(sys.timing) : "");
        break;
      case "class":
        add(`Tier ${sys.tier}`, "gold");
        add(sys.role1);
        add(sys.role2);
        if (sys.difficulty) add(`Difficulty ${sys.difficulty}`);
        break;
      case "race":
        add(sys.raceKind === "ancestry" ? "Ancestry" : "Primary Race", "gold");
        if (sys.raceKind === "ancestry") add(sys.primaryRace);
        break;
      case "equipment":
        add(sys.category, "gold");
        add(sys.subType);
        add(sys.cost ? `Cost ${sys.cost}` : "", "resource");
        if (sys.burden) add(`Burden ${sys.burden}`);
        break;
      case "monsterAbility":
        add(sys.kind === "active-action" ? "Active Action" : "Passive", "gold");
        add(sys.costLabel, "resource");
        add(sys.range);
        break;
    }
    return chips;
  }

  #label(value) {
    return String(value)
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/^./, (character) => character.toUpperCase());
  }

  async #enrichRelationships(item) {
    const links = item.system.relationships?._links ?? [];
    if (!links.length) return "";
    return foundry.applications.ux.TextEditor.implementation.enrichHTML(
      `<p>${links.map((link) => `@UUID[${link.uuid}]{${link.name}}`).join(" · ")}</p>`,
      { relativeTo: item }
    );
  }

  /* -------------------------------------------- */

  static async #onToggleKeyword(event, target) {
    const key = target.dataset.keyword;
    const keywords = new Set(this.document.system.keywords ?? []);
    if (keywords.has(key)) keywords.delete(key);
    else keywords.add(key);
    await this.document.update({ "system.keywords": Array.from(keywords) });
  }
}
