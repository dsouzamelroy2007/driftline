// Web Crypto only (crypto.subtle) — no crypto dependency, works identically in the browser and in
// Node >=22 (this repo's minimum), and carries forward cleanly to Expo/React Native in Phase 10
// (expo-crypto exposes the same SubtleCrypto surface). PBKDF2-SHA256 -> AES-256-GCM, matching
// current OWASP guidance for a passphrase-derived key with no server-side involvement at all
// (docs/ADR/0007-backup-format.md) — the server never sees the passphrase, the plaintext, or the key.
const PBKDF2_ITERATIONS = 600_000;

export interface EncryptedEnvelope {
  version: 1;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  iv: string;
  ciphertext: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const passphraseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    passphraseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptWithPassphrase(plaintext: string, passphrase: string): Promise<EncryptedEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);

  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, new TextEncoder().encode(plaintext));

  return {
    version: 1,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: PBKDF2_ITERATIONS, salt: bytesToBase64(salt) },
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

// A wrong passphrase and a tampered/corrupted ciphertext both surface as the same generic error —
// AES-GCM's authentication tag check fails identically either way, and there's no reason to give an
// attacker (or a confused user) a more specific oracle than "this didn't work."
export async function decryptWithPassphrase(envelope: EncryptedEnvelope, passphrase: string): Promise<string> {
  try {
    const salt = base64ToBytes(envelope.kdf.salt);
    const iv = base64ToBytes(envelope.iv);
    const key = await deriveKey(passphrase, salt, envelope.kdf.iterations);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      base64ToBytes(envelope.ciphertext) as BufferSource,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error("Couldn't decrypt backup — check your passphrase.");
  }
}
