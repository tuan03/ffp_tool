# Crawler automatic Shopify sync

New crawler jobs can snapshot `autoSyncAfterSeo: true`. The crawler UI enables
this by default and remembers the choice separately for each store. Jobs without
this explicit setting, existing reviews, and non-Codex SEO remain manual.

The Coordinator queues sync atomically only after Codex SEO and checkpointed image
processing both complete. Approval is recorded as `automatic_policy`, not a human
review. Existing sync fencing, processed-media staging, ASIN metadata, AEO/Schema,
SKU generation, collections and pricing remain in the Pipeline Worker.

After the product write is checkpointed, the worker publishes the product to all
accessible app/sales-channel publications. Market and B2B catalogs are excluded;
this does not configure Shopify's separate Agentic storefront enrollment. The
store's app must have `read_publications` and `write_publications`. API visibility
and channel eligibility can prevent full publication even for an ACTIVE product.

Each channel is checked before and after publishing. A partial/failed publication
is shown as **Đã sync · publish chưa đủ** in SEO Review. **Thử lại publish kênh**
queues a publication-only claim using the saved product ID; it never reruns SEO,
uploads images, acquires a GPT product-write permit, or creates another product.
Already-published channels are skipped. Deleted/inactive products are reported,
not recreated by this action.

Publishing operations require explicit apply mode and an idempotency request ID.
Each operator retry advances the publication attempt so a cached partial result
does not permanently block recovery. Review details retain per-channel outcomes.

References:

- [Shopify product publishing](https://shopify.dev/docs/apps/build/sales-channels/product-publishing)
- [PublishablePublish](https://shopify.dev/docs/api/admin-graphql/latest/mutations/publishablePublish)
