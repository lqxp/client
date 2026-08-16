export const PQC_N = 256;
export const PQC_Q = 3329;
export const PQC_HALF_Q = 1665;

export interface PqcPublicKey {
  keyId: string;
  tHex: string;
  rhoHex: string;
}

export interface PqcCiphertext {
  keyId: string;
  uHex: string;
  vHex: string;
}

export interface PqcEncapsulationResult {
  ciphertext: PqcCiphertext;
  sharedSecretHex: string;
}

function polyMul(a: Int32Array, b: Int32Array): Int32Array {
  const out = new Int32Array(PQC_N);
  const temp = new Float64Array(PQC_N);

  for (let i = 0; i < PQC_N; i++) {
    for (let j = 0; j < PQC_N; j++) {
      const term = a[i] * b[j];
      if (i + j < PQC_N) {
        temp[i + j] += term;
      } else {
        temp[i + j - PQC_N] -= term;
      }
    }
  }

  for (let i = 0; i < PQC_N; i++) {
    let val = Math.round(temp[i]) % PQC_Q;
    if (val < 0) val += PQC_Q;
    out[i] = val;
  }
  return out;
}

function polyAdd(a: Int32Array, b: Int32Array): Int32Array {
  const out = new Int32Array(PQC_N);
  for (let i = 0; i < PQC_N; i++) {
    let val = (a[i] + b[i]) % PQC_Q;
    if (val < 0) val += PQC_Q;
    out[i] = val;
  }
  return out;
}

export function hexToPoly(hexStr: string): Int32Array | null {
  if (hexStr.length !== PQC_N * 3) return null;
  const out = new Int32Array(PQC_N);
  for (let i = 0; i < PQC_N; i++) {
    const chunk = hexStr.substring(i * 3, (i + 1) * 3);
    const val = parseInt(chunk, 16);
    if (isNaN(val) || val >= PQC_Q) return null;
    out[i] = val;
  }
  return out;
}

export function polyToHex(p: Int32Array): string {
  let hex = "";
  for (let i = 0; i < PQC_N; i++) {
    hex += p[i].toString(16).padStart(3, "0");
  }
  return hex;
}

async function sampleUniformPoly(seedBytes: Uint8Array, domain: number): Promise<Int32Array> {
  const prefix = new TextEncoder().encode("qxprotocol_pqc_uniform_poly:");
  const header = new Uint8Array(prefix.length + 32 + 1);
  header.set(prefix, 0);
  header.set(seedBytes, prefix.length);
  header[header.length - 1] = domain;

  let digest = new Uint8Array(await crypto.subtle.digest("SHA-256", header));
  const out = new Int32Array(PQC_N);
  let idx = 0;
  let counter = 0;

  while (idx < PQC_N) {
    for (let i = 0; i + 1 < digest.length && idx < PQC_N; i += 2) {
      const val = (digest[i] | (digest[i + 1] << 8)) & 0x0fff;
      if (val < PQC_Q) {
        out[idx++] = val;
      }
    }
    counter++;
    const countBuf = new Uint8Array(4);
    new DataView(countBuf.buffer).setUint32(0, counter, true);
    const roundBuf = new Uint8Array(header.length + 4);
    roundBuf.set(header, 0);
    roundBuf.set(countBuf, header.length);
    digest = new Uint8Array(await crypto.subtle.digest("SHA-256", roundBuf));
  }
  return out;
}

