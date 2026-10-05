import type { AmazonCrawlerAgentObservability, AmazonCrawlerMetrics, AmazonCrawlerTraceEvent, AmazonCrawlerTracePage } from "./types";

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Invalid crawler metrics or trace response.");
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length > 1024) throw new TypeError("Invalid crawler metrics or trace response.");
  return value;
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new TypeError("Invalid crawler metrics or trace response.");
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  return value === undefined || value === null ? undefined : number(value);
}

function rate(value: unknown): number | null {
  if (value === null) return null;
  const ratio = number(value);
  if (ratio > 1) throw new TypeError("Invalid crawler metrics response.");
  return ratio;
}

function agentObservability(value: Record<string, unknown>): AmazonCrawlerAgentObservability {
  const resources = value.resources === undefined ? {} : record(value.resources);
  const cache = value.cache === undefined ? {} : record(value.cache);
  return {
    cache: Object.fromEntries(Object.entries(cache).map(([key, count]) => [key, number(count)])),
    resources: {
      rssBytes: optionalNumber(resources.rssBytes), browserProcesses: optionalNumber(resources.browserProcesses),
      browserContexts: optionalNumber(resources.browserContexts), browserPages: optionalNumber(resources.browserPages),
      processCount: optionalNumber(resources.processCount), isComplete: resources.isComplete === true,
    },
    backlog: value.backlog === undefined ? 0 : number(value.backlog),
    dropped: value.dropped === undefined ? 0 : number(value.dropped),
    sampledAt: value.sampledAt === undefined ? undefined : text(value.sampledAt),
  };
}

export function readCrawlerMetrics(value: unknown): AmazonCrawlerMetrics {
  const payload = record(value);
  const counts = record(payload.counts);
  const rates = record(payload.rates);
  const queue = record(payload.queue);
  const scheduler = payload.scheduler === undefined ? undefined : record(payload.scheduler);
  if (!Array.isArray(payload.agents) || payload.agents.length > 100) throw new TypeError("Invalid crawler metrics response.");
  return {
    windowStartedAt: text(payload.windowStartedAt), retainedSince: payload.retainedSince === null ? null : text(payload.retainedSince),
    sampledAt: text(payload.sampledAt), jobId: payload.jobId === null ? null : text(payload.jobId),
    counts: {
      familyCacheHits: number(counts.familyCacheHits), familyCacheMisses: number(counts.familyCacheMisses),
      httpAttempts: number(counts.httpAttempts), httpSuccesses: number(counts.httpSuccesses), browserAttempts: number(counts.browserAttempts),
      pageFetches: number(counts.pageFetches), playwrightFallbacks: number(counts.playwrightFallbacks), captchaAttempts: number(counts.captchaAttempts),
      familyAttempts: number(counts.familyAttempts), partialFamilies: number(counts.partialFamilies), parserFailures: number(counts.parserFailures),
      networkRetries: number(counts.networkRetries), taskRetries: number(counts.taskRetries), retryCount: number(counts.retryCount),
    },
    rates: { cacheHit: rate(rates.cacheHit), httpSuccess: rate(rates.httpSuccess), playwrightFallback: rate(rates.playwrightFallback), captcha: rate(rates.captcha) },
    averageCrawlDurationMs: payload.averageCrawlDurationMs === null ? null : number(payload.averageCrawlDurationMs),
    queue: { crawl: number(queue.crawl), crawlActive: number(queue.crawlActive), pipeline: number(queue.pipeline) },
    scheduler: scheduler ? {
      activeAgents: number(scheduler.activeAgents), queuedTasks: number(scheduler.queuedTasks),
      oldestQueuedAgeSeconds: number(scheduler.oldestQueuedAgeSeconds), totalCapacity: number(scheduler.totalCapacity),
      activeTasks: number(scheduler.activeTasks), availableCapacity: number(scheduler.availableCapacity),
      capacityUtilization: rate(scheduler.capacityUtilization), overCapacityAgents: number(scheduler.overCapacityAgents),
      completedTasks24hSpread: number(scheduler.completedTasks24hSpread),
    } : undefined,
    agents: payload.agents.map((value) => {
      const agent = record(value);
      return { ...agentObservability(agent), agentId: text(agent.agentId), displayName: text(agent.displayName),
        agentGroup: agent.agentGroup === undefined ? undefined : text(agent.agentGroup),
        activeTasks: optionalNumber(agent.activeTasks), maxConcurrentInputs: optionalNumber(agent.maxConcurrentInputs),
        availableCapacity: optionalNumber(agent.availableCapacity), overCapacity: agent.overCapacity === true,
        completedTasks24h: optionalNumber(agent.completedTasks24h),
        averageTaskDurationMs24h: agent.averageTaskDurationMs24h === null ? null : optionalNumber(agent.averageTaskDurationMs24h) };
    }),
  };
}

export function readCrawlerTrace(value: unknown): AmazonCrawlerTracePage {
  const page = record(value);
  if (!Array.isArray(page.events) || page.events.length > 100) throw new TypeError("Invalid crawler trace response.");
  return {
    nextCursor: page.nextCursor === null ? null : text(page.nextCursor),
    events: page.events.map((value): AmazonCrawlerTraceEvent => {
      const event = record(value);
      const optionalText = (value: unknown): string | undefined => value === undefined || value === null ? undefined : text(value);
      return {
        eventId: text(event.eventId), event: text(event.event), timestamp: text(event.timestamp),
        requestId: text(event.requestId), familyRequestId: text(event.familyRequestId), jobId: text(event.jobId),
        taskId: text(event.taskId), agentId: text(event.agentId), asin: text(event.asin), result: text(event.result),
        stage: optionalText(event.stage), route: optionalText(event.route), profile: optionalText(event.profile),
        cacheKey: optionalText(event.cacheKey), error: optionalText(event.error), attempt: optionalNumber(event.attempt),
        taskAttempt: optionalNumber(event.taskAttempt), durationMs: optionalNumber(event.durationMs),
      };
    }),
  };
}
