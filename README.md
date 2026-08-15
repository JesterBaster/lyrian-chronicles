# The Lyrian Chronicles — Foundry VTT system

> Fan-made Foundry VTT system. Official Lyrian Chronicles game content © Angel's Sword Studios, used with permission. See [ATTRIBUTION.md](ATTRIBUTION.md).

An unofficial Foundry VTT game system for Angel's Sword Studios' *Lyrian Chronicles*, built
for Foundry VTT v14. Mechanics are transcribed from the core rulebook:
Power / Focus / Agility / Toughness, the AP and RP economy, Guard–Block–Dodge defence,
skills with expertise, classes, breakthroughs, and Spirit Core progression.

The system includes reviewed official rulebook v0.13.1 content plus focused equipment and
crafting compendiums, with source links, stable cross-references, and official artwork where available.

## Install

In Foundry: **Game Systems → Install System**, then paste this manifest URL:

```
https://github.com/JesterBaster/lyrian-chronicles/releases/latest/download/system.json
```

That URL always resolves to the newest release, which is how Foundry detects updates.

### Working on the system instead

Do not install from the manifest while you are editing — you would need a release for
every change. Clone into your Foundry user data directory instead:

```bash
cd ~/FoundryVTT/Data/systems
git clone https://github.com/JesterBaster/lyrian-chronicles.git
```

The folder name must stay `lyrian-chronicles`, matching the `id` in `system.json`.
Reload the world with F5 after editing. Changes to `system.json` need a full Foundry
restart; changes to data model schemas need the world relaunched from the setup screen.

## What is automated

| Rule | Behaviour |
| --- | --- |
| Derived stats | HP `20 + Tough×10`, Mana `6 + Power`, RP `2 + Agility`, Evasion `7 + Agility`, Potency `11 + Focus`, Guard `armour + Toughness` |
| Armour | Light / Medium / Heavy / Shield / Greatshield apply Guard, Evasion, Initiative and Block values; non-proficient use costs 1 Guard and 1 Evasion |
| Attacks | Light `2d4 + Power`, Heavy `4d6 + 2×Power` (`5d6` two-handed melee), Precise `2d4 + Power` at doubled Focus with Pinpoint |
| Criticals | Natural 20 (or 19 with Keen weapon groups) deals maximum damage and gains Half Pierce |
| Defence | Chat card buttons for No reaction / Dodge / Block; Block uses `2×Toughness + armour block value` and can reduce damage to 0, everything else floors at 1 |
| Initiative | `1d4 + Agility`, ties resolved in favour of players and bosses, then heroics, then grunts |
| Action economy | 4 AP / `2 + Agility` RP for heroics, 2 AP / 1 RP for grunts; AP refreshes on turn start, RP on encounter start |
| Once per round | Non-Rapid abilities lock until the owner's next turn; one Secret Art per encounter |
| Downed | 0 HP applies Downed and Prone (grunts die outright); negative max HP applies Mortal Wound |
| Injuries | 1d10 injury table roll creates an Injury item on the actor |
| Skills | `d20 + sub stat + ranks + expertise`, with the 15 / 20 / uncapped rank cap tracked from Spirit Core |
| Crafting & gathering | `d10 + skill + expertise` rolls for artisan and gathering checks |

## Compendium content

The system seeds reviewed rules, keywords, breakthroughs, abilities, races, classes,
weapons, armor, consumables, gear, artifices, crafting materials, item mods, monsters,
and monster abilities. A separate Crafting Guide preserves explanatory notes from
Flo's Madness. The testing build uses only the focused equipment packs; the former mixed
Items & Equipment pack has been removed.

Prices ending in `c` in Flo's Madness are normalized as Clim. Amounts ending in `u` are
normalized as units. Every crafting entry retains its source tab, effects, requirements,
crafting points, mod slot, and polarity data.

### For GMs

