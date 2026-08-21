import { tradeableInventory } from "../rules/trade.mjs";
import { canOfferFrom, respondersFor } from "../rules/trade-routing.mjs";
import { proposeTrade } from "../trade/trade-service.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Compose a trade offer.
 *
 * Both halves are editable: what you hand over and what you ask for. A one-way
 * gift is just an offer with an empty other half, so giving and bartering are
 * the same screen rather than two.
 */
export class LyrianTradeOffer extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ actor, ...options } = {}) {
    super(options);
    this.actor = actor;
    this.targetUuid = "";
    // itemId -> quantity, for each side.
    this.give = new Map();
    this.take = new Map();
    this.giveClim = 0;
    this.takeClim = 0;
    this.note = "";
  }

  static DEFAULT_OPTIONS = {
    id: "lyrian-trade-offer",
    classes: ["lyrian", "lyr-trade"],
    position: { width: 620, height: 640 },
    window: { title: "LYRIAN.Trade.OfferTitle", resizable: true },
    actions: {
      toggleItem: LyrianTradeOffer.#onToggleItem,
      send: LyrianTradeOffer.#onSend
    }
  };

  static PARTS = {
    body: { template: "systems/lyrian-chronicles/templates/apps/trade-offer.hbs" }
  };

  get target() {
    return this.targetUuid ? fromUuidSync(this.targetUuid) : null;
  }

  async _prepareContext() {
    // Only actors somebody can actually answer for. An unowned NPC still
    // qualifies, because a GM answers for it — that is how shop trade works.
    const partners = game.actors
      .filter((actor) => actor.id !== this.actor.id
        && ["character", "npc", "monster"].includes(actor.type)
        && respondersFor(actor, game.users).length > 0)
      .map((actor) => ({
        uuid: actor.uuid,
        name: actor.name,
        img: actor.img,
        isNPC: actor.type !== "character",
        selected: actor.uuid === this.targetUuid
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const target = this.target;
    return {
      actor: this.actor,
      partners,
      target,
      // What the other side holds is only listed once a partner is chosen, and
      // only when this user is allowed to see it.
      canSeeTarget: Boolean(target) && target.testUserPermission(game.user, "OBSERVER"),
      giveRows: this.#rows(this.actor, this.give),
      takeRows: target ? this.#rows(target, this.take) : [],
      giveClim: this.giveClim,
      takeClim: this.takeClim,
      purse: this.actor.system.clim ?? 0,
      targetPurse: target?.system?.clim ?? 0,
      note: this.note,
      ready: Boolean(target) && this.#hasContents()
    };
  }

  #rows(actor, selection) {
    return tradeableInventory(actor.items).map((entry) => ({
      ...entry,
      side: selection === this.give ? "give" : "take",
      chosen: selection.get(entry.id) ?? 0
    }));
  }

  #hasContents() {
    return this.give.size > 0 || this.take.size > 0 || this.giveClim > 0 || this.takeClim > 0;
  }

  /* -------------------------------------------- */

  static async #onToggleItem(event, target) {
    const { itemId, side } = target.dataset;
    const selection = side === "take" ? this.take : this.give;
    if (selection.has(itemId)) selection.delete(itemId);
    else selection.set(itemId, Number(target.dataset.stack) || 1);
    this.render();
  }

  static async #onSend() {
    if (!canOfferFrom({ user: game.user, actor: this.actor })) {
      return ui.notifications.warn(game.i18n.format("LYRIAN.Trade.NotYours", {
        name: this.actor.name
      }));
    }
    const target = this.target;
    if (!target) return ui.notifications.warn(game.i18n.localize("LYRIAN.Trade.NoPartner"));

    const sent = await proposeTrade({
      fromUuid: this.actor.uuid,
      toUuid: target.uuid,
      give: { items: [...this.give].map(([itemId, quantity]) => ({ itemId, quantity })), clim: this.giveClim },
      take: { items: [...this.take].map(([itemId, quantity]) => ({ itemId, quantity })), clim: this.takeClim },
      note: this.note
    });
    if (sent) this.close();
  }

  /** @override */
  _onRender() {
    // A data-action fires on click, which never carries the new selection, so
    // the partner picker listens for change instead.
    this.element.querySelector("[data-trade-partner]")?.addEventListener("change", (event) => {
      this.targetUuid = event.currentTarget.value ?? "";
      // What was asked for belongs to the previous partner, not this one.
      this.take.clear();
      this.takeClim = 0;
      this.render();
    });

    // Quantities and coin are free-text, so they are read on change rather
    // than through a form submit the app does not have.
    for (const input of this.element.querySelectorAll("[data-trade-quantity]")) {
      input.addEventListener("change", (event) => {
        const { itemId, side } = event.currentTarget.dataset;
        const selection = side === "take" ? this.take : this.give;
        const value = Math.max(0, Math.trunc(Number(event.currentTarget.value) || 0));
        if (value > 0) selection.set(itemId, value);
        else selection.delete(itemId);
        this.render();
      });
    }
    for (const input of this.element.querySelectorAll("[data-trade-clim]")) {
      input.addEventListener("change", (event) => {
        const value = Math.max(0, Math.trunc(Number(event.currentTarget.value) || 0));
        if (event.currentTarget.dataset.tradeClim === "take") this.takeClim = value;
        else this.giveClim = value;
        this.render();
      });
    }
    const note = this.element.querySelector("[data-trade-note]");
    note?.addEventListener("change", (event) => { this.note = event.currentTarget.value; });
  }
}
