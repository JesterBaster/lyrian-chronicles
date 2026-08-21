/**
 * Escape a plain-text field before it enters Foundry's HTML enrichment pipeline.
 * This preserves inline-roll and document-link syntax while preventing stored
 * markup from becoming active chat HTML.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeChatText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

/**
 * Prepare item content for raw Handlebars insertion in a chat card.
 *
 * HTMLField content is enriched and then cleaned. Requirement fields are
 * StringFields, so they are escaped before enrichment and cleaned afterwards.
 *
 * @param {object} input
 * @param {unknown} input.description
 * @param {unknown} input.requirement
 * @param {(content: string, options: object) => Promise<string>} input.enrichHTML
 * @param {(content: string) => string} input.cleanHTML
 * @param {object} [input.enrichOptions]
 * @returns {Promise<{enrichedDescription: string, enrichedRequirement: string}>}
 */
export async function prepareItemChatContent({
  description,
  requirement,
  enrichHTML,
  cleanHTML,
  enrichOptions = {}
}) {
  const [descriptionHTML, requirementHTML] = await Promise.all([
    enrichHTML(String(description ?? ""), enrichOptions),
    enrichHTML(escapeChatText(requirement), enrichOptions)
  ]);

  return {
    enrichedDescription: cleanHTML(descriptionHTML),
    enrichedRequirement: cleanHTML(requirementHTML)
  };
}

/**
 * Apply a whisper/blind mode to chat message data before it is created.
 *
 * Rendering our own card bypasses `Roll#toMessage`, which is what would
 * normally honour the mode — so every card that wants it has to say so. The
 * core method was renamed in v14 (`applyRollMode` → `applyMode`), and this is
 * the one place that names it: the older name is still accepted so the system
 * keeps working on a core that predates the rename.
 *
 * @param {object} messageData          Mutated in place, as the core method does.
 * @param {string} mode                 "publicroll" | "gmroll" | "blindroll" | "selfroll"
 * @param {object} [ChatMessageClass]   Injected for tests.
 * @returns {object} The same messageData.
 */
export function applyChatMode(messageData, mode, ChatMessageClass = globalThis.ChatMessage) {
  const apply = ChatMessageClass?.applyMode ?? ChatMessageClass?.applyRollMode;
  apply?.call(ChatMessageClass, messageData, mode);
  return messageData;
}
