function hexToBigInt(hex: string): bigint {
  if (!hex.startsWith("0x")) {
    hex = "0x" + hex;
  }
  return BigInt(hex);
}

function bigIntToHex(bn: bigint): string {
  return bn.toString(16);
}

function bigIntToBytesBE(bn: bigint): Uint8Array {
  let hex = bn.toString(16);
  if (hex.length % 2 !== 0) {
    hex = "0" + hex;
  }
  const len = hex.length / 2;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let res = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) {
      res = (res * base) % mod;
    }
    base = (base * base) % mod;
    exp = exp / 2n;
  }
  return res;
}

function isProbablePrime(n: bigint, rounds = 16): boolean {
  if (n <= 3n) return n > 1n;
  if (n % 2n === 0n || n % 3n === 0n) return false;

  let d = n - 1n;
  let s = 0n;
  while (d % 2n === 0n) {
    d /= 2n;
    s += 1n;
  }

  const testBases = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];
  for (let i = 0; i < Math.min(rounds, testBases.length); i++) {
    const a = testBases[i];
    if (a >= n) break;
    let x = modPow(a, d, n);
    if (x === 1n || x === n - 1n) continue;

    let composite = true;
    for (let r = 1n; r < s; r++) {
      x = (x * x) % n;
      if (x === n - 1n) {
        composite = false;
        break;
      }
    }
    if (composite) return false;
  }
  return true;
}

async function hashToPrime(x: bigint, y: bigint): Promise<bigint> {
  const xBytes = bigIntToBytesBE(x);
  const yBytes = bigIntToBytesBE(y);
  let counter = 0;

  while (true) {
    const counterBytes = new Uint8Array(4);
    new DataView(counterBytes.buffer).setUint32(0, counter, false);

    const prefix = new TextEncoder().encode("qxprotocol_vdf_prime_l:");
    const sep = new Uint8Array([0x3a]); // ':'

    const totalLen = prefix.length + xBytes.length + 1 + yBytes.length + 1 + 4;
    const buffer = new Uint8Array(totalLen);
    let offset = 0;

    buffer.set(prefix, offset);
    offset += prefix.length;
    buffer.set(xBytes, offset);
    offset += xBytes.length;
    buffer.set(sep, offset);
    offset += 1;
    buffer.set(yBytes, offset);
    offset += yBytes.length;
    buffer.set(sep, offset);
    offset += 1;
    buffer.set(counterBytes, offset);

    const hashBuf = await crypto.subtle.digest("SHA-256", buffer);
    const hashBytes = new Uint8Array(hashBuf);

    // 128-bit candidate (first 16 bytes)
    const candidateBytes = new Uint8Array(16);
    candidateBytes.set(hashBytes.subarray(0, 16));
    candidateBytes[15] |= 1;
    candidateBytes[0] |= 0x80;
    let candidateHex = "";
    for (let i = 0; i < 16; i++) {
      candidateHex += candidateBytes[i].toString(16).padStart(2, "0");
    }

    const candidate = BigInt("0x" + candidateHex);
    if (isProbablePrime(candidate, 16)) {
      return candidate;
    }
    counter++;
  }
}

export interface VdfSolvedProof {
  y: string;
  pi: string;
}

export async function solveVdf(
  xHex: string,
  t: number,
  modulusHex: string,
  onProgress?: (percent: number) => void
): Promise<VdfSolvedProof> {
  const x = hexToBigInt(xHex);
  const modulus = hexToBigInt(modulusHex);

  let y = x % modulus;
  const yieldInterval = 1500;

  for (let i = 0; i < t; i++) {
    y = (y * y) % modulus;

    if (i % yieldInterval === 0) {
      if (onProgress) {
        onProgress(Math.round((i / t) * 100));
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  if (onProgress) {
    onProgress(100);
  }

  // Fiat-Shamir prime l = HashToPrime(x, y)
  const l = await hashToPrime(x, y);

  // q = 2^T / l
  const pow2T = 1n << BigInt(t);
  const q = pow2T / l;

  // pi = x^q mod N
  const pi = modPow(x, q, modulus);

  return {
    y: bigIntToHex(y),
    pi: bigIntToHex(pi),
  };
}
