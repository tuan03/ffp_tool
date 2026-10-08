import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  groupBulkCustomizations,
  listBulkCustomizationFields,
  removeBulkCustomizationFields,
} from "../bulk-edit";

const customization = {
  textInputs: [
    { id: "name-a", type: "TextInputComponent", label: "Customize Your Name", maxLength: 30 },
    { id: "number-a", type: "TextInputComponent", label: "Customize Your Number", maxLength: 5 },
  ],
  optionGroups: [
    {
      id: "size-a",
      type: "select",
      label: "Choose Size",
      options: [
        { id: "queen-a", label: "Queen" },
        { id: "king-a", label: "King" },
      ],
    },
  ],
};

describe("Customizer bulk editing", () => {
  it("groups matching field structures even when Shopify field IDs differ", () => {
    const secondCustomization = {
      ...customization,
      textInputs: customization.textInputs.map((field) => ({ ...field, id: `${field.id}-other` })),
      optionGroups: customization.optionGroups.map((group) => ({
        ...group,
        id: `${group.id}-other`,
        options: group.options.map((option) => ({ ...option, id: `${option.id}-other` })),
      })),
    };

    const groups = groupBulkCustomizations([
      { product: { id: "one" }, customization },
      { product: { id: "two" }, customization: secondCustomization },
    ]);

    assert.equal(groups.length, 1);
    assert.equal(groups[0].entries.length, 2);
    assert.equal(groups[0].fields.length, 3);
  });

  it("removes the selected semantic field while preserving other fields", () => {
    const sizeField = listBulkCustomizationFields(customization).find(
      (field) => field.label === "Choose Size",
    );
    assert.ok(sizeField);

    const updated = removeBulkCustomizationFields(customization, new Set([sizeField.key]));

    assert.equal(updated.textInputs?.length, 2);
    assert.deepEqual(updated.optionGroups, []);
  });
});
