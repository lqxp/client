import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";

// Tailles FIPS 203 pour ML-KEM-768.
export const MLKEM768_EK_BYTES = 1184;
export const MLKEM768_CT_BYTES = 1088;

export interface PqcPublicKey {
  keyId: string;
  ekHex: string; // 1184 octets hexadécimaux
}

export interface PqcCiphertext {
  keyId: string;
  ctHex: string; // 1088 octets hexadécimaux
}

export interface PqcEncapsulationResult {
  ciphertext: PqcCiphertext;
  sharedSecretHex: string;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function hexToBytes(value: string): Uint8Array {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]*$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error("Invalid hex payload.");
  }
  const out = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Encapsule un secret partagé vers la clé d'encapsulation ML-KEM-768 (FIPS 203)
 * renvoyée par le serveur. Délègue le KEM à `@noble/post-quantum` (implémentation
 * auditée) — aucune dérivation polynomiale maison.
 */
export async function encapsulatePqcSecret(
  pk: PqcPublicKey,
): Promise<PqcEncapsulationResult> {
  if (!pk?.keyId || typeof pk?.ekHex !== "string") {
    throw new Error("Malformed Post-Quantum public key.");
  }

  const ek = hexToBytes(pk.ekHex);
  if (ek.length !== MLKEM768_EK_BYTES) {
    throw new Error("Unexpected ML-KEM-768 encapsulation key length.");
  }

  const { cipherText, sharedSecret } = ml_kem768.encapsulate(ek);

  return {
    ciphertext: {
      keyId: pk.keyId,
      ctHex: bytesToHex(cipherText),
    },
    sharedSecretHex: bytesToHex(sharedSecret),
  };
}
