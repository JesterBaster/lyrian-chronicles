/**
 * Damage types, arranged for a picker.
 *
 * The config table is a flat map carrying two relationships the sheet needs to
 * show: a `group` (physical, magic, divine, astra), which becomes an optgroup,
 * and a `parent` for the narrower types — Slashing under Physical, Acid under
 * Earth, Necrotic under Dark. Resistances are written against the parent, so a
 * player picking a sub-type needs to see which one it sits under.
 *
 * Order follows the config table rather than an alphabetical sort. It is
 * authored in rulebook order, and a sort would scatter each parent away from
 * the types that belong to it.
 */

/**
 * Which option is current is marked here rather than compared in the template.
 * The markup nests an each inside an each, so a template-side comparison has
 * to climb two levels to reach the selected value — and that depth silently
 * changes whenever the markup is rearranged.
 *
 * @param {object} damageTypes            The LYRIAN.damageTypes table.
 * @param {object} [helpers]
 * @param {(key: string) => string} [helpers.localize]
 * @param {string} [helpers.selected]     The currently chosen key.
 * @returns {{group: string, label: string, options: {key: string, label: string,
 *           parent: string, selected: boolean}[]}[]}
 */
export function damageTypeChoices(damageTypes = {}, {
  localize = (key) => key,
  selected = ""
} = {}) {
  const current = resolveDamageType(selected, damageTypes);
  const groups = new Map();

  for (const [key, entry] of Object.entries(damageTypes)) {
    const group = entry?.group ?? "other";
    if (!groups.has(group)) {
      groups.set(group, {
        group,
        label: localize(`LYRIAN.DamageGroup.${group}`),
        options: []
      });
    }
    groups.get(group).options.push({
      key,
      label: localize(entry?.label ?? key),
      parent: entry?.parent ?? "",
      selected: key === current
    });
  }

  return [...groups.values()];
}

/**
 * The damage type an attack should actually use.
 *
 * Falls back rather than trusting the stored value: a type removed from the
 * config table, or a blank left by an import, would otherwise reach the chat
 * card as an empty label and the damage would read as untyped.
 */
export function resolveDamageType(value, damageTypes = {}, fallback = "physical") {
  const key = String(value ?? "");
  return key && damageTypes[key] ? key : fallback;
}
