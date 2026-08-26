/**
 * A craft, as the rulebook actually runs one.
 *
 * The old implementation was a single d10 against a DC: one roll, pass or
 * fail. The real procedure is an accumulation. You spend Crafting Dice on
 * crafting actions, each adds its result to a running Crafting Points total,
 * and the craft ends when you run out of dice or choose to stop. If the total
 * is short of the item's crafting HP the craft fails and the materials are
 * lost; anything above it can be spent installing Mods.
 *
 * From the worked example in the shipped crafting guide — a Bow needing 30
 * with a +5 carpentry bonus:
 *
 *   basic craft, rolls 6  → 11        basic craft, rolls 3  → 40
 *   basic craft, rolls 7  → 23        steady craft, die 5   → 50
 *   basic craft, rolls 4  → 32        install Recurve (20)  → 30
 *                                     30 ≥ 30, so the bow is finished.
 *
 * Every number in this module is checked against that example.
 */

/**
 * The crafting actions, with what each costs and how its die behaves.
 *
 * `rapid` is the rulebook keyword: "you may only use each ability once during
 * a craft unless it has the Rapid keyword". Only Basic Craft has it, so it is
 * the only action that may be repeated.
 */
export const CRAFT_ACTIONS = Object.freeze({
  basicCraft: Object.freeze({
    key: "basicCraft", dice: 1, rapid: true,
    formula: "1d10", addsSkill: true
  }),
  beginnersLuck: Object.freeze({
    // "You do not add your crafting skill to the check, but you roll two d10s
    // and pick the highest one."
    key: "beginnersLuck", dice: 1, rapid: false,
    formula: "2d10kh", addsSkill: false
  }),
  steadyCraft: Object.freeze({
    // "The crafting dice automatically is a 5" — the skill bonus still applies.
    key: "steadyCraft", dice: 1, rapid: false,
    fixedDie: 5, addsSkill: true
  }),
  standardFinish: Object.freeze({
    // "Double the current crafting points and end crafting."
    key: "standardFinish", dice: 2, rapid: false,
    doubles: true, ends: true
  })
});

/** A fresh session for a project, with nothing spent. */
export function newCraftSession({
  requiredPoints = 0,
  craftingDice = 0,
  diceBonus = 0,
  finishBonus = 0
} = {}) {
  return {
    points: 0,
    diceSpent: 0,
    craftingDice: Math.max(0, Math.trunc(Number(craftingDice) || 0)),
    requiredPoints: Math.max(0, Math.trunc(Number(requiredPoints) || 0)),
    // A crafting tool's bonuses, from the source spreadsheet: "A crafting
    // bonus gives you +1 (or +2) to each crafting dice roll. The finish bonus
    // gives you a +5 (or +10) bonus once at the end of your craft."
    diceBonus: Math.trunc(Number(diceBonus) || 0),
    finishBonus: Math.trunc(Number(finishBonus) || 0),
    usedActions: [],
    installedMods: [],
    finished: false
  };
}

/** Dice left to spend. */
export function diceRemaining(session = {}) {
  return Math.max(0, (session.craftingDice ?? 0) - (session.diceSpent ?? 0));
}

/**
 * Whether an action may be taken right now, and why not when it may not.
 *
 * Returned as a reason rather than a bare false so the sheet can say what is
 * wrong instead of presenting a button that quietly does nothing.
 */
export function canUseCraftAction(session = {}, actionKey = "") {
  const action = CRAFT_ACTIONS[actionKey];
  if (!action) return { ok: false, reason: "unknown" };
  if (session.finished) return { ok: false, reason: "finished" };
  if (diceRemaining(session) < action.dice) return { ok: false, reason: "dice" };
  if (!action.rapid && (session.usedActions ?? []).includes(actionKey)) {
    return { ok: false, reason: "used" };
  }
  // "Cannot be used if the item being crafted has been modified beyond its
  // base form" — installing a Mod is exactly that.
  if (action.doubles && (session.installedMods ?? []).length) {
    return { ok: false, reason: "modified" };
  }
  return { ok: true, reason: "" };
}

