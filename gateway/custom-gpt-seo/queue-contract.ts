import type { CustomGptQueue } from "./queue";
import type { GptSeoJob } from "../../src/modules/custom-gpt-seo";

/** Both legacy fixtures and the asynchronous production queue implement this boundary. */
export type SeoQueue = {
  [Method in keyof CustomGptQueue]: CustomGptQueue[Method] extends (...arguments_: infer Input) => infer Output
    ? (...arguments_: Input) => Output | Promise<Output>
    : never;
} & {
  findLatestSourceJobs?: (storeId: string, source: string, productIds: readonly string[]) => Promise<ReadonlyMap<string, GptSeoJob>>;
};
