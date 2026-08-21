import { forEachDocument } from "./migrate.mjs";
import { repairArtwork } from "../module/rules/artwork.mjs";

/**
 * 0.6.30 — replace artwork a canvas cannot load.
 *
 * The official art is hosted on a CDN that sends no Access-Control-Allow-Origin
 * header. Sheet portraits looked fine, because a plain <img> needs no such
 * header — but a canvas texture does, so every token using that art failed to
 * draw and rendered as nothing at all.
 *
 * The shipped content no longer points there. This catches the documents
 * already sitting in a world: monsters dragged onto a scene, classes and races
 * on a character, equipment in a bag. Only a blocked host is rewritten, so a
 * GM's own artwork is never touched, and the original URL is kept in a flag.
 */
export async function runMigration() {
  for (const documentName of ["Actor", "Item"]) {
    await forEachDocument(documentName, async (document) => {
      const update = repairArtwork(document._source ?? document);
      if (update) await document.update(update);
    }, { includeLockedSystemPacks: true });
  }
}
