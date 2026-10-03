import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encryption for provider API keys entered on the instructor's settings page (FR-9.7, ADR-020).
 * AES-256-GCM with SETTINGS_ENCRYPTION_KEY (32 bytes, base64), a random 12-byte IV per write,
 * and associated data that binds the ciphertext to its row, so a ciphertext copied into another
 * row does not decrypt. Format: `v1.<keyId>.<iv>.<tag>.<ciphertext>` (base64url parts).
 * The key id (first 8 hex chars of sha256(key)) tells a rotated key apart from a wrong one.
 */

const VERSION = "v1";

export class SecretsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretsError";
  }
}

function keyBytes(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) throw new SecretsError("SETTINGS_ENCRYPTION_KEY must decode to 32 bytes");
  return key;
}

export const encryptionKeyId = (base64Key: string) =>
  createHash("sha256").update(keyBytes(base64Key)).digest("hex").slice(0, 8);

export function encryptSecret(
  plaintext: string,
  base64Key: string,
  associatedData: string,
): string {
  const key = keyBytes(base64Key);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    encryptionKeyId(base64Key),
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSecret(sealed: string, base64Key: string, associatedData: string): string {
  const [version, keyId, iv, tag, ciphertext] = sealed.split(".");
  if (version !== VERSION || !keyId || !iv || !tag || ciphertext === undefined) {
    throw new SecretsError("Unrecognised secret format");
  }
  if (keyId !== encryptionKeyId(base64Key)) {
    throw new SecretsError(
      "Secret was encrypted with a different SETTINGS_ENCRYPTION_KEY (rotated key?)",
    );
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      keyBytes(base64Key),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAAD(Buffer.from(associatedData, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new SecretsError("Secret could not be decrypted (tampered or bound to another row)");
  }
}
