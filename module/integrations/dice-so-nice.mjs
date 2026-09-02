/**
 * Dice So Nice! integration.
 *
 * Dice So Nice animates whatever Roll objects a chat message carries, so the
 * substantive work is not here — it is that every message this system creates
 * from a roll attaches that roll. What this file adds is a colourway matching
 * the sheet, offered as the table's preferred set so a fresh install looks
 * like the system rather than like default Foundry.
 */

const SYSTEM_ID = "lyrian-chronicles";

/**
 * The sheet's own palette: gold on the near-black the windows use.
 * Keys are Dice So Nice's, defaulted by it where omitted.
 */
export const LYRIAN_COLORSET = Object.freeze({
  name: SYSTEM_ID,
  description: "LYRIAN.DiceSoNice.Colorset",
  category: "LYRIAN.Title",
  foreground: "#f6c928",
  background: "#12100c",
  outline: "#c9a227",
  edge: "#1c1913",
  texture: "metal",
  material: "metal",
  visibility: "visible"
});

export function registerDiceSoNice() {
  Hooks.once("diceSoNiceReady", (dice3d) => {
    // "preferred" sets the default for users who have not chosen their own.
    // It does not overwrite a choice someone already made.
    dice3d.addColorset(LYRIAN_COLORSET, "preferred");
  });
}
