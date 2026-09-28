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
 * Pont QxCloudSync : l'op WS 61 (relais pur same-user, op 60→61) est relayée
 * ici sans coupler useMessenger et useCloudSync. Le serveur ne stocke rien.
 */
export function setCloudSyncMessageHandler(next: PhantomMessageHandler | null): void {
  cloudSyncHandler = next;
}

export function dispatchCloudSyncMessage(op: number, d: Record<string, unknown>): void {
  if (cloudSyncHandler) cloudSyncHandler(op, d);
}
