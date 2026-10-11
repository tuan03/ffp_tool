/** Job snapshots are immutable. Only jobs created before vendor configuration retain legacy behavior. */
export function resolvePipelineVendor(settings: Readonly<Record<string, unknown>> | undefined, storeId: string): string {
  const vendor = typeof settings?.vendor === "string" ? settings.vendor.trim() : "";
  if (vendor && vendor.length <= 255 && !/[\u0000-\u001f\u007f]/.test(vendor)) return vendor;
  if (settings?.vendorPolicyVersion !== undefined || settings?.vendor !== undefined) {
    throw new Error("STORE_VENDOR_REQUIRED: Crawl job has no valid vendor snapshot.");
  }
  return (storeId.split("--")[0] || storeId).trim().toUpperCase();
}
