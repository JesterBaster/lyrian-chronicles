/**
 * The stat lines shown when an item is shared to chat.
 *
 * Sharing is for reading, not rolling: the card has to carry the numbers a
 * player or GM would otherwise have to open the sheet to see. Only meaningful
 * values are listed — a zero accuracy bonus or an empty enchantment says
 * nothing, so it is left out rather than printed as a blank.
 */

/**
 * @param {object} item                       The item being shared.
 * @param {object} [helpers]
 * @param {(key: string) => string} [helpers.localize]      i18n lookup.
 * @param {(group: string, key: string) => string} [helpers.localizeKey]
 *        Config-table lookup, matching the `lyrianLocalizeKey` template helper.
 * @returns {{label: string, value: string}[]}
 */
export function itemChatStats(item, {
  localize = (key) => key,
  localizeKey = (group, key) => key
} = {}) {
  const sys = item?.system ?? {};
  const stats = [];
  const add = (key, value) => {
    if (value === null || value === undefined || value === "") return;
    stats.push({ label: localize(key), value: String(value) });
  };
  const signed = (value) => (Number(value) > 0 ? `+${value}` : String(value));

  switch (item?.type) {
    case "ability":
    case "monsterAbility":
      add("LYRIAN.UI.Timing", localizeKey("abilityTiming", sys.timing));
      add("LYRIAN.UI.Cost", sys.costLabel);
      add("LYRIAN.UI.Range", sys.range);
      break;

    case "weapon":
      add("LYRIAN.UI.Group", localizeKey("weaponGroups", sys.group));
      add("LYRIAN.UI.Hands", localize(
        sys.hands === "two" ? "LYRIAN.UI.TwoHanded" : "LYRIAN.UI.OneHanded"));
      add("LYRIAN.UI.DamageType", localizeKey("damageTypes", sys.damageType));
      if (sys.range) add("LYRIAN.UI.Range", `${sys.range} ${localize("LYRIAN.Unit.Feet")}`);
      // A 20 is the default threshold and tells the reader nothing.
      if (Number(sys.effectiveCrit) < 20) add("LYRIAN.UI.CritOn", `${sys.effectiveCrit}+`);
      if (Number(sys.accuracyBonus)) add("LYRIAN.UI.Accuracy", signed(sys.accuracyBonus));
      if (Number(sys.damageBonus)) add("LYRIAN.UI.Damage", signed(sys.damageBonus));
      add("LYRIAN.UI.Enchantment", sys.enchantment);
      add("LYRIAN.UI.Burden", sys.burden);
      break;

    case "armor":
      add("LYRIAN.UI.Category", localizeKey("armorCategories", sys.category));
      add("LYRIAN.Defence.Guard", signed(sys.guard ?? 0));
      if (Number(sys.blockValue)) add("LYRIAN.Defence.Block", sys.blockValue);
      if (Number(sys.evasionPenalty)) add("LYRIAN.Defence.Evasion", signed(sys.evasionPenalty));
      add("LYRIAN.UI.Modification", sys.modification);
      add("LYRIAN.UI.Burden", sys.burden);
      break;

    case "gear":
      add("LYRIAN.UI.Quantity", `×${sys.quantity ?? 1}`);
      if (Number(sys.units)) add("LYRIAN.UI.Units", sys.units);
      add("LYRIAN.UI.Rarity", sys.rarity);
      if (Number(sys.totalBurden)) add("LYRIAN.UI.Burden", sys.totalBurden);
      break;

    case "equipment":
      add("LYRIAN.UI.Category", sys.category);
      add("LYRIAN.UI.Type", sys.subType);
      add("LYRIAN.UI.Cost", sys.cost);
      if (Number(sys.burden)) add("LYRIAN.UI.Burden", sys.burden);
      break;
  }

  return stats;
}

/**
 * Ability keywords as a readable list.
 *
 * They live in a Set on the item, which Handlebars cannot iterate, and the
 * chat card wants one comma-joined line rather than a bullet per keyword.
 */
export function itemChatKeywords(item, { localizeKey = (group, key) => key } = {}) {
  const keywords = item?.system?.keywords;
  const list = keywords instanceof Set ? [...keywords] : Array.isArray(keywords) ? keywords : [];
  return list.map((keyword) => localizeKey("abilityKeywords", keyword) || keyword);
}
