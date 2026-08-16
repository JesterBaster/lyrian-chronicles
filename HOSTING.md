# Hosting this system on GitHub

Two ways to get the system into Foundry. Start with the first, move to the second when
you want other people installing it by URL.

## 1. Development: symlink, no releases needed

While you are actively editing, do not install from a manifest — you would have to cut a
release for every change. Clone the repo and point Foundry at it directly.

```bash
cd ~/FoundryVTT/Data/systems           # your Foundry user data path
git clone https://github.com/JesterBaster/lyrian-chronicles.git
```

The folder name **must** be `lyrian-chronicles`, matching the `id` in `system.json`.
Foundry refuses to load a system whose directory name and id disagree.

Now edit files, then reload the world with F5. Changes to `system.json` itself need a
full Foundry restart, and changes to data model schemas need the world relaunched from
the setup screen.

## 2. Distribution: releases with a manifest URL

### One-time setup

1. Create the repo on GitHub. Name it `lyrian-chronicles` so the URLs read cleanly.
2. Push everything, including `.github/workflows/release.yml`.
3. Settings → Actions → General → Workflow permissions → **Read and write permissions**.
   The workflow needs this to attach files to the release.

You do not need to edit the release URLs in `system.json` manually. Keep the committed
manifest valid and internally consistent for local development and pull-request CI.
When a release is published, the workflow stamps `version`, `manifest`, `download`
and `url` from the release tag before running the release tests and building assets.

### Cutting a release

```bash
git tag v0.1.0
git push origin v0.1.0
```

Then on GitHub: Releases → Draft a new release → pick tag `v0.1.0` → Publish.

Publishing triggers the workflow, which stamps the version, zips the system with
`system.json` at the archive root, and attaches `system.json` and `system.zip` to the
release. Watch the Actions tab; it takes about thirty seconds.

### Installing

In Foundry: Game Systems → Install System → paste into the manifest field:

```
https://github.com/JesterBaster/lyrian-chronicles/releases/latest/download/system.json
```

That URL always resolves to your newest release, which is what lets Foundry notice
updates. The `download` inside each manifest is pinned to its own tag, so installing an
older release still gets the matching build.

## Version numbering

Bump `version` in `system.json` before tagging — or rather, do not bother: the workflow
takes the version from the tag name, so the tag is the single source of truth. Tag
`v0.2.0`, get version `0.2.0`.

Foundry compares versions to decide whether an update exists, so versions must only ever
increase. `0.1.0` → `0.1.1` → `0.2.0`.

## Compatibility fields

```json
"compatibility": { "minimum": "13", "verified": "14", "maximum": "14" }
```

`verified` is the version you have actually tested against. Raise it when you test on a
newer Foundry. Consider dropping `maximum` entirely — leaving it out means Foundry warns
on untested versions rather than hard-blocking them, which is usually what you want.

## Things that will bite you

**The directory name.** `lyrian-chronicles`, exactly. Cloning creates a folder named
after the repo, so name the repo to match.

**Zip structure.** `system.json` must sit at the root of `system.zip`, not inside a
nested folder. The workflow handles this; if you ever zip by hand, `cd` into the system
directory first rather than zipping the directory itself.

**Schema changes break existing worlds.** Adding or renaming fields in `module/data/`
will not retroactively fix actors created under the old schema. Before you have players,
this is fine. Once you do, write a migration in a `ready` hook that checks a stored
version flag and patches documents forward.

**Release assets are cached.** If you re-upload assets to an existing tag, GitHub's CDN
may serve the old file for a few minutes. Cutting a new patch version is more reliable
than editing a published release.

## Optional: a rolling manifest with GitHub Pages

Some people prefer a manifest URL that never changes and is not tied to releases. Enable
Pages on the `main` branch and use:

```
https://JesterBaster.github.io/lyrian-chronicles/system.json
```

This serves whatever is committed to `main`, so every push is effectively a release.
Convenient for a private game, risky for public distribution — a broken commit ships
immediately. The releases approach above is the better default.
