/**
 * Client-side HTML sanitizer for rich text previews in the SEO Review UI.
 *
 * Strips executable script tags, embedded frames, active objects,
 * inline event handlers (onclick, onerror, onload, etc.), and javascript: protocols.
 *
 * Complies with AGENTS.md Rule 8.
 */
export function sanitizeHtmlDescription(dirtyHtml: string): string {
  if (!dirtyHtml || typeof dirtyHtml !== "string") {
    return "";
  }

  // Quick return if there are no HTML tags
  if (!dirtyHtml.includes("<") && !dirtyHtml.includes(">")) {
    return dirtyHtml;
  }

  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    // Regex-based fallback for node/SSR test environments
    return dirtyHtml
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
      .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "")
      .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, "")
      .replace(/\s+on[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/href\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]+)/gi, 'href="#"');
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(dirtyHtml, "text/html");

    // Remove forbidden executable and embed tags
    const forbiddenTags = [
      "script",
      "iframe",
      "object",
      "embed",
      "link",
      "style",
      "form",
      "input",
      "button",
      "textarea",
      "select",
      "meta",
      "base",
      "applet",
    ];

    for (const tag of forbiddenTags) {
      const elements = doc.body.getElementsByTagName(tag);
      for (let i = elements.length - 1; i >= 0; i--) {
        const el = elements[i];
        if (el?.parentNode) {
          el.parentNode.removeChild(el);
        }
      }
    }

    // Strip inline event handlers and unsafe URI schemes from all attributes
    const allElements = doc.body.getElementsByTagName("*");
    for (let i = 0; i < allElements.length; i++) {
      const el = allElements[i];
      if (!el) continue;

      const attrsToRemove: string[] = [];
      for (let j = 0; j < el.attributes.length; j++) {
        const attr = el.attributes[j];
        if (!attr) continue;

        const attrName = attr.name.toLowerCase();
        const attrVal = attr.value.toLowerCase().trim();

        if (
          attrName.startsWith("on") ||
          attrVal.startsWith("javascript:") ||
          attrVal.startsWith("data:text/html")
        ) {
          attrsToRemove.push(attr.name);
        }
      }

      for (const attrName of attrsToRemove) {
        el.removeAttribute(attrName);
      }
    }

    return doc.body.innerHTML;
  } catch {
    return dirtyHtml
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "");
  }
}
