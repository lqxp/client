/**
 * 
 * AI Generated Code
 * 
 * A type check for `.vue` files that actually runs here.
 *
 * vue-tsc is inert in this environment: Volar's tsc patch fails silently
 * under Bun, so `bun run typecheck` reports nothing whatever the code holds.
 * This writes each `<script setup>` block out as a shadow `.ts` file, padded
 * so every line keeps its number, and runs the real compiler over them.
 * Template expressions are not covered; every implicit any and every type
 * error inside a script block is, at positions that map back one for one.
 *
 * Usage: bun scripts/typecheck-vue.ts [path fragment ...]
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dir, "..");
const SHADOW = path.join(ROOT, ".tscheck");
const SCRIPT = /<script\s+setup[^>]*>([\s\S]*?)<\/script>/;

function shadowOf(file: string): string | null {
  const src = fs.readFileSync(file, "utf8");
  const match = SCRIPT.exec(src);
  if (!match) return null;
  const before = src.slice(0, match.index + match[0].indexOf(match[1]));
  return "\n".repeat(before.split("\n").length - 1) + match[1];
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".vue")) out.push(full);
  }
  return out;
}

fs.rmSync(SHADOW, { recursive: true, force: true });
for (const file of walk(path.join(ROOT, "src"))) {
  const body = shadowOf(file);
  if (body === null) continue;
  const target = path.join(SHADOW, `${path.relative(ROOT, file)}.ts`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body);
}

fs.writeFileSync(path.join(SHADOW, "macros.d.ts"), `
type EmitFn<T> = T extends Record<string, unknown[]>
  ? <K extends keyof T>(event: K, ...args: T[K]) => void
  : T;
declare function defineProps<T>(): Readonly<T>;
declare function defineProps<const T extends Record<string, unknown>>(shape: T): Readonly<import("vue").ExtractPropTypes<T>>;
declare function defineEmits<T>(): EmitFn<T>;
declare function defineEmits(shape: readonly string[]): (event: string, ...args: unknown[]) => void;
declare function defineExpose(exposed?: unknown): void;
declare function defineOptions(options?: unknown): void;
declare function defineSlots<T = unknown>(): T;
declare function defineModel<T = unknown>(...args: unknown[]): { value: T };
declare function withDefaults<T, D>(props: T, defaults: D): T & { readonly [K in keyof D & keyof T]-?: NonNullable<T[K]> };
`);

fs.writeFileSync(path.join(SHADOW, "tsconfig.json"), JSON.stringify({
  extends: "../tsconfig.json",
  compilerOptions: { noEmit: true },
  include: ["**/*.ts", "../src/**/*.ts", "../src/**/*.d.ts"],
}, null, 2));

let output = "";
try {
  execSync(`"${process.execPath}" "${path.join(ROOT, "node_modules/typescript/lib/tsc.js")}" -p "${SHADOW}/tsconfig.json"`,
    { encoding: "utf8", stdio: "pipe", cwd: ROOT });
} catch (error) {
  const shell = error as { stdout?: string; stderr?: string };
  output = `${shell.stdout ?? ""}${shell.stderr ?? ""}`;
}
fs.rmSync(SHADOW, { recursive: true, force: true });

const wanted = process.argv.slice(2);
const byFile = new Map<string, string[]>();
for (const line of output.split("\n")) {
  const hit = /^(.+?)\((\d+),(\d+)\): (error TS\d+: .*)$/.exec(line.trim());
  if (!hit) continue;
  const [, file, row, col, message] = hit;
  // Two shapes are the harness talking about itself: a shadow file has no
  // default export as an SFC does, and a type exported from <script setup>
  // is not visible through the *.vue shim. The editor resolves both.
  if (/TS1192: Module .*has no default export/.test(message)) continue;
  if (/TS2614: Module '"\*\.vue"'/.test(message)) continue;
  const abs = path.resolve(ROOT, file);
  const origin = abs.startsWith(SHADOW)
    ? abs.slice(SHADOW.length + 1).replace(/\.ts$/, "")
    : path.relative(ROOT, abs);
  if (wanted.length && !wanted.some((w) => origin.includes(w))) continue;
  const list = byFile.get(origin) ?? [];
  list.push(`  ${row}:${col}  ${message}`);
  byFile.set(origin, list);
}

let total = 0;
for (const [file, errors] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
  total += errors.length;
  console.log(`\n${file}  (${errors.length})`);
  for (const line of errors) console.log(line);
}
console.log(total ? `\n${total} erreur(s) dans ${byFile.size} fichier(s)` : "aucune erreur");
process.exit(total ? 1 : 0);
