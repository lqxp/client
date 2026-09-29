export type PhantomMessageHandler = (op: number, d: Record<string, unknown>) => void;

let handler: PhantomMessageHandler | null = null;
let cloudSyncHandler: PhantomMessageHandler | null = null;

/**
 * Pont léger entre `useMessenger.handleMessage` et `usePhantom` : les ops WS
 * 36/37/38/39 (PREKEY_PUBLISH/FETCH, LINK_CREATE, BLOCK_UPDATE) sont relayées
 * ici sans coupler les deux composables.
 */
export function setPhantomMessageHandler(next: PhantomMessageHandler | null): void {
  handler = next;
}

export function dispatchPhantomMessage(op: number, d: Record<string, unknown>): void {
  if (handler) handler(op, d);
}

/**
 * Pont QxCloudSync : les ops WS 60 (ack + erreurs), 61 (relais pur same-user,
 * op 60→61), 62 (annuaire des pairs) et 63 (présence join/update/leave) sont
 * relayées ici sans coupler useMessenger et useCloudSync. Le serveur ne
 * stocke rien.
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
 * Pont suppression de room : quand le messenger traite l'éviction serveur
 * (op 58), QxCloudSync enregistre la tombstone pour les pairs offline.
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
 * Pont leave/join : quand ce client quitte (ou rejoint) une room, QxCloudSync
 * propage l'action aux pairs (tombstones `left`, 30 j). Sans ça le merge
 * union-only ne fait jamais partir l'autre client.
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
