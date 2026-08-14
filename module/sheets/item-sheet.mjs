import { LYRIAN } from "../config.mjs";

const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * A single sheet class that swaps its body template based on item type.
 */
export class LyrianItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["lyrian", "sheet", "item"],
    position: { width: 560, height: 620 },
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

    context.enrichedDescription =
      await foundry.applications.ux.TextEditor.implementation.enrichHTML(
        item.system.description ?? "",
        { relativeTo: item, rollData: item.getRollData() }
      );

    // Keyword checkboxes for abilities.
    if (item.type === "ability") {
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

  static async #onToggleKeyword(event, target) {
    const key = target.dataset.keyword;
    const keywords = new Set(this.document.system.keywords ?? []);
    if (keywords.has(key)) keywords.delete(key);
    else keywords.add(key);
    await this.document.update({ "system.keywords": Array.from(keywords) });
  }
}