async function sampleCbd2Poly(seedBytes: Uint8Array, domain: number): Promise<Int32Array> {
  const prefix = new TextEncoder().encode("qxprotocol_pqc_cbd2_poly:");
  const header = new Uint8Array(prefix.length + 32 + 1);
  header.set(prefix, 0);
  header.set(seedBytes, prefix.length);
  header[header.length - 1] = domain;

  let digest = new Uint8Array(await crypto.subtle.digest("SHA-256", header));
  const out = new Int32Array(PQC_N);
  let idx = 0;
  let counter = 0;

  while (idx < PQC_N) {
    for (let i = 0; i < digest.length && idx < PQC_N; i++) {
      const byte = digest[i];
      const a = (byte & 0x01) + ((byte >> 1) & 0x01);
      const b = ((byte >> 2) & 0x01) + ((byte >> 3) & 0x01);
      let coeff = (a - b) % PQC_Q;
      if (coeff < 0) coeff += PQC_Q;
      out[idx++] = coeff;

      if (idx >= PQC_N) break;

      const a2 = ((byte >> 4) & 0x01) + ((byte >> 5) & 0x01);
      const b2 = ((byte >> 6) & 0x01) + ((byte >> 7) & 0x01);
      let coeff2 = (a2 - b2) % PQC_Q;
      if (coeff2 < 0) coeff2 += PQC_Q;
      out[idx++] = coeff2;
    }
    counter++;
    const countBuf = new Uint8Array(4);
    new DataView(countBuf.buffer).setUint32(0, counter, true);
    const roundBuf = new Uint8Array(header.length + 4);
    roundBuf.set(header, 0);
    roundBuf.set(countBuf, header.length);
    digest = new Uint8Array(await crypto.subtle.digest("SHA-256", roundBuf));
  }
  return out;
}

export async function encapsulatePqcSecret(pk: PqcPublicKey): Promise<PqcEncapsulationResult> {
  const t = hexToPoly(pk.tHex);
  if (!t) {
    throw new Error("Malformed Post-Quantum Public Key t component");
  }

  const randSeed = new Uint8Array(32);
  crypto.getRandomValues(randSeed);

  const randMsg = new Uint8Array(32);
  crypto.getRandomValues(randMsg);

  const rhoBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    rhoBytes[i] = parseInt(pk.rhoHex.substr(i * 2, 2) || "00", 16) || 0;
  }

  const a = await sampleUniformPoly(rhoBytes, 0);
  const r = await sampleCbd2Poly(randSeed, 0);
  const e1 = await sampleCbd2Poly(randSeed, 1);
  const e2 = await sampleCbd2Poly(randSeed, 2);

  // u = A * r + e1
  const u = polyAdd(polyMul(a, r), e1);

  // mu encoding of 256 bits
  const mu = new Int32Array(PQC_N);
  for (let i = 0; i < PQC_N; i++) {
    const byteIdx = Math.floor(i / 8);
    const bitIdx = i % 8;
    const bit = (randMsg[byteIdx] >> bitIdx) & 1;
    mu[i] = bit ? PQC_HALF_Q : 0;
  }

  // v = t * r + e2 + mu
  const v = polyAdd(polyAdd(polyMul(t, r), e2), mu);

  const uHex = polyToHex(u);
  const vHex = polyToHex(v);

  // Derive quantum-safe shared secret: SHA256(msg || uHex || vHex)
  const ssHasherBuf = new TextEncoder().encode(
    "qxprotocol_pqc_kem_shared_secret:"
  );
  const uBuf = new TextEncoder().encode(uHex);
  const vBuf = new TextEncoder().encode(vHex);

  const totalLen = ssHasherBuf.length + 32 + uBuf.length + vBuf.length;
  const ssPayload = new Uint8Array(totalLen);
  let offset = 0;
  ssPayload.set(ssHasherBuf, offset);
  offset += ssHasherBuf.length;
  ssPayload.set(randMsg, offset);
  offset += 32;
  ssPayload.set(uBuf, offset);
  offset += uBuf.length;
  ssPayload.set(vBuf, offset);

  const ssHash = new Uint8Array(await crypto.subtle.digest("SHA-256", ssPayload));
  let sharedSecretHex = "";
  for (let i = 0; i < ssHash.length; i++) {
    sharedSecretHex += ssHash[i].toString(16).padStart(2, "0");
  }

  return {
    ciphertext: {
      keyId: pk.keyId,
      uHex,
      vHex,
    },
    sharedSecretHex,
  };
}
