import { computed, ref } from "vue";
import en from "@/i18n/en.json";
import fr from "@/i18n/fr.json";
import es from "@/i18n/es.json";
import ru from "@/i18n/ru.json";

type DeepRecord = { [key: string]: string | DeepRecord };

const locales: Record<string, DeepRecord> = { en, fr, es, ru };

export const LOCALE_LABELS: Record<string, string> = {
  en: "English",
  fr: "French",
  es: "Español",
  ru: "Русский"
};

// Detect browser language, fallback to "en"
function detectLocale(): string {
  const lang = String(navigator.language || "").toLowerCase().slice(0, 2);
  return lang in locales ? lang : "en";
}

const STORAGE_KEY = "qxprotocol-locale";

function loadLocale(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved in locales) return saved;
  } catch { /* ignore */ }
  return detectLocale();
}

function saveLocale(locale: string): void {
  try { localStorage.setItem(STORAGE_KEY, locale); } catch { /* ignore */ }
}

// Singleton reactive state
const currentLocale = ref<string>(loadLocale());

function getNestedValue(obj: DeepRecord, path: string): string | undefined {
  const parts = path.split(".");
  let current: string | DeepRecord = obj;
  for (const part of parts) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as DeepRecord)[part];
  }
  return typeof current === "string" ? current : undefined;
}

function translate(key: string, params?: Record<string, string>): string {
  const dict = locales[currentLocale.value] ?? locales["en"];
  const fallback = locales["en"];
  let value = getNestedValue(dict, key) ?? getNestedValue(fallback, key) ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replaceAll(`{${k}}`, v);
    }
  }
  return value;
}

export function useI18n() {
  const locale = computed({
    get: () => currentLocale.value,
    set: (v: string) => {
      if (v in locales) {
        currentLocale.value = v;
        saveLocale(v);
      }
    }
  });

  const availableLocales = Object.keys(locales);

  const t = (key: string, params?: Record<string, string>) => translate(key, params);

  return { t, locale, availableLocales };
}