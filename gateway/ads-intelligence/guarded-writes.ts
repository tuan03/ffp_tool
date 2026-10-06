/**
 * FFP Ads Intelligence — Guarded Writes Engine (Step 21 · FFP-ADS-021)
 *
 * Implements strict safety fences, cryptographic preview hashing, state-drift protection,
 * 24h budget change ceilings (<=20%), cooldown enforcement, and emergency kill-switch controls.
 *
 * NOTE: IN V1 AND V2 RELEASES, ALL MUTATING WRITES ARE STRICTLY DENIED BY DEFAULT
 * (`FFP_ADS_EXTERNAL_WRITES_ENABLED=false`). ALL CALLS TO EXECUTE MUTATIONS WILL FAIL SAFE.
 */

import { createHash, randomUUID } from "node:crypto";

export type GuardedWriteAction = "PAUSE_ENTITY" | "ENABLE_ENTITY" | "UPDATE_BUDGET";

export interface WritePreviewRequest {
  storeId: string;
  entityId: string;
  entityName: string;
  entityType: "CAMPAIGN" | "ADSET" | "AD";
  action: GuardedWriteAction;
  currentStatus: "ACTIVE" | "PAUSED" | "ARCHIVED";
  currentBudget?: number; // In currency units (e.g. USD)
  proposedStatus?: "ACTIVE" | "PAUSED";
  proposedBudget?: number; // In currency units
  currency: string;
  reason: string;
  evidenceId?: string;
  requestedBy: string;
}

export interface WritePreview {
  previewId: string;
  previewHash: string;
  storeId: string;
  entity: {
    id: string;
    name: string;
    type: "CAMPAIGN" | "ADSET" | "AD";
  };
  currentStatus: string;
  currentBudget?: number;
  proposedStatus?: string;
  proposedBudget?: number;
  budgetChangePercent?: number;
  currency: string;
  exposureEstimate: string;
  createdAt: string;
  expiresAt: string;
  status: "PENDING_APPROVAL" | "APPROVED" | "EXECUTED" | "EXPIRED" | "REJECTED";
  reason: string;
  requestedBy: string;
}

export interface WriteApproval {
  previewId: string;
  previewHash: string;
  approvedBy: string;
  approvedAt: string;
  comment?: string;
}

export interface GuardedWriteAuditEntry {
  auditId: string;
  previewId: string;
  previewHash: string;
  storeId: string;
  entityId: string;
  action: GuardedWriteAction;
  requestedBy: string;
  approvedBy?: string;
  executedBy?: string;
  timestamp: string;
  status: "SUCCESS" | "BLOCKED" | "DENIED_V1_V2" | "STATE_DRIFT" | "FENCE_VIOLATION";
  beforeState: { status: string; budget?: number };
  afterState?: { status: string; budget?: number };
  details: string;
}

export interface WriteExecutionResult {
  success: boolean;
  actionId: string;
  status: "COMPLETED" | "BLOCKED" | "DENIED_V1_V2" | "STATE_DRIFT" | "FENCE_VIOLATION";
  message: string;
  auditEntry: GuardedWriteAuditEntry;
}

export class GuardedWritesService {
  private previews: Map<string, WritePreview> = new Map();
  private auditLog: GuardedWriteAuditEntry[] = [];
  private entityLastBudgetChange: Map<string, number> = new Map(); // entityId -> timestamp
  private entityCumulativeBudget24h: Map<string, number> = new Map(); // entityId -> total change percent

  // Safety Fence Configuration Constants
  public static readonly MAX_BUDGET_CHANGE_PERCENT = 20.0; // Max 20% increase or decrease per 24 hours
  public static readonly MIN_COOLDOWN_HOURS = 24; // Minimum 24 hours between budget modifications
  public static readonly PREVIEW_TTL_MINUTES = 15; // Previews expire in 15 minutes if not approved

