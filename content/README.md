# Generated compendium content

These JSON files are deterministic Foundry document sources compiled from the approved Angel's Sword rulebook v0.13.1 snapshot in `content-source/approved/0.13.1/`.

| Review order | File | Documents |
| ---: | --- | ---: |
| 1 | `rules-setting-guide-*.json` | 2 |
| 2 | `keywords-*.json` | 87 |
| 3 | `breakthroughs-*.json` | 89 |
| 4 | `player-abilities-*.json` | 1,112 |
| 5 | `races-*.json` | 48 |
| 6 | `classes-*.json` | 181 |
| 7 | `items-*.json` | 206 |
| 8 | `monsters-*.json` | 84 |
| 9 | `monster-abilities-*.json` | 307 |

`compendium-index.json` tells the runtime which chunks belong to each pack. Run `node tools/build-compendiums.mjs` to rebuild the files. Do not hand-edit generated JSON. Every document has a deterministic 16-character ID, stable seed key, source URL, normalized source hash, and rulebook version.

The older placeholder JSON remains in this directory for one migration cycle but is no longer declared or seeded into active packs.
