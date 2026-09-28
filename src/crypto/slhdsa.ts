import { slh_dsa_sha2_128f } from "@noble/post-quantum/slh-dsa.js";

// FIPS 205 (SLH-DSA) — signatures hash-based post-quantiques pour QxCloudSync.
// Jeu choisi : SHA2-128f (catégorie NIST 1, signature 17088 o, ~70 ms en JS).
// La variante 128s (7856 o) signe en ~1,3 s : inadaptée même pour un handshake.
// Usage réservé à l'authentification d'identité (hellos, rares) : les données
// de session reposent sur AES-256-GCM (PQ par construction, cf. 09).

export const SLHDSA_ALG = "SLH-DSA-SHA2-128f";
export const SLHDSA_PK_BYTES = 32;
export const SLHDSA_SK_BYTES = 64;
export const SLHDSA_SIG_BYTES = 17088;

export interface SlhDsaKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/** Génère une paire SLH-DSA (entropie OS, keygen ~20 ms). */
export function generateSlhDsaKeyPair(): SlhDsaKeyPair {
  const { publicKey, secretKey } = slh_dsa_sha2_128f.keygen();
  return { publicKey: new Uint8Array(publicKey), secretKey: new Uint8Array(secretKey) };
}

/** Signe `message` avec la clé secrète SLH-DSA. */
export function signSlhDsa(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return new Uint8Array(slh_dsa_sha2_128f.sign(message, secretKey));
}

/** Vérifie une signature SLH-DSA. Retourne false au lieu de lever. */
export function verifySlhDsa(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  try {
    if (signature.length !== SLHDSA_SIG_BYTES || publicKey.length !== SLHDSA_PK_BYTES) return false;
    return slh_dsa_sha2_128f.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}
