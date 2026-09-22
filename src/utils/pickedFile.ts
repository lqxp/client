export function takePickedFile(event: Event): File | null {
  const input = event.target instanceof HTMLInputElement ? event.target : null;
  if (!input) return null;
  const file = input.files?.[0] ?? null;
  // Cleared so picking the same file again still fires a change.
  input.value = "";
  return file;
}
