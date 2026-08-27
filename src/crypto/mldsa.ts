import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";

export interface MlDsaKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/**
 * Génère une paire de clés ML-DSA-65 (FIPS 204). Un `seed` optionnel rend la
 * génération déterministe (utile pour les vecteurs de test).
 */
export function generateMlDsa65KeyPair(seed?: Uint8Array): MlDsaKeyPair {
  const { publicKey, secretKey } = seed
    ? ml_dsa65.keygen(seed)
    : ml_dsa65.keygen();
  return { publicKey, secretKey };
}

/** Signe `message` avec la clé secrète ML-DSA-65. */
export function signMlDsa65(
  message: Uint8Array,
  secretKey: Uint8Array,
): Uint8Array {
  return ml_dsa65.sign(message, secretKey);
}

/** Vérifie une signature ML-DSA-65. */
export function verifyMlDsa65(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  return ml_dsa65.verify(signature, message, publicKey);
}
