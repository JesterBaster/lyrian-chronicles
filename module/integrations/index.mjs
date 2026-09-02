/**
 * Optional module integrations.
 *
 * Each registration attaches to a hook that only the module in question fires,
 * so nothing here runs — and nothing here can throw — when that module is
 * absent. That is deliberate: the system must not care whether a table has
 * installed any of them.
 *
 * Modules that need nothing from a system are not listed. Sequencer is a
 * library driven by macros, and reads this system through the documented
 * `lyrian*` hooks; Quick Insert indexes documents and drags them onto sheets
 * through Foundry's own drop handling; Find the Culprit works on the module
 * list alone. See the README for what each of those can already do.
 */
import { registerTokenActionHud } from "./token-action-hud.mjs";
import { registerDragRuler } from "./drag-ruler.mjs";
import { registerDiceSoNice } from "./dice-so-nice.mjs";

export function registerIntegrations() {
  registerTokenActionHud();
  registerDragRuler();
  registerDiceSoNice();
}
