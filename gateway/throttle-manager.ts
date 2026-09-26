import type { GraphQLCostExtension } from "./types";

export interface StoreThrottleState {
  currentlyAvailable: number;
  maximumAvailable: number;
  restoreRate: number;
  blockedUntilMs: number;
}

export interface ThrottleCheckResult {
  readonly isThrottled: boolean;
  readonly retryAfterMs: number;
}

export interface ThrottleManager {
  check(storeId: string): ThrottleCheckResult;
  recordCost(storeId: string, cost?: GraphQLCostExtension): void;
  recordThrottled(storeId: string, retryAfterSeconds?: number): void;
  recordHttp429(storeId: string, retryAfterSeconds?: number): void;
  reset(storeId?: string): void;
}

export class InMemoryThrottleManager implements ThrottleManager {
  private readonly states = new Map<string, StoreThrottleState>();
  private readonly clock: () => number;

  public constructor(clock: () => number = Date.now) {
    this.clock = clock;
  }

  public check(storeId: string): ThrottleCheckResult {
    const state = this.states.get(storeId);
    if (!state) {
      return { isThrottled: false, retryAfterMs: 0 };
    }
    const now = this.clock();
    if (state.blockedUntilMs > now) {
      return { isThrottled: true, retryAfterMs: state.blockedUntilMs - now };
    }
    return { isThrottled: false, retryAfterMs: 0 };
  }

  public recordCost(storeId: string, cost?: GraphQLCostExtension): void {
    if (!cost) return;
    const now = this.clock();
    const current = this.states.get(storeId) ?? {
      currentlyAvailable: 1000,
      maximumAvailable: 1000,
      restoreRate: 50,
      blockedUntilMs: 0,
    };

    if (cost.throttleStatus) {
      current.currentlyAvailable = cost.throttleStatus.currentlyAvailable;
      current.maximumAvailable = cost.throttleStatus.maximumAvailable;
      current.restoreRate = cost.throttleStatus.restoreRate;
    }

    if (cost.requestedQueryCost !== undefined && current.currentlyAvailable < cost.requestedQueryCost) {
      const deficit = cost.requestedQueryCost - current.currentlyAvailable;
      const waitSeconds = Math.max(1, Math.ceil(deficit / Math.max(current.restoreRate, 1)));
      current.blockedUntilMs = Math.max(current.blockedUntilMs, now + waitSeconds * 1000);
    }

    this.states.set(storeId, current);
  }

  public recordThrottled(storeId: string, retryAfterSeconds = 2): void {
    const now = this.clock();
    const current = this.states.get(storeId) ?? {
      currentlyAvailable: 0,
      maximumAvailable: 1000,
      restoreRate: 50,
      blockedUntilMs: 0,
    };
    current.currentlyAvailable = 0;
    current.blockedUntilMs = now + Math.max(1, retryAfterSeconds) * 1000;
    this.states.set(storeId, current);
  }

  public recordHttp429(storeId: string, retryAfterSeconds = 2): void {
    this.recordThrottled(storeId, retryAfterSeconds);
  }

  public reset(storeId?: string): void {
    if (storeId) {
      this.states.delete(storeId);
    } else {
      this.states.clear();
    }
  }
}
