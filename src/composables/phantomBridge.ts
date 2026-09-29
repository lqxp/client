export type PhantomMessageHandler = (op: number, d: Record<string, unknown>) => void;

let handler: PhantomMessageHandler | null = null;
let cloudSyncHandler: PhantomMessageHandler | null = null;

/**
 * Lightweight bridge between `useMessenger.handleMessage` and `usePhantom`:
 * WS ops 36/37/38/39 (PREKEY_PUBLISH/FETCH, LINK_CREATE, BLOCK_UPDATE) are
 * relayed here without coupling the two composables.
 */
export function setPhantomMessageHandler(next: PhantomMessageHandler | null): void {
  handler = next;
}

export function dispatchPhantomMessage(op: number, d: Record<string, unknown>): void {
  if (handler) handler(op, d);
}

/**
 * QxCloudSync bridge: WS ops 60 (ack + errors), 61 (pure same-user relay,
 * op 60→61), 62 (peer directory) and 63 (join/update/leave presence) are
 * relayed here without coupling useMessenger and useCloudSync. The server
 * stores nothing.
 */
export function setCloudSyncMessageHandler(next: PhantomMessageHandler | null): void {
  cloudSyncHandler = next;
}

export function dispatchCloudSyncMessage(op: number, d: Record<string, unknown>): void {
  if (cloudSyncHandler) cloudSyncHandler(op, d);
}

export type RoomDeletedListener = (roomId: string) => void;

let roomDeletedListener: RoomDeletedListener | null = null;

/**
 * Room-deletion bridge: when the messenger processes the server eviction
 * (op 58), QxCloudSync records the tombstone for offline peers.
 */
export function setRoomDeletedListener(next: RoomDeletedListener | null): void {
  roomDeletedListener = next;
}

export function notifyRoomDeleted(roomId: string): void {
  if (roomDeletedListener && roomId) roomDeletedListener(roomId);
}

export type RoomLeaveListener = (roomId: string) => void;

let roomLeftListener: RoomLeaveListener | null = null;
let roomJoinedListener: RoomLeaveListener | null = null;

/**
 * Leave/join bridge: when this client leaves (or joins) a room, QxCloudSync
 * propagates the action to peers (`left` tombstones, 30d). Without this the
 * union-only merge never removes the other client.
 */
export function setRoomLeftListener(next: RoomLeaveListener | null): void {
  roomLeftListener = next;
}

export function setRoomJoinedListener(next: RoomLeaveListener | null): void {
  roomJoinedListener = next;
}

export function notifyRoomLeft(roomId: string): void {
  if (roomLeftListener && roomId) roomLeftListener(roomId);
}

export function notifyRoomJoined(roomId: string): void {
  if (roomJoinedListener && roomId) roomJoinedListener(roomId);
}
