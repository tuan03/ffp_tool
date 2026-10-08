import { parseFragment, serialize } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";

const BLOCK_TAGS = new Set(["p", "div", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "section", "blockquote"]);

/** Shopify formats block HTML on save. Preserve content and all significant inline spaces. */
export function normalizePublishedDescriptionHtml(value: string): string {
  const fragment = parseFragment(value);
  function visit(node: DefaultTreeAdapterMap["node"]): void {
    if (!("childNodes" in node)) return;
    if ("tagName" in node && ["pre", "textarea", "code", "script", "style"].includes(node.tagName)) return;
    const isBlockBoundary = (sibling: DefaultTreeAdapterMap["node"] | undefined): boolean =>
      sibling === undefined || ("tagName" in sibling && BLOCK_TAGS.has(sibling.tagName));
    const isBlockContainer = "tagName" in node && BLOCK_TAGS.has(node.tagName);
    node.childNodes = node.childNodes.filter((child, index, siblings) => !(
      child.nodeName === "#text" && "value" in child && /^\s*\n\s*$/.test(child.value) &&
      ((isBlockBoundary(siblings[index - 1]) && isBlockBoundary(siblings[index + 1])) ||
        (isBlockContainer && (index === 0 || index === siblings.length - 1)))
    ));
    for (const child of node.childNodes) visit(child);
  }
  visit(fragment);
  return serialize(fragment);
}
