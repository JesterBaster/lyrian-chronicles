/**
 * Getting a file in and out of the browser.
 *
 * Foundry has no dialog for "hand me a file you already have", and none of its
 * file helpers reach outside the world's own storage. Both of these therefore
 * go straight at the DOM, which is fine — they are four lines each and touch
 * nothing else.
 */

/**
 * Ask the player for a file and read it.
 *
 * Resolves `null` if they close the picker. Chrome fires no event at all for a
 * cancelled picker in some versions, so a caller must be able to live with a
 * promise that simply never settles; nothing here holds a lock while it waits.
 *
 * @param {{accept?: string}} [options]
 * @returns {Promise<{name: string, bytes: Uint8Array}|null>}
 */
export function pickFile({ accept = "" } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (accept) input.accept = accept;
    input.style.display = "none";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return resolve(null);
      resolve({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    });
    input.addEventListener("cancel", () => { input.remove(); resolve(null); });
    document.body.append(input);
    input.click();
  });
}

/**
 * Hand the player a file to save.
 *
 * @param {Uint8Array} bytes
 * @param {string} filename
 * @param {string} [mime]
 */
export function downloadBytes(bytes, filename, mime = "application/octet-stream") {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking immediately races the download in Firefox; a tick is enough.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
