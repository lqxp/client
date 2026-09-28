import { reactive, watchEffect } from "vue";

export interface CustomTheme {
  accent: string;
  tint: string;
}

const HEX = /^#[0-9a-f]{6}$/i;
const CODE_PREFIX = "QXT1.";

/**
 * Norme un custom theme brut (payload persisté, backup, sync réseau).
 * Retourne null pour "aucun thème" (légitime) et undefined pour "invalide".
 * Source unique de vérité pour la validation, partagée par le messenger
 * (persisté officiel), les backups et QxCloudSync : aucune clé de stockage
 * ad hoc, tout passe par le persisted state.
 */
export function sanitizeCustomThemeValue(
  value: unknown,
): { accent: string; tint: string } | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const accent = String(source.accent ?? source.a ?? "");
  const tint = String(source.tint ?? source.t ?? "");
  if (!HEX.test(accent)) return undefined;
  if (tint && !HEX.test(tint)) return undefined;
  return { accent: accent.toLowerCase(), tint: tint ? tint.toLowerCase() : "" };
}

function sanitize(value: unknown): CustomTheme | null {
  const out = sanitizeCustomThemeValue(value);
  return out === undefined ? null : out;
}

// État runtime uniquement : la persistance passe par le persisted state du
// messenger (aucune clé locale ad hoc). Le messenger adopte le thème persisté
// au chargement et le réécrit à chaque save.
const state = reactive<{ theme: CustomTheme | null; enabled: boolean }>({
  theme: null,
  enabled: true,
});

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

/** `remember` est conservé pour l'API (RAM-only géré par le messenger) : le
 * thème s'applique toujours pour la session, la persistance disque suit les
 * règles du persisted state (dont le mode RAM-only). */
export function setCustomTheme(theme: CustomTheme | null, remember: boolean, animate = true) {
  void remember;
  if (animate) animateColors();
  state.theme = theme ? sanitize(theme) : null;
  if (state.theme) state.enabled = true;
}

/** Turning it off keeps the colors, so turning it back on restores them. */
export function setCustomThemeEnabled(enabled: boolean, remember = true) {
  void remember;
  animateColors();
  state.enabled = enabled;
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

/** Snapshot pour le persisted state officiel (et les backups). */
export function snapshotCustomTheme(): {
  theme: CustomTheme | null;
  enabled: boolean;
} {
  return {
    theme: state.theme ? { ...state.theme } : null,
    enabled: state.enabled,
  };
}
