import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createCustomizationManagerRoutes,
  CustomizationManagerPage,
} from "../index";

describe("Customization Manager: UI & Routes", () => {
  it("createCustomizationManagerRoutes defines /customization path", () => {
    const routes = createCustomizationManagerRoutes();
    assert.equal(routes.length, 1);
    assert.equal(routes[0].path, "customization");
    assert.ok(routes[0].element);
  });

  it("CustomizationManagerPage component is properly exported", () => {
    assert.equal(typeof CustomizationManagerPage, "function");
  });
});
