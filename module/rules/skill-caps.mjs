import { LYRIAN } from "../config.mjs";

function flattenObject(value, prefix = "", output = {}) {
  for (const [key, entry] of Object.entries(value ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      flattenObject(entry, path, output);
    } else {
      output[path] = entry;
    }
  }
  return output;
}

export function skillCapForSpiritCore(spiritCore, caps = LYRIAN.skillCaps) {
  const core = Math.max(0, Number(spiritCore) || 0);
  if (core >= caps.uncappedThreshold) return Infinity;
  if (core >= caps.skyboundThreshold) return caps.base + caps.skyboundBonus;
  return caps.base;
}

function addViolation(violations, { path, group, skill, expertiseIndex = null, value, cap }) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= cap) return;
  if (violations.some((entry) => entry.path === path)) return;
  violations.push({ path, group, skill, expertiseIndex, value: amount, cap });
}

function validateExpertiseArray(violations, path, group, skill, expertises, cap) {
  if (!Array.isArray(expertises) || !Number.isFinite(cap)) return;
  expertises.forEach((expertise, index) => addViolation(violations, {
    path: `${path}.${index}.rank`, group, skill, expertiseIndex: index,
    value: expertise?.rank, cap
  }));
}

/**
 * Return cap violations introduced by an Actor update. Existing over-cap data
 * is left alone unless that rank/expertise changes or the update lowers the
 * actor's Spirit Core cap.
 */
export function skillCapViolations(system, changes, caps = LYRIAN.skillCaps) {
  const flat = flattenObject(changes);
  const proposedSpent = flat["system.exp.spent"] ?? system?.exp?.spent ?? 0;
  const spiritCore = Number(proposedSpent) + Number(system?.ambitionExp ?? 0);
  const mainCap = skillCapForSpiritCore(spiritCore, caps);
  const groupCaps = {
    skills: mainCap,
    artisan: caps.artisan,
    gathering: caps.gathering
  };
  const violations = [];

  for (const [path, value] of Object.entries(flat)) {
    let match = path.match(/^system\.(skills|artisan|gathering)\.([^.]+)\.rank$/);
    if (match) {
      const [, group, skill] = match;
      addViolation(violations, { path, group, skill, value, cap: groupCaps[group] });
      continue;
    }

    match = path.match(/^system\.(skills|artisan)\.([^.]+)\.expertises$/);
    if (match) {
      const [, group, skill] = match;
      validateExpertiseArray(violations, path, group, skill, value, groupCaps[group]);
      continue;
    }

    match = path.match(/^system\.(skills|artisan)\.([^.]+)\.expertises\.(\d+)\.rank$/);
    if (match) {
      const [, group, skill, index] = match;
      addViolation(violations, {
        path, group, skill, expertiseIndex: Number(index), value, cap: groupCaps[group]
      });
    }
  }

  // A GM lowering Spirit Core must explicitly approve keeping ranks that are
  // now over the lower cap. Normal EXP spending can only raise the cap.
  const spentChanged = Object.hasOwn(flat, "system.exp.spent");
  const previousCap = skillCapForSpiritCore(system?.spiritCore ?? 0, caps);
  if (spentChanged && mainCap < previousCap) {
    for (const [skill, data] of Object.entries(system?.skills ?? {})) {
      addViolation(violations, {
        path: `system.skills.${skill}.rank`, group: "skills", skill,
        value: data.rank, cap: mainCap
      });
      validateExpertiseArray(
        violations, `system.skills.${skill}.expertises`, "skills", skill,
        data.expertises, mainCap
      );
    }
  }

  return violations;
}

export function formatSkillCapViolation(violation, labels = {}) {
  const groupLabel = labels.groups?.[violation.group] ?? violation.group;
  const skillLabel = labels.skills?.[violation.group]?.[violation.skill] ?? violation.skill;
  const subject = violation.expertiseIndex === null
    ? `${groupLabel}: ${skillLabel}`
    : `${groupLabel}: ${skillLabel} ${labels.expertise ?? "expertise"} ${violation.expertiseIndex + 1}`;
  return `${subject} (${violation.value}/${violation.cap})`;
}
