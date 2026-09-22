const PREFIX_BYTES = 64 * 1024;

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(bytes[offset + i] ?? 0);
  return out;
}

function gifIsAnimated(bytes: Uint8Array): boolean {
  let i = 13;
  const flags = bytes[10] ?? 0;
  if (flags & 0x80) i += 3 * (1 << ((flags & 0x07) + 1));
  let frames = 0;

  const skipSubBlocks = () => {
    while (i < bytes.length) {
      const size = bytes[i];
      i += 1;
      if (!size) return;
      i += size;
    }
  };

  while (i < bytes.length) {
    const marker = bytes[i];
    if (marker === 0x3b) return false;
    if (marker === 0x21) {
      i += 2;
      skipSubBlocks();
      continue;
    }
    if (marker === 0x2c) {
      frames += 1;
      if (frames > 1) return true;
      i += 10;
      const local = bytes[i - 1] ?? 0;
      if (local & 0x80) i += 3 * (1 << ((local & 0x07) + 1));
      i += 1;
      skipSubBlocks();
      continue;
    }
    return false; // not something this parser understands
  }
  return false;
}

function pngIsAnimated(bytes: Uint8Array): boolean {
  let i = 8;
  while (i + 8 <= bytes.length) {
    const length =
      ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
    const type = ascii(bytes, i + 4, 4);
    if (type === "acTL") return true;
    if (type === "IDAT" || type === "IEND") return false;
    i += 12 + length; // length + type + data + crc
  }
  return false;
}

function webpIsAnimated(bytes: Uint8Array): boolean {
  let i = 12; // "RIFF" + size + "WEBP"
  while (i + 8 <= bytes.length) {
    const type = ascii(bytes, i, 4);
    const length =
      (bytes[i + 4] | (bytes[i + 5] << 8) | (bytes[i + 6] << 16) | (bytes[i + 7] << 24)) >>> 0;
    if (type === "ANIM" || type === "ANMF") return true;
    i += 8 + length + (length % 2); // chunks are padded to even lengths
  }
  return false;
}

export function detectAnimatedBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false;
  if (ascii(bytes, 0, 3) === "GIF") return gifIsAnimated(bytes);
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG") return pngIsAnimated(bytes);
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return webpIsAnimated(bytes);
  return false;
}

export async function isAnimatedImage(file: Blob): Promise<boolean> {
  try {
    const head = file.slice(0, PREFIX_BYTES);
    return detectAnimatedBytes(new Uint8Array(await head.arrayBuffer()));
  } catch {
    return false;
  }
}
