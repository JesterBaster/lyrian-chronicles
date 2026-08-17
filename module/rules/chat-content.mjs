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
