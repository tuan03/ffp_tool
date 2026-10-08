import assert from "node:assert/strict";
import test from "node:test";

import { normalizePublishedDescriptionHtml } from "../seo-worker/publish-html";

test("ignores formatting newlines between block elements but keeps inline whitespace", () => {
  assert.equal(normalizePublishedDescriptionHtml('<p>Bag</p>\n<ul>\n<li>Red</li>\n<li>Blue</li>\n</ul>'),
    normalizePublishedDescriptionHtml('<p>Bag</p><ul><li>Red</li><li>Blue</li></ul>'));
  assert.notEqual(normalizePublishedDescriptionHtml('<p><span>Red</span> <span>Bag</span></p>'),
    normalizePublishedDescriptionHtml('<p><span>Red</span><span>Bag</span></p>'));
});

test("does not ignore changed text, links, attributes or whitespace in preformatted content", () => {
  for (const [left, right] of [
    ['<p>Red Bag</p>', '<p>Blue Bag</p>'],
    ['<p><a href="/a">Bag</a></p>', '<p><a href="/b">Bag</a></p>'],
    ['<p class="a">Bag</p>', '<p class="b">Bag</p>'],
    ['<pre>\n<p>A</p>\n<p>B</p>\n</pre>', '<pre><p>A</p><p>B</p></pre>'],
  ]) assert.notEqual(normalizePublishedDescriptionHtml(left), normalizePublishedDescriptionHtml(right));
});
