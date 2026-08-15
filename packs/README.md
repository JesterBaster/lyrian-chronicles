# Compendium packs

Foundry creates each declared LevelDB pack here. On world load the
system fills and updates them from the generated JSON in `content/`.

Do not hand-edit these directories. Review changes in the normalized snapshot,
approve the rulebook diff, then run `node tools/build-compendiums.mjs`.
