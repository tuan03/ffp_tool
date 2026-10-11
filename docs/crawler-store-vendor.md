# Crawler store vendors

Configure **Vendor Shopify** in the crawler's product tab. Save once per store;
subsequent sessions load the durable Coordinator configuration. Edit and save to
change the vendor for future jobs. Unsaved edits prevent starting a new job.

The operator-authorized `GET /api/v1/store-vendors/{storeId}` and `PUT` (body:
`{ "vendor": "Brand" }`) persist configuration in `coordinator_state`. No new
database migration, environment variable, or dependency is required. Vendor is
trimmed, case-preserving, required, and limited to 255 characters without control
characters. Missing configuration returns a null vendor; it never derives a
default from the store ID.

Both job creation and replacement capture the server configuration in job
settings (`vendor`, `vendorPolicyVersion: 1`), ignoring any client-supplied vendor.
Manual and automatic crawler Shopify sync use that immutable snapshot. Jobs
created before this feature retain their prior legacy vendor behavior; they do
not read a newly changed store configuration during processing. Existing Shopify
products are not bulk-updated, and Auto SEO's existing-product publisher continues
preserving the product's current vendor.

Production stores must save their vendor once after deploying this feature.
