import path from "node:path";
import { pathToFileURL } from "node:url";

import { migrateAutoSeoReviewsLocal } from "./auto-seo-review-migration";
import { AutoSeoPostgresRepository, requireLocalAutoSeoDatabase } from "./auto-seo-postgres-repository";
import { AutoSeoPostgresReviewRepository } from "./auto-seo-review-postgres";

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const databaseUrl = process.env.AUTO_SEO_TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("AUTO_SEO_TEST_DATABASE_URL is required for local review migration");
  requireLocalAutoSeoDatabase(databaseUrl);
  const backupRepository = new AutoSeoPostgresRepository({ databaseUrl });
  const reviewRepository = new AutoSeoPostgresReviewRepository({ databaseUrl });
  try {
    await backupRepository.verifyLocalTarget();
    await reviewRepository.initializeSchema();
  } finally {
    await backupRepository.close();
    await reviewRepository.close();
  }
  const report = await migrateAutoSeoReviewsLocal({
    sourcePath: path.resolve(".local-data/auto-seo.sqlite3"),
    databaseUrl,
  });
  console.log(JSON.stringify(report, null, 2));
}
