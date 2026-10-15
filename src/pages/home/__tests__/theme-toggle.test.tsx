import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AppProviders } from "../../../app/providers/AppProviders";
import { ThemeToggle } from "../../../layouts/components/ThemeToggle";

test("theme control starts in the white mode with an accessible dark-mode action", () => {
  const html = renderToStaticMarkup(<AppProviders><ThemeToggle /></AppProviders>);
  assert.match(html, /type="button"/);
  assert.match(html, /aria-label="Chuyển sang chế độ tối"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /h-11 min-w-11/);
  assert.match(html, />Sáng<\/span>/);
});
