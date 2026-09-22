import { reactive, watchEffect } from "vue";

export interface CustomTheme {
  accent: string;
  tint: string;
}

const STORAGE_KEY = "qx-custom-theme";
const HEX = /^#[0-9a-f]{6}$/i;
const CODE_PREFIX = "QXT1.";

function sanitize(value: unknown): CustomTheme | null {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const accent = String(source.accent ?? source.a ?? "");
  const tint = String(source.tint ?? source.t ?? "");
  if (!HEX.test(accent)) return null;
  return { accent: accent.toLowerCase(), tint: HEX.test(tint) ? tint.toLowerCase() : "" };
}

function load(): { theme: CustomTheme | null; enabled: boolean } {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return { theme: sanitize(raw), enabled: raw?.enabled !== false };
  } catch {
    return { theme: null, enabled: true };
  }
}

const state = reactive<{ theme: CustomTheme | null; enabled: boolean }>(load());
let rememberLast = true;

function save(remember: boolean) {
  rememberLast = remember;
  try {
    if (!state.theme || !remember) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state.theme, enabled: state.enabled }));
  } catch {
    // Storage blocked: the theme still applies for this session.
  }
}

export function encodeTheme(theme: CustomTheme) {
  const json = JSON.stringify({ a: theme.accent, t: theme.tint });
  return CODE_PREFIX + btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeTheme(code: string): CustomTheme | null {
  const raw = code.trim();
  if (!raw.startsWith(CODE_PREFIX)) return null;
  try {
    return sanitize(JSON.parse(atob(raw.slice(CODE_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/"))));
  } catch {
    return null;
  }
}

let animationTimer: ReturnType<typeof setTimeout> | null = null;

function animateColors() {
  const root = document.documentElement;
  root.classList.add("theme-animating");
  if (animationTimer) clearTimeout(animationTimer);
  animationTimer = setTimeout(() => root.classList.remove("theme-animating"), 560);
}

/** `remember` is false in RAM-only mode, where nothing may reach the disk. */
export function setCustomTheme(theme: CustomTheme | null, remember: boolean, animate = true) {
  if (animate) animateColors();
  state.theme = theme ? sanitize(theme) : null;
  if (state.theme) state.enabled = true;
  save(remember);
}

/** Turning it off keeps the colors, so turning it back on restores them. */
export function setCustomThemeEnabled(enabled: boolean, remember = rememberLast) {
  animateColors();
  state.enabled = enabled;
  save(remember);
}

export function installCustomTheme() {
  watchEffect(() => {
    const root = document.documentElement.style;
    const theme = state.enabled ? state.theme : null;
    if (theme) root.setProperty("--accent", theme.accent);
    else root.removeProperty("--accent");
    if (theme?.tint) root.setProperty("--chat-tint", theme.tint);
    else root.removeProperty("--chat-tint");
    document.documentElement.classList.toggle("has-chat-tint", Boolean(theme?.tint));
  });
}

export function useCustomTheme() {
  return state;
}
