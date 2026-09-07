# Generated compendium content

These JSON files are deterministic Foundry document sources compiled from the approved Angel's Sword rulebook v0.13.2 snapshot in `content-source/approved/0.13.2/`.

| Review order | File | Documents |
| ---: | --- | ---: |
| 1 | `rules-setting-guide-*.json` | 2 |
| 2 | `keywords-*.json` | 92 |
| 3 | `breakthroughs-*.json` | 89 |
| 4 | `player-abilities-*.json` | 1,137 |
| 5 | `races-*.json` | 49 |
| 6 | `classes-*.json` | 185 |
| 7 | `weapons-*.json` | 45 |
| 8 | `armor-shields-*.json` | 9 |
| 9 | `consumables-*.json` | 58 |
| 10 | `gear-kits-*.json` | 31 |
| 11 | `artifices-*.json` | 47 |
| 12 | `materials-*.json` | 149 |
| 13 | `mods-*.json` | 391 |
| 14 | `crafting-guide-*.json` | 11 |
| 15 | `monsters-*.json` | 84 |
| 16 | `monster-abilities-*.json` | 307 |

`compendium-index.json` tells the runtime which chunks belong to each pack. Run `node tools/build-compendiums.mjs` to rebuild the files. Do not hand-edit generated JSON. Every document has a deterministic 16-character ID, stable seed key, source URL, normalized source hash, and rulebook version.

## Updating to a new rulebook version

The snapshot in `content-source/approved/` is the reviewed source; `content/` is
compiled from it. A newer capture is **merged onto** the approved one rather than
replacing it, because a snapshot read from the site's rendered pages carries the
new entries and the real rules edits but cannot see everything the approved copy
already holds:

```
node tools/merge-rulebook-snapshot.mjs \
  content-source/approved/<previous> <new-snapshot.json> <out-dir> --report
node tools/split-approved-snapshot.mjs <out-dir>/snapshot.json content-source/approved/<new>
node tools/build-compendiums.mjs
```

`--report` prints exactly which fields the merge took from the incoming snapshot,
and `tests/rulebook-merge.test.mjs` pins every rule about what it refuses. Then
update `EXPECTED`, the `SOURCE` default and the version guard in
`tools/build-compendiums.mjs`, and `CONTENT_VERSION` in
`module/content/seed-packs.mjs` so existing worlds re-seed.

The old mixed item pack and prototype JSON files were removed during the testing phase.

The Mods pack contains 93 universal mods and 298 reviewed item-specific mods from the Weapons, Armors, and Artifices tabs. Three Anti-Air Weapon Sight mods remain excluded because their crafting-point costs are blank in the source sheet.
