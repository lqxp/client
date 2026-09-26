import type { PhantomInner, PrekeyBundle } from "@/crypto/phantom";

export interface WelcomeAuthDeps {
  fetchPrekey: (username: string) => Promise<PrekeyBundle | null>;
  fingerprint: (mlkemPkHex: string) => Promise<string>;
  verifyBundle: (bundle: PrekeyBundle) => Promise<boolean>;
  verifyInner: (inner: PhantomInner, contextualPub: JsonWebKey, mldsaPkHex: string) => Promise<boolean>;
}

/** K6: a welcome is accepted only if it is signed by the announced sender's published prekey. */
export async function authenticateWelcome(inner: PhantomInner, deps: WelcomeAuthDeps): Promise<boolean> {
  if (inner?.kind !== "welcome" || !inner.welcome || !inner.hybridSig) return false;
  const username = String(inner.sender?.displayName || "");
  if (!username || !inner.sender?.prekeyFp || !inner.sender?.contextualPub) return false;
  try {
    const bundle = await deps.fetchPrekey(username);
    if (!bundle) return false;
    if (!(await deps.verifyBundle(bundle))) return false;
    if ((await deps.fingerprint(bundle.mlkem768Pk)) !== inner.sender.prekeyFp) return false;
    return await deps.verifyInner(inner, inner.sender.contextualPub, bundle.mldsa65Pk);
  } catch {
    return false;
  }
}
