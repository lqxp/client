export async function computeNullifier(
  ticket: string,
  epoch: number,
  action: string
): Promise<string> {
  const encoder = new TextEncoder();
  const prefix = encoder.encode("qxprotocol_rln_nullifier:");
  const ticketBytes = encoder.encode(ticket);
  const sep = new Uint8Array([0x3a]); // ':'

  const epochBytes = new Uint8Array(8);
  const dataView = new DataView(epochBytes.buffer);
  const high = Math.floor(epoch / 0x100000000);
  const low = epoch >>> 0;
  dataView.setUint32(0, high, false);
  dataView.setUint32(4, low, false);

  const actionBytes = encoder.encode(action);

  const totalLen =
    prefix.length +
    ticketBytes.length +
    1 +
    8 +
    1 +
    actionBytes.length;

  const buffer = new Uint8Array(totalLen);
  let offset = 0;

  buffer.set(prefix, offset);
  offset += prefix.length;
  buffer.set(ticketBytes, offset);
  offset += ticketBytes.length;
  buffer.set(sep, offset);
  offset += 1;
  buffer.set(epochBytes, offset);
  offset += 8;
  buffer.set(sep, offset);
  offset += 1;
  buffer.set(actionBytes, offset);

  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
