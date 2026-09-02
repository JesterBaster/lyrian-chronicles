/**
 * Drag Ruler integration.
 *
 * Drag Ruler colours a drag by how far the token can actually go. Without a
 * speed provider it falls back to a single generic band, which for this system
 * is wrong in both directions: a character who has spent their AP is shown a
 * full move, and one with AP left is not shown the second and third moves they
 * can pay for.
 *
 * Registered through `dragRuler.registerSystem`, the system-side half of the
 * API — `registerModule` is for companion packages.
 */
import { LYRIAN } from "../config.mjs";

const SYSTEM_ID = "lyrian-chronicles";

/**
 * The bands a token's remaining AP buys.
 *
 * Movement is bought a move at a time out of the same AP pool that pays for
 * attacks, so the first band is one move and the outer band is everything the
 * token could still spend. A token with no AP left gets a single zero-length
 * band rather than none at all: Drag Ruler reads an empty list as "no limit",
 * which would draw an out-of-AP token as free to run.
 *
 * @param {object} [options]
 * @param {number} [options.speed]     Feet per move.
 * @param {number} [options.ap]        Action points still available.
 * @param {number} [options.fly]       Flight speed, when the token has one.
 * @param {number} [options.swim]      Swim speed, when the token has one.
 * @returns {{range: number, color: string}[]}
 */
export function movementRanges({ speed = 0, ap = 0, fly = 0, swim = 0 } = {}) {
  const base = Math.max(0, Number(speed) || 0);
  const points = Math.max(0, Math.trunc(Number(ap) || 0));

  // The fastest way the token can legitimately travel sets the band width.
  // A flier held to its walking speed would be drawn as overreaching on a
  // move it can make.
  const perMove = Math.max(base, Math.max(0, Number(fly) || 0), Math.max(0, Number(swim) || 0));

  if (!points || !perMove) return [{ range: 0, color: "spent" }];

  const ranges = [{ range: perMove, color: "move" }];
  if (points > 1) ranges.push({ range: perMove * points, color: "sprint" });
  return ranges;
}

export function registerDragRuler() {
  Hooks.once("dragRuler.ready", (SpeedProvider) => {
    class LyrianSpeedProvider extends SpeedProvider {
      get colors() {
        return [
          { id: "move", default: 0x51cf66, name: "LYRIAN.DragRuler.Move" },
          { id: "sprint", default: 0xf6c928, name: "LYRIAN.DragRuler.Sprint" },
          { id: "spent", default: 0xc92a2a, name: "LYRIAN.DragRuler.Spent" }
        ];
      }

      getRanges(token) {
        const system = token?.actor?.system;
        if (!system) return [];
        return movementRanges({
          speed: system.movement?.total,
          ap: system.ap?.value,
          fly: system.movement?.fly,
          swim: system.movement?.swim
        });
      }

      /**
       * Anything without the movement and AP this system tracks — a vehicle
       * token, a drawing given an actor — gets Drag Ruler's own default
       * rather than a made-up allowance.
       */
      usesRuler(token) {
        return Number.isFinite(Number(token?.actor?.system?.movement?.total))
          && Number.isFinite(Number(token?.actor?.system?.ap?.value));
      }
    }

    dragRuler.registerSystem(SYSTEM_ID, LyrianSpeedProvider);
  });
}

/** Exported for the tests: the base speed a fresh actor starts from. */
export const BASE_SPEED = LYRIAN.baseSpeed;
