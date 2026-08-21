import { normalizeTradeOffer } from "../rules/trade.mjs";
import { canRespond } from "../rules/trade-routing.mjs";
import { respondToTrade } from "../trade/trade-service.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Review an offer someone has made.
 *
 * Shows both halves from the reader's point of view — what arrives and what
 * leaves — so accepting is a decision about a bargain rather than about a
 * list of item names.
 */
export class LyrianTradeReview extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ offer, initiatorUserId = "", ...options } = {}) {
    super(options);
    this.offer = normalizeTradeOffer(offer);
    this.initiatorUserId = initiatorUserId;
  }

  static DEFAULT_OPTIONS = {
    id: "lyrian-trade-review",
    classes: ["lyrian", "lyr-trade"],
    position: { width: 520, height: "auto" },
    window: { title: "LYRIAN.Trade.ReviewTitle" },
    actions: {
      accept: LyrianTradeReview.#onAccept,
      decline: LyrianTradeReview.#onDecline
    }
  };

  static PARTS = {
    body: { template: "systems/lyrian-chronicles/templates/apps/trade-review.hbs" }
  };

  async _prepareContext() {
    const from = await fromUuid(this.offer.fromUuid);
    const to = await fromUuid(this.offer.toUuid);
    return {
      offer: this.offer,
      from,
      to,
      // "give" is the proposer's side, so from this reader's seat it arrives.
      incoming: this.#describe(from, this.offer.give),
      outgoing: this.#describe(to, this.offer.take),
      canAnswer: canRespond({
        user: game.user, target: to, initiatorUserId: this.initiatorUserId
      })
    };
  }

  #describe(actor, side) {
    const items = side.items.map((line) => {
      const item = actor?.items?.get(line.itemId);
      return {
        name: item?.name ?? game.i18n.localize("LYRIAN.Trade.MissingItem"),
        img: item?.img,
        quantity: line.quantity,
        missing: !item
      };
    });
    return { items, clim: side.clim, any: items.length > 0 || side.clim > 0 };
  }

  static async #onAccept() {
    await respondToTrade(this.offer, true);
    this.close();
  }

  static async #onDecline() {
    await respondToTrade(this.offer, false);
    this.close();
  }
}
