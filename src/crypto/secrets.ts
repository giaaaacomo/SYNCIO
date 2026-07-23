const ENCRYPTION_VERSION = 1;
const AES_GCM_IV_BYTES = 12;

export interface EncryptedSecret {
  value: string;
  encryptionVersion: typeof ENCRYPTION_VERSION;
}

export async function encryptSecret(plainText: string, keyMaterial: string, context: string): Promise<EncryptedSecret> {
  if (plainText.length === 0) throw new Error("plainText must be non-empty.");
  const key = await importAesKey(keyMaterial);
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: arrayBuffer(iv), additionalData: arrayBuffer(encode(context)) },
    key,
    arrayBuffer(encode(plainText))
  );

  return {
    value: `v1.${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(cipherBuffer))}`,
    encryptionVersion: ENCRYPTION_VERSION
  };
}

export async function decryptSecret(cipherText: string, keyMaterial: string, context: string): Promise<string> {
  const parsed = parseEncryptedSecret(cipherText);
  const key = await importAesKey(keyMaterial);
  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: arrayBuffer(parsed.iv), additionalData: arrayBuffer(encode(context)) },
    key,
    arrayBuffer(parsed.cipherText)
  );
  return new TextDecoder().decode(plainBuffer);
}

function parseEncryptedSecret(value: string): { iv: Uint8Array; cipherText: Uint8Array } {
  const [version, iv, cipherText] = value.split(".");
  if (version !== "v1" || !iv || !cipherText) throw new Error("Unsupported encrypted secret format.");
  return {
    iv: base64UrlDecode(iv),
    cipherText: base64UrlDecode(cipherText)
  };
}

async function importAesKey(keyMaterial: string): Promise<CryptoKey> {
  const raw = decodeKeyMaterial(keyMaterial);
  if (raw.byteLength !== 32) throw new Error("SYNCIO_ENCRYPTION_KEY must decode to 32 bytes.");
  return crypto.subtle.importKey("raw", arrayBuffer(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

function decodeKeyMaterial(value: string): Uint8Array {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error("SYNCIO_ENCRYPTION_KEY is empty.");
  return base64UrlDecode(normalized);
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