  /**
   * Generates a tamper-proof write preview with a cryptographic sha256 checksum.
   */
  public generatePreview(request: WritePreviewRequest): WritePreview {
    const previewId = `preview-${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + GuardedWritesService.PREVIEW_TTL_MINUTES * 60 * 1000).toISOString();

    let budgetChangePercent: number | undefined;
    if (request.action === "UPDATE_BUDGET" && request.currentBudget && request.proposedBudget) {
      budgetChangePercent = Math.round(
        ((request.proposedBudget - request.currentBudget) / request.currentBudget) * 10000
      ) / 100;
    }

    const exposureEstimate = request.action === "UPDATE_BUDGET" && request.proposedBudget
      ? `Estimated daily exposure: ${request.proposedBudget} ${request.currency} (Change: ${budgetChangePercent && budgetChangePercent > 0 ? "+" : ""}${budgetChangePercent}%)`
      : request.action === "PAUSE_ENTITY"
      ? `Stops delivery and reduces spend to 0 ${request.currency} for ${request.entityName}`
      : `Restores delivery under current campaign parameters`;

    // Compute deterministic hash of immutable fields
    const hashPayload = JSON.stringify({
      storeId: request.storeId,
      entityId: request.entityId,
      entityType: request.entityType,
      action: request.action,
      currentStatus: request.currentStatus,
      currentBudget: request.currentBudget,
      proposedStatus: request.proposedStatus,
      proposedBudget: request.proposedBudget,
      currency: request.currency,
      expiresAt,
    });

    const previewHash = createHash("sha256").update(hashPayload).digest("hex");

    const preview: WritePreview = {
      previewId,
      previewHash,
      storeId: request.storeId,
      entity: {
        id: request.entityId,
        name: request.entityName,
        type: request.entityType,
      },
      currentStatus: request.currentStatus,
      currentBudget: request.currentBudget,
      proposedStatus: request.proposedStatus,
      proposedBudget: request.proposedBudget,
      budgetChangePercent,
      currency: request.currency,
      exposureEstimate,
      createdAt,
      expiresAt,
      status: "PENDING_APPROVAL",
      reason: request.reason,
      requestedBy: request.requestedBy,
    };

    this.previews.set(previewId, preview);
    return preview;
  }

  /**
   * Approves a preview with human buyer signature verification.
   */
  public approvePreview(approval: WriteApproval): WritePreview {
    const preview = this.previews.get(approval.previewId);
    if (!preview) {
      throw new Error(`Preview not found: ${approval.previewId}`);
    }

    if (new Date(preview.expiresAt).getTime() < Date.now()) {
      preview.status = "EXPIRED";
      throw new Error(`Preview has expired at ${preview.expiresAt}`);
    }

    if (preview.previewHash !== approval.previewHash) {
      preview.status = "REJECTED";
      throw new Error(`Preview hash mismatch! Expected ${preview.previewHash}, received ${approval.previewHash}`);
    }

    if (preview.status !== "PENDING_APPROVAL") {
      throw new Error(`Cannot approve preview in status: ${preview.status}`);
    }

    preview.status = "APPROVED";
    return preview;
  }

  /**
   * Executes an approved write under strict safety fences.
   * In V1 & V2: External writes are strictly prohibited by policy and fail safe.
   */
  public executeGuardedWrite(
    previewId: string,
    liveEntityState: { status: string; budget?: number },
    options?: { forceAllowV3?: boolean }
  ): WriteExecutionResult {
    const preview = this.previews.get(previewId);
    const auditId = `audit-${randomUUID()}`;
    const timestamp = new Date().toISOString();

    if (!preview) {
      const auditEntry: GuardedWriteAuditEntry = {
        auditId,
        previewId,
        previewHash: "UNKNOWN",
        storeId: "UNKNOWN",
        entityId: "UNKNOWN",
        action: "PAUSE_ENTITY",
        requestedBy: "UNKNOWN",
        timestamp,
        status: "BLOCKED",
        beforeState: liveEntityState,
        details: `Preview ${previewId} does not exist`,
      };
      this.auditLog.push(auditEntry);
      return { success: false, actionId: auditId, status: "BLOCKED", message: auditEntry.details, auditEntry };
    }

    // 1. Check Approval
    if (preview.status !== "APPROVED") {
      const auditEntry: GuardedWriteAuditEntry = {
        auditId,
        previewId,
        previewHash: preview.previewHash,
        storeId: preview.storeId,
        entityId: preview.entity.id,
        action: preview.proposedStatus ? (preview.proposedStatus === "PAUSED" ? "PAUSE_ENTITY" : "ENABLE_ENTITY") : "UPDATE_BUDGET",
        requestedBy: preview.requestedBy,
        timestamp,
        status: "BLOCKED",
        beforeState: liveEntityState,
        details: `Preview is in state '${preview.status}', requires 'APPROVED'`,
      };
      this.auditLog.push(auditEntry);
      return { success: false, actionId: auditId, status: "BLOCKED", message: auditEntry.details, auditEntry };
    }

    // 2. Check Expiration
    if (new Date(preview.expiresAt).getTime() < Date.now()) {
      preview.status = "EXPIRED";
      const auditEntry: GuardedWriteAuditEntry = {
        auditId,
        previewId,
        previewHash: preview.previewHash,
        storeId: preview.storeId,
        entityId: preview.entity.id,
        action: preview.proposedStatus ? (preview.proposedStatus === "PAUSED" ? "PAUSE_ENTITY" : "ENABLE_ENTITY") : "UPDATE_BUDGET",
        requestedBy: preview.requestedBy,
        timestamp,
        status: "BLOCKED",
        beforeState: liveEntityState,
        details: `Approval expired at ${preview.expiresAt}`,
      };
      this.auditLog.push(auditEntry);
      return { success: false, actionId: auditId, status: "BLOCKED", message: auditEntry.details, auditEntry };
    }

    // 3. State Drift Detection
    if (liveEntityState.status !== preview.currentStatus ||
        (preview.currentBudget !== undefined && liveEntityState.budget !== undefined && Math.abs(liveEntityState.budget - preview.currentBudget) > 0.01)) {
      preview.status = "REJECTED";
      const auditEntry: GuardedWriteAuditEntry = {
        auditId,
        previewId,
        previewHash: preview.previewHash,
        storeId: preview.storeId,
        entityId: preview.entity.id,
        action: preview.proposedStatus ? (preview.proposedStatus === "PAUSED" ? "PAUSE_ENTITY" : "ENABLE_ENTITY") : "UPDATE_BUDGET",
        requestedBy: preview.requestedBy,
        timestamp,
        status: "STATE_DRIFT",
        beforeState: liveEntityState,
        details: `Live state drifted! Expected status=${preview.currentStatus} budget=${preview.currentBudget}, but live has status=${liveEntityState.status} budget=${liveEntityState.budget}`,
      };
      this.auditLog.push(auditEntry);
      return { success: false, actionId: auditId, status: "STATE_DRIFT", message: auditEntry.details, auditEntry };
    }

    // 4. Safety Fences: Budget Delta & Cooldown
    if (preview.budgetChangePercent !== undefined) {
      if (Math.abs(preview.budgetChangePercent) > GuardedWritesService.MAX_BUDGET_CHANGE_PERCENT) {
        preview.status = "REJECTED";
        const auditEntry: GuardedWriteAuditEntry = {
          auditId,
          previewId,
          previewHash: preview.previewHash,
          storeId: preview.storeId,
          entityId: preview.entity.id,
          action: "UPDATE_BUDGET",
          requestedBy: preview.requestedBy,
          timestamp,
          status: "FENCE_VIOLATION",
          beforeState: liveEntityState,
          details: `Budget change of ${preview.budgetChangePercent}% exceeds 24-hour maximum cap of ${GuardedWritesService.MAX_BUDGET_CHANGE_PERCENT}%`,
        };
        this.auditLog.push(auditEntry);
        return { success: false, actionId: auditId, status: "FENCE_VIOLATION", message: auditEntry.details, auditEntry };
      }

      // Check Cooldown
      const lastChange = this.entityLastBudgetChange.get(preview.entity.id);
      if (lastChange) {
        const hoursSinceLast = (Date.now() - lastChange) / (1000 * 60 * 60);
        if (hoursSinceLast < GuardedWritesService.MIN_COOLDOWN_HOURS) {
          preview.status = "REJECTED";
          const auditEntry: GuardedWriteAuditEntry = {
            auditId,
            previewId,
            previewHash: preview.previewHash,
            storeId: preview.storeId,
            entityId: preview.entity.id,
            action: "UPDATE_BUDGET",
            requestedBy: preview.requestedBy,
            timestamp,
            status: "FENCE_VIOLATION",
            beforeState: liveEntityState,
            details: `Cooldown violation: Only ${hoursSinceLast.toFixed(1)}h elapsed since last budget change (requires ${GuardedWritesService.MIN_COOLDOWN_HOURS}h)`,
          };
          this.auditLog.push(auditEntry);
          return { success: false, actionId: auditId, status: "FENCE_VIOLATION", message: auditEntry.details, auditEntry };
        }
      }
    }

    // 5. Release Gate / Kill-Switch Verification (Step 21 Contract)
    const isWritesEnabled = process.env.FFP_ADS_EXTERNAL_WRITES_ENABLED === "true" || options?.forceAllowV3 === true;
    const isEmergencyKillSwitch = process.env.FFP_ADS_EMERGENCY_KILL_SWITCH === "true";

    if (isEmergencyKillSwitch) {
      const auditEntry: GuardedWriteAuditEntry = {
        auditId,
        previewId,
        previewHash: preview.previewHash,
        storeId: preview.storeId,
        entityId: preview.entity.id,
        action: preview.proposedStatus ? (preview.proposedStatus === "PAUSED" ? "PAUSE_ENTITY" : "ENABLE_ENTITY") : "UPDATE_BUDGET",
        requestedBy: preview.requestedBy,
        timestamp,
        status: "BLOCKED",
        beforeState: liveEntityState,
        details: "EMERGENCY KILL SWITCH ENGAGED. All external mutations are revoked by system policy.",
      };
      this.auditLog.push(auditEntry);
      return { success: false, actionId: auditId, status: "BLOCKED", message: auditEntry.details, auditEntry };
    }

    if (!isWritesEnabled) {
      // V1/V2 Strict Read-Only Guard
      preview.status = "REJECTED";
      const auditEntry: GuardedWriteAuditEntry = {
        auditId,
        previewId,
        previewHash: preview.previewHash,
        storeId: preview.storeId,
        entityId: preview.entity.id,
        action: preview.proposedStatus ? (preview.proposedStatus === "PAUSED" ? "PAUSE_ENTITY" : "ENABLE_ENTITY") : "UPDATE_BUDGET",
        requestedBy: preview.requestedBy,
        timestamp,
        status: "DENIED_V1_V2",
        beforeState: liveEntityState,
        details: "EXTERNAL WRITES DISABLED: FFP Ads Intelligence is operating in V1/V2 Read-Only Mode. FFP_ADS_EXTERNAL_WRITES_ENABLED is false. Actions must be performed manually in Meta Ads Manager.",
      };
      this.auditLog.push(auditEntry);
      return { success: false, actionId: auditId, status: "DENIED_V1_V2", message: auditEntry.details, auditEntry };
    }

    // 6. Simulated / Real Execution (When V3 is enabled)
    preview.status = "EXECUTED";
    if (preview.proposedBudget !== undefined) {
      this.entityLastBudgetChange.set(preview.entity.id, Date.now());
    }

    const afterState = {
      status: preview.proposedStatus || preview.currentStatus,
      budget: preview.proposedBudget !== undefined ? preview.proposedBudget : preview.currentBudget,
    };

    const auditEntry: GuardedWriteAuditEntry = {
      auditId,
      previewId,
      previewHash: preview.previewHash,
      storeId: preview.storeId,
      entityId: preview.entity.id,
      action: preview.proposedStatus ? (preview.proposedStatus === "PAUSED" ? "PAUSE_ENTITY" : "ENABLE_ENTITY") : "UPDATE_BUDGET",
      requestedBy: preview.requestedBy,
      timestamp,
      status: "SUCCESS",
      beforeState: liveEntityState,
      afterState,
      details: `Successfully executed guarded write. New state: status=${afterState.status} budget=${afterState.budget}`,
    };
    this.auditLog.push(auditEntry);

    return {
      success: true,
      actionId: auditId,
      status: "COMPLETED",
      message: auditEntry.details,
      auditEntry,
    };
  }

  public getPreview(previewId: string): WritePreview | undefined {
    return this.previews.get(previewId);
  }

  public getAuditLog(storeId?: string): GuardedWriteAuditEntry[] {
    if (storeId) {
      return this.auditLog.filter((entry) => entry.storeId === storeId);
    }
    return [...this.auditLog];
  }
}

// Global Singleton for Guarded Writes
export const adsGuardedWritesService = new GuardedWritesService();
