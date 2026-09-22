export function targetChecked(event: Event) {
  return event.target instanceof HTMLInputElement && event.target.checked;
}

export function targetValue(event: Event) {
  return event.target instanceof HTMLInputElement ? event.target.value : "";
}
