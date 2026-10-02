import { parse } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";

import type { AuditFinding, PageAudit } from "../../src/modules/seo-performance";

type HtmlNode = DefaultTreeAdapterMap["node"];
function attribute(node: HtmlNode, name: string): string { return "attrs" in node ? node.attrs.find(attr => attr.name === name)?.value ?? "" : ""; }
function tag(node: HtmlNode): string { return "tagName" in node ? node.tagName : ""; }
function nodeText(node: HtmlNode): string {
  if ("value" in node && node.nodeName === "#text") return node.value;
  return "childNodes" in node ? node.childNodes.filter(child => !["script", "style", "noscript", "template"].includes(tag(child))).map(nodeText).join(" ") : "";
}
function compact(text: string): string { return text.replace(/\s+/g, " ").trim(); }
export function inspectHtml(input: { readonly url: string; readonly status: number; readonly html: string; readonly expectedSummary?: string; readonly robotsHeader?: string }): PageAudit {
  const document = parse(input.html);
  const nodes: HtmlNode[] = [];
  function walk(node: HtmlNode): void { nodes.push(node); if ("childNodes" in node) node.childNodes.forEach(walk); }
  walk(document);
  const elements = (name: string) => nodes.filter(node => tag(node) === name);
  const title = compact(elements("title").map(nodeText).join(" "));
  const description = elements("meta").find(node => attribute(node, "name").toLowerCase() === "description");
  const canonicalNode = elements("link").find(node => attribute(node, "rel").split(/\s+/).includes("canonical"));
  let canonical: string | null = null;
  try { if (canonicalNode) canonical = new URL(attribute(canonicalNode, "href"), input.url).href; } catch { /* Invalid canonical is reported as missing. */ }
  const noindex = /\b(noindex|none)\b/i.test([input.robotsHeader, ...elements("meta").filter(node => ["robots", "googlebot"].includes(attribute(node, "name").toLowerCase())).map(node => attribute(node, "content"))].join(","));
  const text = compact(nodeText(document)).slice(0, 30_000);
  const jsonLd: unknown[] = [];
  let invalidJsonLd = false;
  for (const script of elements("script").filter(node => attribute(node, "type") === "application/ld+json")) {
    try { jsonLd.push(JSON.parse(nodeText(script))); } catch { invalidJsonLd = true; }
  }
  const links = new Set<string>();
  for (const anchor of elements("a")) {
    try { const url = new URL(attribute(anchor, "href"), input.url); if (url.origin === new URL(input.url).origin) { url.hash = ""; links.add(url.href); } } catch { /* Ignore malformed navigation. */ }
  }
  const findings: AuditFinding[] = [];
  const add = (code: string, message: string, status: AuditFinding["status"] = "needs_changes") => findings.push({ code, message, status });
  if (input.status >= 400) add("HTTP_ERROR", `HTTP ${input.status}`);
  if (noindex) add("NOINDEX", "Page contains a noindex directive; confirm whether intentional.");
  if (!title) add("TITLE_NOT_OBSERVED", "Title not observed in server HTML.", "unknown");
  if (!description) add("META_DESCRIPTION_NOT_OBSERVED", "Meta description not observed.", "unknown");
  if (!canonical) add("CANONICAL_NOT_OBSERVED", "Canonical not observed.", "unknown");
  if (invalidJsonLd) add("INVALID_JSON_LD", "At least one JSON-LD block is invalid JSON.");
  const aeoVisibility = input.expectedSummary ? (text.includes(compact(input.expectedSummary)) ? "observed" : "not_observed") : "unknown";
  if (aeoVisibility === "not_observed") add("AEO_NOT_OBSERVED", "Stored AEO summary was not observed in server HTML. Check theme rendering before concluding it is absent.", "unknown");
  return { url: input.url, status: input.status, title, description: description ? attribute(description, "content") : "", h1: elements("h1").map(node => compact(nodeText(node))), canonical, noindex, missingAltCount: elements("img").filter(node => !attribute(node, "alt").trim()).length, internalLinks: [...links].slice(0, 200), text, jsonLd, aeoVisibility, rendering: "static_only", findings };
}
