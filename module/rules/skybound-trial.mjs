import { LYRIAN } from "../config.mjs";

/**
 * The Skybound Trial hold (rulebook 0.13.3): until the trial is completed,
 * Spirit Core cannot be raised past 9999.
 *
 * Pure so the sheet, `spendExp` and `_preUpdate` all ask the same question.
 */

/** Read a value an update may carry flattened ("system.exp.spent") or nested. */
function changed(changes, path) {
  if (Object.hasOwn(changes ?? {}, path)) return { found: true, value: changes[path] };
  let cursor = changes;
  for (const part of path.split(".")) {
    if (cursor === null || typeof cursor !== "object" || !Object.hasOwn(cursor, part)) {
      return { found: false };
    }
    cursor = cursor[part];
  }
  return { found: true, value: cursor };
}

/**
 * Would committing `exp` more EXP break the hold?
 * @param {object} system   A character's system data (prepared).
 * @param {number} exp      EXP about to be spent.
 * @returns {boolean}
 */
export function skyboundTrialBlocksSpend(system, exp, limit = LYRIAN.skyboundTrial.spiritCoreLimit) {
  if (system?.skyboundTrial) return false;
  const core = Number(system?.spiritCore ?? 0);
  return Number(exp) > 0 && core + Number(exp) > limit;
}

/**
 * Does this update raise Spirit Core past the hold?
 *
 * Only a rise is refused. A character already past the limit (from before
 * 0.13.3, or a GM edit) is left alone until someone spends more, and ticking
 * the trial in the same update lets the spend through.
 *
 * @returns {{spiritCore: number, limit: number}|null}
 */
export function skyboundTrialViolation(system, changes, limit = LYRIAN.skyboundTrial.spiritCoreLimit) {
  const spent = changed(changes, "system.exp.spent");
  if (!spent.found) return null;
  const trial = changed(changes, "system.skyboundTrial");
  if (trial.found ? Boolean(trial.value) : Boolean(system?.skyboundTrial)) return null;

  const before = Number(system?.exp?.spent ?? 0);
  const after = Number(spent.value);
  if (!Number.isFinite(after) || after <= before) return null;

  const spiritCore = after + Number(system?.ambitionExp ?? 0);
  return spiritCore > limit ? { spiritCore, limit } : null;
}

/** Sheet state: is the character held, and is more EXP banked than may be stored? */
export function skyboundTrialStatus(system, trial = LYRIAN.skyboundTrial) {
  const held = !system?.skyboundTrial && Number(system?.spiritCore ?? 0) >= trial.spiritCoreLimit;
  const available = Number(system?.exp?.available ?? 0);
  return {
    held,
    limit: trial.spiritCoreLimit,
    stored: trial.storedExpLimit,
    overStored: held && available > trial.storedExpLimit,
    available
  };
}
