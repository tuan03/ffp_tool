import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  groupBulkCustomizations,
  listBulkCustomizationFields,
  removeBulkCustomizationFields,
} from "../bulk-edit";

const customization = {
  surfaces: [
    {
      id: "surface-a",
      name: "Front",
      previewUrl: "https://cdn.example.com/front-a.jpg",
    },
  ],
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
      surfaces: customization.surfaces.map((surface) => ({
        ...surface,
        id: `${surface.id}-other`,
        previewUrl: "https://cdn.example.com/front-b.jpg",
      })),
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
    assert.equal(groups[0].fields.length, 4);
  });

  it("removes the selected semantic field while preserving other fields", () => {
    const sizeField = listBulkCustomizationFields(customization).find(
      (field) => field.label === "Choose Size",
    );
    assert.ok(sizeField);

    const updated = removeBulkCustomizationFields(customization, new Set([sizeField.key]));

    assert.equal(updated.textInputs?.length, 2);
    assert.deepEqual(updated.optionGroups, []);
    assert.equal(updated.surfaces?.length, 1);
  });

  it("removes a matching print surface across products while ignoring image URL differences", () => {
    const surface = listBulkCustomizationFields(customization).find(
      (field) => field.kind === "surface",
    );
    assert.ok(surface);

    const updated = removeBulkCustomizationFields(customization, new Set([surface.key]));

    assert.deepEqual(updated.surfaces, []);
    assert.equal(updated.textInputs?.length, 2);
    assert.equal(updated.optionGroups?.length, 1);
  });

  it("keeps products with different print surface layouts in separate groups", () => {
    const backOnlyCustomization = {
      ...customization,
      surfaces: [{ ...customization.surfaces[0], name: "Back" }],
    };

    const groups = groupBulkCustomizations([
      { product: { id: "front" }, customization },
      { product: { id: "back" }, customization: backOnlyCustomization },
    ]);

    assert.equal(groups.length, 2);
  });

  it("groups legacy fields whose labels are not strings without crashing", () => {
    const malformedCustomization = {
      optionGroups: [
        {
          id: "legacy-size",
          label: { text: "Choose Size" },
          type: "select",
          options: [{ id: "queen", label: 42 }],
        },
      ],
    } as unknown as typeof customization;

    const fields = listBulkCustomizationFields(malformedCustomization);
    const groups = groupBulkCustomizations([
      { product: { id: "legacy" }, customization: malformedCustomization },
    ]);

    assert.equal(fields[0]?.label, "Choose Size");
    assert.equal(fields[0]?.detail, "1 lựa chọn");
    assert.equal(groups.length, 1);
  });
});
