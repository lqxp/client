export type PhantomMessageHandler = (op: number, d: any) => void;

let handler: PhantomMessageHandler | null = null;

/**
 * Pont léger entre `useMessenger.handleMessage` et `usePhantom` : les ops WS
 * 36/37/38/39 (PREKEY_PUBLISH/FETCH, LINK_CREATE, BLOCK_UPDATE) sont relayées
 * ici sans coupler les deux composables.
 */
export function setPhantomMessageHandler(next: PhantomMessageHandler | null): void {
  handler = next;
}

export function dispatchPhantomMessage(op: number, d: any): void {
  if (handler) handler(op, d);
}
