/**
 * FFP Ads Intelligence — MCP User Token & Audit Management
 * Provides user identity, store-level RBAC, and usage auditing for external MCP connections.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";

export interface McpUserToken {
  readonly id: string;
  readonly name: string;
  readonly token: string;
  readonly allowedStores: readonly string[]; // ["*"] for all stores, or specific storeIds
  readonly role: "admin" | "media_buyer" | "viewer";
  readonly createdAt: string;
  lastUsedAt?: string | null;
  status: "ACTIVE" | "REVOKED";
}

export interface McpAuditLog {
  readonly id: string;
  readonly timestamp: string;
  readonly userId: string;
  readonly userName: string;
  readonly toolName: string;
  readonly storeId?: string;
  readonly success: boolean;
  readonly error?: string;
}

export class McpUserManager {
  private users: McpUserToken[] = [];
  private auditLogs: McpAuditLog[] = [];
  private readonly storageDir: string;
  private readonly usersFile: string;
  private readonly auditFile: string;
  private initialized = false;

  constructor(customStorageDir?: string) {
    this.storageDir = customStorageDir
      ? resolve(customStorageDir)
      : resolve(process.cwd(), ".local-data");
    this.usersFile = resolve(this.storageDir, "ads-mcp-users.json");
    this.auditFile = resolve(this.storageDir, "ads-mcp-audit.json");
  }

  private init(): void {
    if (this.initialized) return;
    this.initialized = true;

    try {
      if (!existsSync(this.storageDir)) {
        mkdirSync(this.storageDir, { recursive: true });
      }

      if (existsSync(this.usersFile)) {
        const raw = readFileSync(this.usersFile, "utf-8");
        this.users = JSON.parse(raw);
      } else {
        this.users = [];
      }

      if (existsSync(this.auditFile)) {
        const raw = readFileSync(this.auditFile, "utf-8");
        this.auditLogs = JSON.parse(raw);
      } else {
        this.auditLogs = [];
      }
    } catch (err) {
      console.warn("[McpUserManager] Error initializing storage, starting with empty state:", err);
      this.users = [];
      this.auditLogs = [];
    }
  }

  private persistUsers(): void {
    try {
      if (!existsSync(this.storageDir)) {
        mkdirSync(this.storageDir, { recursive: true });
      }
      writeFileSync(this.usersFile, JSON.stringify(this.users, null, 2), "utf-8");
    } catch (err) {
      console.error("[McpUserManager] Failed to persist users:", err);
    }
  }

  private persistAudit(): void {
    try {
      if (!existsSync(this.storageDir)) {
        mkdirSync(this.storageDir, { recursive: true });
      }
      // Keep last 1000 audit records
      if (this.auditLogs.length > 1000) {
        this.auditLogs = this.auditLogs.slice(-1000);
      }
      writeFileSync(this.auditFile, JSON.stringify(this.auditLogs, null, 2), "utf-8");
    } catch (err) {
      console.error("[McpUserManager] Failed to persist audit logs:", err);
    }
  }

  listUsers(): readonly McpUserToken[] {
    this.init();
    return [...this.users];
  }

  createUser(
    name: string,
    allowedStores: readonly string[],
    role: "admin" | "media_buyer" | "viewer" = "media_buyer",
  ): McpUserToken {
    this.init();
    const cleanName = name.trim() || "User";
    const slug = cleanName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .slice(0, 15)
      .replace(/-+$/, "");
    const randomSuffix = randomBytes(8).toString("hex");
    const token = `ffp_pat_${slug || "mcp"}_${randomSuffix}`;

    const newUser: McpUserToken = {
      id: `usr_${randomUUID()}`,
      name: cleanName,
      token,
      allowedStores: allowedStores.length === 0 ? ["*"] : allowedStores,
      role,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      status: "ACTIVE",
    };

    this.users.unshift(newUser);
    this.persistUsers();
    return newUser;
  }

  revokeUser(idOrToken: string): boolean {
    this.init();
    const user = this.users.find((u) => u.id === idOrToken || u.token === idOrToken);
    if (!user) return false;
    user.status = user.status === "ACTIVE" ? "REVOKED" : "ACTIVE";
    this.persistUsers();
    return true;
  }

  deleteUser(id: string): boolean {
    this.init();
    const initialLen = this.users.length;
    this.users = this.users.filter((u) => u.id !== id);
    if (this.users.length !== initialLen) {
      this.persistUsers();
      return true;
    }
    return false;
  }

  findUserByToken(token: string): McpUserToken | null {
    this.init();
    const cleanToken = token.trim();
    const user = this.users.find((u) => u.token === cleanToken);
    if (!user) return null;
    return user;
  }

  recordUsage(
    token: string,
    toolName: string,
    storeId?: string,
    success = true,
    error?: string,
  ): void {
    this.init();
    const user = this.findUserByToken(token);
    const nowIso = new Date().toISOString();

    if (user) {
      user.lastUsedAt = nowIso;
      this.persistUsers();
    }

    const log: McpAuditLog = {
      id: `aud_${randomUUID()}`,
      timestamp: nowIso,
      userId: user?.id || "master_admin",
      userName: user?.name || "Super Admin",
      toolName,
      storeId,
      success,
      error,
    };

    this.auditLogs.unshift(log);
    this.persistAudit();
  }

  getAuditLogs(limit = 100): readonly McpAuditLog[] {
    this.init();
    return this.auditLogs.slice(0, limit);
  }
}

export const mcpUserManager = new McpUserManager();
