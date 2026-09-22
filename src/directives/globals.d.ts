import type { Directive } from "vue";

declare module "vue" {
  interface ComponentCustomProperties {
    vSheetDismiss: Directive<HTMLElement, () => void>;
  }
}

export {};
