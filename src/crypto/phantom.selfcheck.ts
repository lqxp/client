// Auto-vérification du client PHANTOM (exécutée avec `bun run src/crypto/phantom.selfcheck.ts`).
import {
  canonicalJson,
  canonicalPrekeyBundleBytes,
  deriveContextualKeypair,
  epochDay,
  fp,
  generateMlKem768KeyPair,
  generatePrekeyBundle,
  openEnvelope,
  sealEnvelope,
  signInner,
  slotContextual,
  slotGlobal,
  verifyInner,
  verifyPrekeyBundle,
  type PrekeyBundle,
} from "./phantom";
import { generateMlDsa65KeyPair, signMlDsa65, verifyMlDsa65 } from "./mldsa";
import { generateDeviceSigningKeyPair } from "./e2ee";

let failures = 0;
function ok(cond: boolean, label: string) {
  if (cond) {
    console.log("  ✓", label);
  } else {
    failures++;
    console.error("  ✗", label);
  }
}

// ── Vecteur cross-langage : la forme canonique doit être identique au serveur.
const CROSS_LANG_CANONICAL =
  '{"blockFilter":[],"ecdsaP256Pk":{"crv":"P-256","kty":"EC","x":"AQID","y":"BAUG"},"mldsa65Pk":"bb","mlkem768Pk":"aa","updatedAt":1730000000000,"version":1}';

console.log("canonicalJson");
ok(
  canonicalJson({
    version: 1,
    mlkem768Pk: "aa",
    ecdsaP256Pk: { kty: "EC", crv: "P-256", x: "AQID", y: "BAUG" },
    mldsa65Pk: "bb",
    blockFilter: [],
    updatedAt: 1730000000000,
  }) === CROSS_LANG_CANONICAL,
  "cross-language canonical bundle",
);

console.log("mldsa65");
{
  const { publicKey, secretKey } = generateMlDsa65KeyPair();
  const msg = new TextEncoder().encode("hello phantom");
  const sig = signMlDsa65(msg, secretKey);
  ok(sig.length === 3309, "signature length 3309");
  ok(verifyMlDsa65(sig, msg, publicKey), "verify");
  ok(!verifyMlDsa65(sig, new TextEncoder().encode("tampered"), publicKey), "reject tampered");
}

console.log("ecdsa contextual");
{
  const master = new Uint8Array(32).fill(7);
  const a = await deriveContextualKeypair(master, "roomA");
  const b = await deriveContextualKeypair(master, "roomB");
  ok(JSON.stringify(a.publicKey) !== JSON.stringify(b.publicKey), "room-separated public keys");
  // deriveContextualKeypair is deterministic
  const a2 = await deriveContextualKeypair(master, "roomA");
  ok(JSON.stringify(a.publicKey) === JSON.stringify(a2.publicKey), "deterministic derivation");
}

console.log("prekey bundle");
{
  const ecdsa = await generateDeviceSigningKeyPair();
  const mldsa = generateMlDsa65KeyPair();
  const mlkem = generateMlKem768KeyPair();
  const bundle = await generatePrekeyBundle({
    mlkemPublicKey: mlkem.publicKey,
    ecdsaPublicJwk: ecdsa.publicKey,
    ecdsaPrivateJwk: ecdsa.privateKey,
    mldsaKeyPair: mldsa,
  });
  ok(bundle.sigEcdsa.length > 0, "sigEcdsa present");
  ok(bundle.sigMldsa.length === 3309 * 2, "sigMldsa hex length");
  const canonicalText = new TextDecoder().decode(canonicalPrekeyBundleBytes(bundle));
  ok(!canonicalText.includes("sigEcdsa"), "canonical excludes sigEcdsa");
  ok(await verifyPrekeyBundle(bundle), "bundle verifies");
  const tampered: PrekeyBundle = { ...bundle, mlkem768Pk: bundle.mlkem768Pk.slice(0, -2) + "ff" };
  ok(!(await verifyPrekeyBundle(tampered)), "bundle rejects tampering");
}

console.log("slots");
{
  const day = epochDay(Date.now());
  const fpA = await fp("aa".repeat(1184));
  const g = await slotGlobal(fpA, day);
  const c = await slotContextual(fpA, "bb".repeat(32), day);
  ok(g.length === 64, "slotGlobal hex64");
  ok(c.length === 64, "slotContextual hex64");
  ok(g !== c, "global ≠ contextual");
}

console.log("seal/open + hybrid");
{
  const recipient = generateMlKem768KeyPair();
  const ecdsa = await generateDeviceSigningKeyPair();
  const mldsa = generateMlDsa65KeyPair();
  const master = new Uint8Array(32).fill(9);
  const ctx = await deriveContextualKeypair(master, "roomA");

  const recipientFp = await fp(toHex(recipient.publicKey));
  const inner = await signInner(
    {
      kind: "intro",
      epochBucket: epochDay(Date.now()),
      sender: {
        contextualPub: ctx.publicKey,
        prekeyFp: "0".repeat(64),
        mlkem768Pk: "3".repeat(2368),
        displayName: "alice",
      },
      intro: "salut !",
    },
    ctx.privateKey,
    mldsa.secretKey,
  );

  const outer = await sealEnvelope(inner, toHex(recipient.publicKey), {
    slotId: "1".repeat(64),
    recipientFp,
    senderHint: "2".repeat(64),
    bucket: 16384,
  });

  const opened = await openEnvelope(outer, toHex(recipient.secretKey));
  ok(opened.kind === "intro", "opened kind");
  ok(opened.intro === "salut !", "opened intro text");
  ok(
    await verifyInner(opened, ctx.publicKey, toHex(mldsa.publicKey)),
    "hybrid inner signature verifies",
  );
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nAll PHANTOM client self-checks passed.");
