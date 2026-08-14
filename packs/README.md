# Compendium packs

Foundry creates each declared pack as a LevelDB directory here the first time a
world loads the system. They start empty.

To fill one: open the compendium in Foundry, unlock it, drag items in, then copy
the generated directory from your Foundry user data back into this folder and
commit it. That ships the content with the system for everyone else.

Do not hand-edit these directories — they are a binary database, not JSON.
