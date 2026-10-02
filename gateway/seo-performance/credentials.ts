import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const CONTEXT = Buffer.from("ffp-search-console-refresh-v1");
export function encryptSecret(secret: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(CONTEXT);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(bytes => bytes.toString("base64url")).join(".");
}
export function decryptSecret(encrypted: string, key: Buffer): string {
  const parts = encrypted.split(".").map(part => Buffer.from(part, "base64url"));
  if (parts.length !== 3) throw new Error("INVALID_ENCRYPTED_CREDENTIAL");
  const [iv, tag, ciphertext] = parts;
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(CONTEXT);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
