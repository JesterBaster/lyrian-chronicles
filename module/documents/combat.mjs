/**
 * Initiative in Lyr is 1d4 + Agility (modified by armour).
 * Ties resolve in favour of player characters, then heroics, then grunts.
 */
export class LyrianCombatant extends Combatant {
  /** @override */
  _getInitiativeFormula() {
    return "1d4 + @initiative.value";
  }

  /** Ranking used only for breaking initiative ties. */
  get tieRank() {
    const actor = this.actor;
    if (!actor) return 0;
    if (actor.type === "character") return 3;
    if (actor.system.rank === "boss") return 3;
    if (actor.system.rank === "heroic") return 2;
    return 1;
  }
}

/* -------------------------------------------- */

export class LyrianCombat extends Combat {
  /** @override */
  _sortCombatants(a, b) {
    const ia = Number.isNumeric(a.initiative) ? a.initiative : -Infinity;
    const ib = Number.isNumeric(b.initiative) ? b.initiative : -Infinity;
    if (ib !== ia) return ib - ia;

    // Same initiative: players and bosses act before heroics, heroics before grunts.
    const rank = (b.tieRank ?? 0) - (a.tieRank ?? 0);
    if (rank !== 0) return rank;

    return (a.name ?? "").localeCompare(b.name ?? "");
  }

  /** @override */
  async startCombat() {
    const result = await super.startCombat();
    // Everyone refreshes AP and RP when the fight begins.
    for (const combatant of this.combatants) {
      await combatant.actor?.startEncounter?.();
    }
    ChatMessage.create({
      content: `<p class="lyrian-banner">${game.i18n.localize("LYRIAN.Msg.EncounterStart")}</p>`
    });
    return result;
  }

  /** @override */
  async nextTurn() {
    const result = await super.nextTurn();
    // Heroic characters regain AP at the start of each of their turns.
    await this.combatant?.actor?.refreshTurn?.();
    return result;
  }

  /** @override */
  async endCombat() {
    ChatMessage.create({
      content: `<p class="lyrian-banner">${game.i18n.localize("LYRIAN.Msg.EncounterConclusion")}</p>`
    });
    return super.endCombat();
  }
}
