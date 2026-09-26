export type RoomKeyDecision = "store" | "unchanged" | "conflict";

/** K6: a known room key is never replaced without an explicit request. */
export function decideRoomKeyImport(existing: string, incoming: string, allowReplace = false): RoomKeyDecision {
  if (!existing) return "store";
  if (existing === incoming) return "unchanged";
  return allowReplace ? "store" : "conflict";
}

export class RoomKeyConflictError extends Error {
  readonly roomId: string;

  constructor(roomId: string, message: string) {
    super(message);
    this.name = "RoomKeyConflictError";
    this.roomId = roomId;
  }
}