Seeding runs by itself; there is nothing to install beyond the system. Packs
ship **locked**, which is what you want: it stops accidental edits and makes
updates clean. Seeding refreshes official entries when their reviewed source changes.
To customise one safely, import it into the world Items directory or copy it into
a world-owned compendium first; edits made directly inside a system pack can be
replaced by a later system update.

To rebuild from scratch after changing a content file, run this in the console:

```js
game.lyrian.resetSystemPacks();   // clears seeded entries, keeps your own
game.lyrian.seedSystemPacks({ force: true });
```

Automatic seeding can be disabled in Settings if you maintain your own content.

## Modules and the public API

`game.lyrian.api` is a stability promise — names and payload shapes will not
change without a major version bump.

```js
const api = game.lyrian.api;
api.getActionSet(actor);        // everything a HUD needs in one call
api.rollAttack(actor, itemId, "heavy");
api.getAttackData(chatMessage); // structured payload, or null
```

Hooks fired: `lyrianAttack`, `lyrianDamage`, `lyrianHealing`, `lyrianDowned`,
`lyrianTurnStart`. The attack payload carries the attack type, weapon group,
accuracy and damage rolls, crit state, keywords, pierce flags and per-target
results with UUIDs — enough for Automated Animations to key off Light, Heavy or
Precise, and for a HUD to build buttons without touching internals.

## Cover

Set cover per token rather than per attack, so a token behind a wall stays
behind it:

```js
token.document.setFlag("lyrian-chronicles", "cover", "high");  // none|low|high|full
```

Low cover gives +4 Evasion, high gives +6 Evasion and +1 Guard, full makes the
token untargetable. Size differences shift Evasion by 1 per step.

## What is left to the table

Cover, stealth, grapple escape power, mounted combat, crafting dice pools, gathering node
points, interlude bookkeeping and the housing rules are all supported by fields on the sheet
but resolved by the GM. That is deliberate: automating them before you have played a few
sessions tends to lock in the wrong assumptions.

## Layout

```
system.json              Manifest and document subtype declarations
module/
  config.mjs             All rules tables — edit here to reskin or rebalance
  data/actor.mjs         TypeDataModel schemas and derived stat maths
  data/item.mjs          Weapon, armour, ability, class, breakthrough, race, gear, injury
  documents/actor.mjs    Rolls, resource spending, damage application
  documents/item.mjs     Attack pipeline and chat cards
  documents/combat.mjs   Initiative and turn refresh
  sheets/                ApplicationV2 sheets
templates/               Handlebars templates
styles/lyrian.css        Sheet and chat card styling
lang/en.json             All display strings
```

`config.mjs` is the file to open first. Weapon groups, damage types, armour tables, injury
entries and progression costs all live there as plain data.

## Adding content

Create Items in a compendium and drag them onto sheets:

- **Class** items track tier and progression through level 8.
- **Ability** items carry AP / RP / mana costs, keywords, and an optional attack payload.
  Tick *Use equipped weapon damage* for abilities that ride on a weapon strike.
- **Breakthrough** items record EXP cost and level.

Passive bonuses are best handled with Active Effects targeting keys such as
`system.stats.power.bonus`, `system.defences.guardBonus`, `system.skills.stealth.bonus`,
`system.hp.maxBonus`, `system.ap.bonus` or `system.movement.bonus`. Every one of those is a
real schema field, so effects apply cleanly before derived stats are calculated.

## Modules

Generic modules work: Dice So Nice, Token Action HUD (core), Drag Ruler, FXMaster, Monk's
Token Bar, Sequencer, Automated Animations, and anything else that operates on scenes,
tokens, journals or chat. System-specific modules do not — a D&D 5e module reads
`system.abilities.str` and finds nothing here.

If you want to publish your own companion module, its `system.json` should list
`"relationships": { "systems": [{ "id": "lyrian-chronicles" }] }`, and it can hook into
`game.lyrian` for the exported document classes and config table.

## Licence

Code is yours to license as you wish. The *Lyrian Chronicles* rules, setting and trademarks
belong to Angel's Sword Studios; check their terms before distributing anything containing
their rules text or art.
