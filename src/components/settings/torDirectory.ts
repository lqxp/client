import { ref } from "vue";
import { fetchTorRelays, type TorRelay } from "@/calls/torRelays";
import { errorMessage } from "@/composables/useMessenger";

// Module scope so the list and the consent outlive the section being left.
const relays = ref<TorRelay[]>([]);
const loading = ref(false);
const error = ref("");
const consent = ref(false);
let autoLoaded = false;

async function load() {
  loading.value = true;
  error.value = "";
  try {
    relays.value = await fetchTorRelays(100);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

function autoLoad() {
  if (autoLoaded || loading.value || relays.value.length || !consent.value) return;
  autoLoaded = true;
  void load();
}

export function useTorDirectory() {
  return { relays, loading, error, consent, load, autoLoad };
}
