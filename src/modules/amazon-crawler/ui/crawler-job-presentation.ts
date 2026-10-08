import type { AmazonCrawlerJobSnapshot, AmazonCrawlerJobSummary } from "../types";

type PresentableJob = Pick<
  AmazonCrawlerJobSnapshot | AmazonCrawlerJobSummary,
  "status" | "executionState" | "seoQueueHandoff"
> & {
  readonly progress?: AmazonCrawlerJobSnapshot["progress"];
};

export interface CrawlerJobPresentation {
  readonly label: string;
  readonly tone: "active" | "success" | "warning" | "error" | "neutral";
  readonly canPause: boolean;
  readonly canCancel: boolean;
  readonly hasReachedSeoQueue: boolean;
}

function countLabel(count: number, total: number): string {
  return total > 0 ? ` · ${count}/${total} sản phẩm` : "";
}

export function resolveCrawlerJobPresentation(job: PresentableJob): CrawlerJobPresentation {
  const isBackendActive = ["queued", "running", "waiting_captcha"].includes(job.status);
  const completedLinks = job.progress?.completed ?? 0;
  const totalLinks = job.progress?.total ?? 0;
  const hasFinishedCrawling = totalLinks > 0 && completedLinks >= totalLinks;
  const handoff = job.seoQueueHandoff;

  if (job.status === "cancelling") {
    return { label: "Đang hủy job", tone: "warning", canPause: false, canCancel: true, hasReachedSeoQueue: false };
  }
  if (job.status === "cancelled") {
    return { label: `Đã hủy · ${completedLinks}/${totalLinks} link đã giữ lại`, tone: "neutral", canPause: false, canCancel: false, hasReachedSeoQueue: false };
  }
  if (job.executionState === "pausing") {
    return { label: `Đang tạm dừng · ${completedLinks}/${totalLinks} link`, tone: "warning", canPause: true, canCancel: true, hasReachedSeoQueue: false };
  }
  if (job.executionState === "paused") {
    return { label: `Đã tạm dừng · ${completedLinks}/${totalLinks} link`, tone: "warning", canPause: true, canCancel: true, hasReachedSeoQueue: false };
  }
  if (["completed", "review_pending"].includes(job.status) && handoff?.totalProducts === 0
      && (handoff.skippedExistingPipeline ?? 0) > 0) {
    return { label: `Đã kiểm tra · giữ nguyên ${handoff.skippedExistingPipeline} sản phẩm đang ở SEO Queue/Review${
      (handoff.skippedExistingShopify ?? 0) > 0 ? ` · ${handoff.skippedExistingShopify} đã có trên Shopify` : ""}`,
      tone: "success", canPause: false, canCancel: false, hasReachedSeoQueue: false };
  }
  if (["completed", "review_pending"].includes(job.status) && handoff?.totalProducts === 0
      && (handoff.skippedExistingShopify ?? 0) > 0) {
    return { label: `Đã kiểm tra · bỏ qua ${handoff.skippedExistingShopify} sản phẩm đã có trên Shopify`,
      tone: "success", canPause: false, canCancel: false, hasReachedSeoQueue: false };
  }
  if (handoff && handoff.totalProducts > 0 && handoff.pending === 0) {
    if (handoff.handedOver === handoff.totalProducts) {
      return {
        label: `Đã bàn giao SEO Queue${countLabel(handoff.handedOver, handoff.totalProducts)}`,
        tone: "success", canPause: false, canCancel: false, hasReachedSeoQueue: true,
      };
    }
    if (handoff.handedOver > 0) {
      return {
        label: `Bàn giao một phần${countLabel(handoff.handedOver, handoff.totalProducts)}`,
        tone: "warning", canPause: false, canCancel: false, hasReachedSeoQueue: true,
      };
    }
    return { label: "Thất bại trước khi bàn giao", tone: "error", canPause: false, canCancel: false, hasReachedSeoQueue: false };
  }
  if (job.status === "review_pending" || job.status === "completed") {
    return { label: "Đã bàn giao SEO Queue", tone: "success", canPause: false, canCancel: false, hasReachedSeoQueue: true };
  }
  if (job.status === "partial") {
    return { label: "Bàn giao một phần", tone: "warning", canPause: false, canCancel: false, hasReachedSeoQueue: true };
  }
  if (job.status === "failed") {
    return { label: "Thất bại trước khi bàn giao", tone: "error", canPause: false, canCancel: false, hasReachedSeoQueue: false };
  }
  if (job.status === "waiting_captcha") {
    return { label: "Đang chờ xử lý CAPTCHA", tone: "warning", canPause: true, canCancel: true, hasReachedSeoQueue: false };
  }
  if (hasFinishedCrawling || (handoff && handoff.pending > 0)) {
    return {
      label: `Đang bàn giao SEO Queue${countLabel(handoff?.handedOver ?? 0, handoff?.totalProducts ?? 0)}`,
      tone: "active", canPause: false, canCancel: isBackendActive, hasReachedSeoQueue: false,
    };
  }
  if (job.status === "queued") {
    return { label: "Đang chờ Agent", tone: "neutral", canPause: true, canCancel: true, hasReachedSeoQueue: false };
  }
  return {
    label: `Đang cào · ${completedLinks}/${totalLinks} link`,
    tone: "active", canPause: isBackendActive, canCancel: isBackendActive, hasReachedSeoQueue: false,
  };
}
