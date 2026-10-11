import type { ShopifySyncProductInput } from "./types";

function invalidProjection(reason: string): never {
  throw new Error(`SHOPIFY_OPTION_PROJECTION_INVALID: ${reason}`);
}

/** Preserve two source axes and encode the remaining tuple without separator collisions. */
export function projectShopifyVariantOptions(product: ShopifySyncProductInput): ShopifySyncProductInput {
  const variants = product.variants ?? [];
  const axes = Array.from(new Set(variants.flatMap(variant => (variant.optionValues ?? []).map(option => option.optionName))));
  if (axes.length <= 3) return product;
  let combinedName = "Additional choices";
  while (axes.slice(0, 2).includes(combinedName)) combinedName += " (combined)";
  const combinations = new Set<string>();
  const projectedVariants = variants.map(variant => {
    const selections = new Map((variant.optionValues ?? []).map(option => [option.optionName, option.name]));
    if (selections.size !== axes.length || variant.optionValues?.length !== axes.length) {
      invalidProjection("Every variant must specify each source option exactly once.");
    }
    const values = axes.map(axis => {
      const value = selections.get(axis);
      if (!axis.trim() || !value?.trim() || axis !== axis.trim() || value !== value.trim()) {
        invalidProjection("Option names and values must be non-empty with no surrounding whitespace.");
      }
      return value;
    });
    const tuple = JSON.stringify(values.slice(2));
    const optionValues = [
      { optionName: axes[0], name: values[0] },
      { optionName: axes[1], name: values[1] },
      { optionName: combinedName, name: tuple },
    ];
    if (optionValues.some(option => [...option.optionName].length > 255 || [...option.name].length > 255)) {
      invalidProjection("Combined choices exceed 255 characters; shorten source labels before sync.");
    }
    const signature = JSON.stringify(values);
    if (combinations.has(signature)) invalidProjection("Duplicate source option combinations cannot be represented safely.");
    combinations.add(signature);
    return { ...variant, optionValues };
  });
  // The original customizer stays intact. Store the reversible mapping alongside it.
  const customization = product.customization ? {
    ...product.customization,
    shopifyOptionProjection: { version: 1, retainedAxes: axes.slice(0, 2), combinedAxes: axes.slice(2), combinedOptionName: combinedName, encoding: "json-array" },
  } : product.customization;
  return { ...product, variants: projectedVariants, options: [axes[0], axes[1], combinedName], customization };
}
