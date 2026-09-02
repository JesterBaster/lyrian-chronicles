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
| Action locking | One active GM authorizes each actor action lock, preventing two browsers from spending the same resources or resolving the same attack card concurrently |
| Once per round | Non-Rapid abilities lock until the owner's next turn; one Secret Art per encounter |
| Downed | 0 HP applies Downed and Prone (grunts die outright); negative max HP applies Mortal Wound |
| Injuries | 1d10 injury table roll creates an Injury item on the actor |
| Skills | `d20 + sub stat + ranks + expertise`, with the 15 / 20 / uncapped rank cap tracked from Spirit Core |
| Crafting & gathering | Projects consume owned Gear, then accumulate Crafting Points across Basic Craft, Beginner's Luck, Steady Craft and Standard Finish until they reach the item's Crafting HP; spare points fit compatible owned Mods, a tool's crafting and finish bonuses apply, and success creates either a copy of a dropped Item or a custom weapon, armor or gear item priced at its Book Price; gathering stays `d10 + skill` checks |

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
api.rollMonsterAttack(actor, "light");
await api.evaluateRequirements(actor, itemId); // pass, fail, or manual confirmation
api.getAttackData(chatMessage); // structured attack payload, or null
api.getCraftData(chatMessage);  // structured crafting result, or null
```

Class unlocks, breakthrough drops, and ability use share this requirement evaluator.
Static actor-state requirements are enforced automatically; encounter-dependent or
ambiguous rules are presented for confirmation. A GM can pass
`{ ignoreRequirements: true }` to `useAbility` when making an explicit ruling.

Gameplay actions use the system socket declared in `system.json`. The active GM with the
lowest user ID is selected deterministically as the lock authority; action execution stays
on the requesting client and retains Foundry's normal ownership checks. Players are warned
instead of making an unsafe update when no GM is connected.

Skill and expertise caps are enforced on the Actor document, so sheet edits and
module/macro updates use the same rules. A GM receives an override confirmation in
the sheet. GM-authored automation can make the same explicit ruling with:

```js
await actor.update(
  { "system.skills.deception.rank": 16 },
  { lyrianAllowSkillCapOverride: true }
);
```

Hooks fired: `lyrianAttack`, `lyrianDamage`, `lyrianHealing`, `lyrianDowned`,
`lyrianTurnStart`, `lyrianMultiAttack`, `lyrianTrade`, and `lyrianCraft`. The attack payload
carries the attack type, weapon group, accuracy and damage rolls, crit state, keywords,
pierce flags, the attacking `tokenUuid`, and per-target results with both actor and token
UUIDs — enough for Automated Animations to key off Light, Heavy or Precise, for Sequencer
to draw an effect from the attacker to each target, and for a HUD to build buttons without
touching internals. `tokenUuid` is null when the actor is not on the canvas, or when a
linked actor has several tokens on the scene and no one of them is the attacker. NPC and monster
basic profiles appear in `getActionSet(actor).monsterAttacks` and use the same target,
Dodge / Block, damage and chat-card pipeline as character attacks.

## Cover

Set cover per token rather than per attack, so a token behind a wall stays
behind it:

```js
token.document.setFlag("lyrian-chronicles", "cover", "high");  // none|low|high|full
```

Low cover gives +4 Evasion, high gives +6 Evasion and +1 Guard, full makes the
token untargetable. Size differences shift Evasion by 1 per step.

## What is left to the table

Cover, stealth, grapple escape power, mounted combat, gathering node points and depletion,
interlude bookkeeping, and the housing rules remain resolved by the GM. A custom item is forged
with default stats and edited on its own item sheet afterwards, because the rulebook sets no
costing for arbitrary weapon and armor values. That is deliberate: automating them before you
have played a few sessions tends to lock in the wrong assumptions.

Dropping a compendium item onto a project reads its Crafting HP off the item, so the target
is only typed by hand for something the packs do not carry. A successful craft converts the
copy into a real weapon, armor or gear item — a compendium entry is a reference page that
cannot be equipped — and a craft that ends short can be started again from the same project
rather than rebuilt. A crafting tool's bonuses are
entered per project: **Tool Bonus** applies to every crafting dice roll, **Finish Bonus**
once when the craft is settled. A finished craft is priced by Flo's Madness's Book Price rule
— base item cost, 25 Clim per crafting point of each Mod, plus materials — and the chat card
shows the breakdown line by line. The baseline ingot a recipe already includes in the item's
own cost is not detectable from the data, so every material listed is priced; drop that line
from the project if your table follows the sheet's "(Ignored)" convention.

By default only the GM defines projects. Enable **Players may author crafting projects** in
system settings to let players create their own, including custom output and mods.

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

Generic modules work: FXMaster, Monk's Token Bar, Automated Animations, and anything
else that operates on scenes, tokens, journals or chat. System-specific modules do not —
a D&D 5e module reads `system.abilities.str` and finds nothing here.

Six modules are supported directly. Install the module; there is nothing to configure,
and nothing here runs on a table that has not installed it.

| Module | What you get |
| --- | --- |
| **Token Action HUD Core** | A full HUD, built by the system. **No companion module to install** — the usual `token-action-hud-<system>` package does not exist for Lyrian and is not needed. Four tabs: Combat (weapons, the universal light/heavy/precise attacks, actions and reactions), Checks (stats, the save, skills, artisan, gathering), Inventory, Utility (passives, initiative, rest, injury table). A weapon button is a light attack; **Ctrl-click** for heavy, **Alt-click** for precise, **right-click** to open the item. Shift-click a universal attack to take it free. Token Action HUD Core requires socketlib, as it does for every system. |
| **Drag Ruler** | Movement is bought out of the same Action Points as everything else, so the drag is banded by what the token can still pay for: green for one move, gold for everything the remaining AP buys, red when there is no AP left. Flight and swim speeds widen the band when they are faster. |
| **Dice So Nice!** | Every roll the system makes is attached to its chat message, so all of them animate — including the fresh damage roll made when a block cancels a critical hit, which used to be evaluated and thrown away where nobody could see it. Ships a Lyrian gold colourway as the table default, which does not override a colour someone has already chosen. |
| **Sequencer** | Needs no registration — it is a macro library. What it needs from a system is somewhere to draw from and to: `lyrianAttack` carries `tokenUuid` for the attacking token and a `tokenUuid` per target, so `.atLocation()` and `.stretchTo()` work without guessing which token an actor meant. |
| **Quick Insert** | Works as shipped. Its own integrations are compiled into that module for a fixed list of systems, so there is nothing for a system to register — but the omnibar indexes every document and compendium here, and its results drop onto Lyrian sheets through Foundry's standard drop handling, which is what the sheets already accept. |
| **Find the Culprit** | Nothing to do, by design. It bisects your module list to find which one is causing a problem and never touches system data. |


If you want to publish your own companion module, its `system.json` should list
`"relationships": { "systems": [{ "id": "lyrian-chronicles" }] }`, and it can hook into
`game.lyrian` for the exported document classes and config table.

## Licence

Code is yours to license as you wish. The *Lyrian Chronicles* rules, setting and trademarks
belong to Angel's Sword Studios; check their terms before distributing anything containing
their rules text or art.