/** Every action, with its availability — what the sheet renders. */
export function craftActionOptions(session = {}) {
  return Object.values(CRAFT_ACTIONS).map((action) => {
    const check = canUseCraftAction(session, action.key);
    return { ...action, available: check.ok, reason: check.reason };
  });
}

/**
 * Apply an action's result to the session.
 *
 * `dieTotal` is what the dice actually produced; the caller rolls, because
 * rolling belongs to Foundry and this module stays pure. Steady Craft ignores
 * it in favour of its fixed 5, and Standard Finish has no die at all.
 *
 * @returns {{session: object, added: number, doubled: boolean}}
 */
export function applyCraftAction(session, actionKey, { dieTotal = 0, skillBonus = 0 } = {}) {
  const check = canUseCraftAction(session, actionKey);
  if (!check.ok) return { session, added: 0, doubled: false, refused: check.reason };

  const action = CRAFT_ACTIONS[actionKey];
  const next = {
    ...session,
    usedActions: [...(session.usedActions ?? []), actionKey],
    installedMods: [...(session.installedMods ?? [])],
    diceSpent: (session.diceSpent ?? 0) + action.dice
  };

  if (action.doubles) {
    const before = next.points ?? 0;
    next.points = before * 2;
    next.finished = true;
    return { session: next, added: next.points - before, doubled: true };
  }

  // The tool's per-roll bonus rides on the die, so Steady Craft's fixed 5
  // gets it too — the rule is a bonus to the crafting dice roll, and Steady
  // Craft is still one, it just does not bounce.
  const die = action.fixedDie ?? (Number(dieTotal) || 0);
  const added = die
    + (Number(session.diceBonus) || 0)
    + (action.addsSkill ? (Number(skillBonus) || 0) : 0);
  next.points = (next.points ?? 0) + added;
  if (action.ends) next.finished = true;

  // Running out of dice ends the craft on its own: "when you run out of
  // crafting dice and have no more actions you wish to perform, the crafting
  // ends" — there is nothing left to perform.
  if (diceRemaining(next) <= 0) next.finished = true;

  return { session: next, added, doubled: false };
}

/**
 * Spend accumulated points on a Mod.
 *
 * The example spends 20 of 50 points on a Recurve Mod and finishes with 30 —
 * exactly the bow's requirement. So a Mod is paid for out of the same pool
 * that has to cover the item itself, which is why it is worth over-building.
 */
export function installCraftMod(session, { itemId = "", name = "", cost = 0 } = {}) {
  const price = Math.max(0, Math.trunc(Number(cost) || 0));
  if (session?.finished) return { session, refused: "finished" };
  if ((session?.installedMods ?? []).some((mod) => mod.itemId === itemId)) {
    return { session, refused: "duplicate" };
  }
  if ((session?.points ?? 0) < price) return { session, refused: "points" };

  return {
    session: {
      ...session,
      points: session.points - price,
      installedMods: [...(session.installedMods ?? []), { itemId, name, cost: price }]
    },
    refused: ""
  };
}

/**
 * How the craft stands: whether it can still be worked on, and whether it
 * would succeed if it stopped now.
 */
export function craftStatus(session = {}) {
  const required = session.requiredPoints ?? 0;
  const points = session.points ?? 0;
  const remaining = diceRemaining(session);
  // A tool's finish bonus lands once, at the end. It is counted into the
  // projection because it is guaranteed — the craft will get it — but never
  // into `points`, which is the pool Mods are actually paid out of.
  const finishBonus = Math.trunc(Number(session.finishBonus) || 0);
  const finalPoints = Math.max(0, points + finishBonus);
  return {
    points,
    finishBonus,
    finalPoints,
    required,
    shortfall: Math.max(0, required - finalPoints),
    surplus: Math.max(0, finalPoints - required),
    diceRemaining: remaining,
    finished: Boolean(session.finished),
    // "If you end your crafting and your crafting points does not equal the
    // items crafting HP, then the craft fails."
    succeeds: finalPoints >= required,
    canAct: !session.finished && remaining > 0
  };
}
