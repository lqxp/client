/**
 * Swipe a sheet down to close it, as its handle promises.
 *
 * Every phone sheet in the app draws a grabber, and none of them could be
 * pulled. This is that gesture, written once: the sheet follows the finger
 * down, and on release it either leaves (far enough, or fast enough) or
 * springs back into place.
 *
 * A pull only starts when it cannot be the sheet's own content scrolling:
 * from the handle zone at the top, or from anywhere once the content is
 * already scrolled to its top. A sideways or upward move is left alone.
 *
 * Usage: <div class="sheet" v-sheet-dismiss="close">
 */
import type { Directive } from "vue";

const HANDLE_ZONE = 56;
const DISMISS_SHARE = 0.28;
const DISMISS_SPEED = 0.55;
const SHEET_MEDIA = "(max-width: 700px), (hover: none) and (pointer: coarse)";

interface SheetBinding {
  close: () => void;
  detach: () => void;
}

const bindings = new WeakMap<HTMLElement, SheetBinding>();

function scrolledBy(target: EventTarget | null, sheet: HTMLElement): number {
  let node = target instanceof Element ? target : null;
  while (node) {
    if (node instanceof HTMLElement && node.scrollHeight > node.clientHeight && node.scrollTop > 0) {
      return node.scrollTop;
    }
    if (node === sheet) break;
    node = node.parentElement;
  }
  return 0;
}

function attach(sheet: HTMLElement, initialClose: () => void): SheetBinding {
  const binding: SheetBinding = { close: initialClose, detach: () => {} };
  let startX = 0;
  let startY = 0;
  let lastY = 0;
  let lastT = 0;
  let speed = 0;
  let tracking = false;
  let dragging = false;
  let fromHandle = false;

  function settle(transition: string, transform: string, then?: () => void) {
    sheet.style.transition = transition;
    sheet.style.transform = transform;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      sheet.removeEventListener("transitionend", finish);
      then?.();
    };
    sheet.addEventListener("transitionend", finish);
    // transitionend does not fire when nothing moves, or under reduced motion.
    window.setTimeout(finish, 420);
  }

  function onStart(event: TouchEvent) {
    if (event.touches.length !== 1 || !window.matchMedia(SHEET_MEDIA).matches) return;
    const touch = event.touches[0];
    startX = touch.clientX;
    startY = lastY = touch.clientY;
    lastT = event.timeStamp;
    speed = 0;
    fromHandle = touch.clientY - sheet.getBoundingClientRect().top < HANDLE_ZONE;
    tracking = true;
    dragging = false;
  }

  function onMove(event: TouchEvent) {
    if (!tracking) return;
    const touch = event.touches[0];
    const dy = touch.clientY - startY;
    const dx = touch.clientX - startX;
    if (!dragging) {
      if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
      const pullable = dy > 0 && Math.abs(dy) > Math.abs(dx) && (fromHandle || scrolledBy(event.target, sheet) <= 0);
      if (!pullable) {
        tracking = false;
        return;
      }
      dragging = true;
      sheet.style.transition = "none";
    }
    event.preventDefault();
    const elapsed = event.timeStamp - lastT;
    if (elapsed > 0) speed = (touch.clientY - lastY) / elapsed;
    lastY = touch.clientY;
    lastT = event.timeStamp;
    sheet.style.transform = `translate3d(0, ${Math.max(0, dy)}px, 0)`;
  }

  function onEnd() {
    if (!tracking) return;
    tracking = false;
    if (!dragging) return;
    dragging = false;
    const pulled = lastY - startY;
    const height = sheet.getBoundingClientRect().height || 1;
    if (pulled > height * DISMISS_SHARE || speed > DISMISS_SPEED) {
      settle("transform var(--dur-base) var(--ease-in)", "translate3d(0, 100%, 0)", () => {
        binding.close();
        // A sheet kept in the DOM must not reopen still pushed off screen.
        window.setTimeout(() => {
          sheet.style.transition = "";
          sheet.style.transform = "";
        }, 400);
      });
      return;
    }
    settle("transform var(--dur-slow) var(--ease-spring)", "", () => {
      sheet.style.transition = "";
    });
  }

  sheet.addEventListener("touchstart", onStart, { passive: true });
  sheet.addEventListener("touchmove", onMove, { passive: false });
  sheet.addEventListener("touchend", onEnd);
  sheet.addEventListener("touchcancel", onEnd);
  binding.detach = () => {
    sheet.removeEventListener("touchstart", onStart);
    sheet.removeEventListener("touchmove", onMove);
    sheet.removeEventListener("touchend", onEnd);
    sheet.removeEventListener("touchcancel", onEnd);
  };
  return binding;
}

export const sheetDismiss: Directive<HTMLElement, () => void> = {
  mounted(el, { value }) {
    bindings.set(el, attach(el, value));
  },
  updated(el, { value }) {
    const binding = bindings.get(el);
    if (binding) binding.close = value;
  },
  beforeUnmount(el) {
    bindings.get(el)?.detach();
    bindings.delete(el);
  },
};
