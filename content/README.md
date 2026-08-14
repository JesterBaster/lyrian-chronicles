# Content source files

Each file here is a plain JSON array of Foundry documents. On world load the
system seeds them into the matching compendium, skipping anything already
present. Editing JSON is far easier to review and diff than the LevelDB files
Foundry actually stores.

| File | Pack | Shipped |
| --- | --- | --- |
| `weapons.json` | Weapons | yes, one per weapon group |
| `armor.json` | Armour & Shields | yes, all six categories |
| `gear.json` | Gear & Materials | yes, kits, consumables, raw materials |
| `injuries.json` | Injuries | yes, the full 1d10 table |
| `bestiary.json` | Bestiary | yes, three sample NPCs |
| `tables.json` | Roll Tables | yes, the injury table |
| `classes.json` | Classes | **you supply** |
| `abilities.json` | Abilities | **you supply** |
| `breakthroughs.json` | Breakthroughs | **you supply** |
| `races.json` | Races | **you supply** |

Missing files are skipped silently, so the four you supply can be added at any
time without touching code.

## Required shape

Every document needs a 16-character `_id` and a stable `seedKey`. The seedKey is
how re-seeding knows what already exists — change it and you get a duplicate.

```json
[
  {
    "_id": "a1b2c3d4e5f60718",
    "name": "Sundering Strike",
    "type": "ability",
    "img": "icons/svg/sword.svg",
    "system": {
      "description": "<p>What the ability does.</p>",
      "source": "Core rules, p.114",
      "apCost": 2,
      "rpCost": 0,
      "manaCost": 1,
      "timing": "action",
      "keywords": ["halfPierce"],
      "range": "Melee",
      "requirement": "Two-handed melee weapon",
      "hasAttack": true,
      "attackType": "heavy",
      "usesWeapon": true,
      "damageType": "physical",
      "classSource": "Warrior",
      "classStep": 3
    },
    "flags": { "lyrian-chronicles": { "seedKey": "ability:sundering-strike" } }
  }
]
```

`keywords` accepts any string. Ones listed in `LYRIAN.abilityKeywords`
(`rapid`, `sureHit`, `halfPierce`, `fullPierce`, `pinpoint`, `secretArt` and so
on) are mechanically enforced; anything else displays on the sheet as a label
without automation. That means unknown keywords are safe to include.

## Regenerating

After editing any file, bump `CONTENT_VERSION` in
`module/content/seed-packs.mjs` so existing worlds pick up the additions, then
run `game.lyrian.seedSystemPacks({ force: true })` from the console to re-check
immediately.

To start over, run `game.lyrian.resetSystemPacks()`. It deletes only documents
carrying a seedKey, so anything a GM added by hand survives.
