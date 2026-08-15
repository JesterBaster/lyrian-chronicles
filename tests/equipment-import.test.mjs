import assert from "node:assert/strict";
import test from "node:test";
import { convertOfficialEquipment } from "../module/rules/equipment-import.mjs";

function official(name, subType, overrides = {}) {
  return {
    _id: "source-item-id",
    name,
    type: "equipment",
    img: "item.webp",
    system: {
      description: `<p>${name}</p>`,
      stableId: `item--${name.toLowerCase().replace(/\W+/g, "-")}`,
      relationships: {},
      category: "Equipment",
      subType,
      cost: "1,000 Clim",
      burden: "1",
      quantity: 1,
      equipped: false,
      ...overrides
    },
    flags: { "lyrian-chronicles": { seedKey: "official:test" } }
  };
}

test("official armour becomes automated armour and preserves source metadata", () => {
  const result = convertOfficialEquipment(
    official("Armor (Light)", "Armor", { cost: "500 Clim" }),
    { armor: ["Light Armor"] }
  );
  assert.equal(result.type, "armor");
  assert.equal(result.system.category, "light");
  assert.equal(result.system.proficient, true);
  assert.equal(result.system.value, 500);
  assert.equal(result.flags["lyrian-chronicles"].officialEquipment.subType, "Armor");
  assert.equal(result.flags["lyrian-chronicles"].officialEquipment.sourceItemId, "source-item-id");
});

test("shields convert even though the official subtype is blank", () => {
  const result = convertOfficialEquipment(
    official("Shield (Great)", "", { burden: "2" }),
    { armor: ["Greatshields"] }
  );
  assert.equal(result.type, "armor");
  assert.equal(result.system.category, "greatshield");
  assert.equal(result.system.burden, 2);
  assert.equal(result.system.proficient, true);
});

test("official weapons become attack-ready weapon documents", () => {
  const result = convertOfficialEquipment(
    official("Saboteur Thread Daggers (One-Handed)", "Specialized Weapon"),
    { weapons: ["Saboteur Thread Daggers"] }
  );
  assert.equal(result.type, "weapon");
  assert.equal(result.system.group, "threadDagger");
  assert.equal(result.system.hands, "one");
  assert.equal(result.system.proficient, true);
});

test("non-weapon references become usable gear instead of inert equipment", () => {
  const result = convertOfficialEquipment(
    official("Adventurer's Kit", "Kit", { category: "Adventuring Essentials" })
  );
  assert.equal(result.type, "gear");
  assert.equal(result.system.isKit, true);
  assert.equal(result.system.combatItem, true);
  assert.equal(result.system.burden, 1);
});

test("Flo materials preserve numeric units without treating named pieces as generic units", () => {
  const bulk = convertOfficialEquipment(official("Iron", "Material", {
    category: "Crafting Materials", craftingType: "Blacksmithing", unitCost: "500 units", burden: ""
  }));
  assert.equal(bulk.type, "gear");
  assert.equal(bulk.system.materialType, "Blacksmithing");
  assert.equal(bulk.system.units, 500);

  const core = convertOfficialEquipment(official("Crystal Core", "Material", {
    category: "Crafting Materials", craftingType: "Armorsmithing", unitCost: "1 Core", burden: ""
  }));
  assert.equal(core.system.units, 0);
});

test("unknown official weapons remain equippable as improvised weapons", () => {
  const result = convertOfficialEquipment(official("Prototype Cannon", "Specialized Weapon"));
  assert.equal(result.type, "weapon");
  assert.equal(result.system.group, "improvised");
  assert.equal(result.system.proficient, true);
});
