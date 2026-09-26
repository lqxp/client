export const MAX_LOCAL_ROOM_NAME_LENGTH = 64;

export function sanitizeLocalRoomNames(
  raw: unknown,
  isValidRoomId: (id: string) => boolean,
): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const next: Record<string, string> = {};
  for (const [roomId, name] of Object.entries(raw as Record<string, unknown>)) {
    const id = String(roomId || "").trim();
    const clean = String(name || "").trim().slice(0, MAX_LOCAL_ROOM_NAME_LENGTH);
    if (isValidRoomId(id) && clean) next[id] = clean;
  }
  return next;
}

export function resolveRoomDisplayName(
  roomId: string,
  localNames: Record<string, string>,
  serverTitle: string,
): string {
  return (localNames[roomId] || "").trim() || String(serverTitle || "").trim() || roomId;
}

/** Seul un salon Community administré accepte un titre partagé (SEC-14). */
export function roomRenameTarget(isCommunity: boolean, canManage: boolean): "server" | "local" {
  return isCommunity && canManage ? "server" : "local";
}
