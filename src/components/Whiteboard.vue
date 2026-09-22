<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch, type PropType } from "vue";
import ColorPicker from "@/components/ColorPicker.vue";
import Icon from "@/components/Icon.vue";
import type { Messenger } from "@/composables/useMessenger";
import type { useDialog } from "@/composables/useDialog";
import { useI18n } from "@/composables/useI18n";

const props = defineProps({
  messenger: { type: Object as PropType<Messenger>, required: true }
});

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();
const dialog = inject<ReturnType<typeof useDialog>>("dialog")!;

type Tool = "pen" | "marker" | "line" | "arrow" | "rect" | "ellipse";
type Mode = Tool | "eraser";

interface Stroke {
  id: string;
  author: string;
  tool: Tool;
  color: string;
  width: number;
  points: number[];
}

const TOOLS: { id: Mode; key: string; icon: string }[] = [
  { id: "pen", key: "P", icon: "M4 20l4-1 11-11-3-3L5 16l-1 4Z" },
  { id: "marker", key: "H", icon: "M9 15l-4 4h6l1.5-1.5M9 15l6-10 4 3-6 10M9 15l3.5 2.5" },
  { id: "line", key: "L", icon: "M5 19 19 5" },
  { id: "arrow", key: "A", icon: "M5 19 19 5M10 5h9v9" },
  { id: "rect", key: "R", icon: "M4 6h16v12H4z" },
  { id: "ellipse", key: "O", icon: "M12 5c5 0 8 3 8 7s-3 7-8 7-8-3-8-7 3-7 8-7Z" },
  { id: "eraser", key: "E", icon: "m7 21-4-4 11-11 7 7-8 8ZM7 21h14" },
];
const COLORS = ["#f4f4f5", "#1f2a36", "#ff6b70", "#f5a623", "#3fcf6f", "#2090ea", "#b56fe8"];
const SHAPES: Tool[] = ["line", "arrow", "rect", "ellipse"];
const MOD_ROLES = ["administrator", "subAdmin", "moderator"];
const SEND_EVERY_MS = 200;
const MAX_SYNC_STROKES = 400;

const room = computed(() => props.messenger.state.whiteboardRoom);
const me = computed(() => String(props.messenger.state.username || "").trim().toLowerCase());
const isCommunity = computed(() => props.messenger.isCommunityRoom?.(room.value) === true);
const canModerate = computed(() => props.messenger.canModerateRoom?.(room.value) === true);
const locked = ref(false);
const canDraw = computed(() => !locked.value || canModerate.value);

const canvasRef = ref<HTMLCanvasElement | null>(null);
const mode = ref<Mode>("pen");
const color = ref(COLORS[5]);
const width = ref(4);
const pickerOpen = ref(false);
const strokes = ref(new Map<string, Stroke>());
const undone: Stroke[] = [];
let drawing: Stroke | null = null;
let pending: number[] = [];
let sendTimer: ReturnType<typeof setTimeout> | null = null;
let erasing = false;
let unsubscribe: (() => void) | null = null;
let resizeObserver: ResizeObserver | null = null;

const myStrokes = computed(() => [...strokes.value.values()].filter((stroke) => stroke.author === me.value));

function isModerator(username: string) {
  return MOD_ROLES.includes(props.messenger.roleForUsername?.(room.value, username) || "");
}

function newId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, w: number, h: number) {
  const scale = window.devicePixelRatio || 1;
  const p = stroke.points;
  if (p.length < 2) return;
  ctx.save();
  ctx.strokeStyle = stroke.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = stroke.width * scale * (stroke.tool === "marker" ? 3 : 1);
  ctx.globalAlpha = stroke.tool === "marker" ? 0.35 : 1;
  ctx.beginPath();
  const x1 = p[0] * w, y1 = p[1] * h;
  const x2 = p[p.length - 2] * w, y2 = p[p.length - 1] * h;
  if (stroke.tool === "pen" || stroke.tool === "marker") {
    ctx.moveTo(x1, y1);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] * w, p[i + 1] * h);
    if (p.length === 2) ctx.lineTo(x1 + 0.1, y1);
  } else if (stroke.tool === "rect") {
    ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  } else if (stroke.tool === "ellipse") {
    ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
  } else {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    if (stroke.tool === "arrow") {
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const head = Math.max(10, stroke.width * 3) * scale;
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(angle - 0.45), y2 - head * Math.sin(angle - 0.45));
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(angle + 0.45), y2 - head * Math.sin(angle + 0.45));
    }
  }
  ctx.stroke();
  ctx.restore();
}

function redraw() {
  const canvas = canvasRef.value;
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const stroke of strokes.value.values()) drawStroke(ctx, stroke, canvas.width, canvas.height);
}

function resize() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const scale = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * scale));
  canvas.height = Math.max(1, Math.round(rect.height * scale));
  redraw();
}

function send(data: Record<string, unknown>) {
  if (room.value) void props.messenger.sendRoomSignal(room.value, { t: "board", ...data });
}

function serialize(stroke: Stroke) {
  return { id: stroke.id, tool: stroke.tool, c: stroke.color, w: stroke.width, p: stroke.points };
}

function flush() {
  sendTimer = null;
  if (!drawing) return;
  if (SHAPES.includes(drawing.tool)) send({ k: "shape", ...serialize(drawing) });
  else if (pending.length) send({ k: "pts", id: drawing.id, tool: drawing.tool, c: drawing.color, w: drawing.width, p: pending });
  pending = [];
}

function pointAt(event: PointerEvent) {
  const rect = canvasRef.value!.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
  return [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000];
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const tt = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + tt * dx), py - (ay + tt * dy));
}

function eraseAt(event: PointerEvent) {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const px = event.clientX - rect.left, py = event.clientY - rect.top;
  for (const stroke of myStrokes.value) {
    const p = stroke.points;
    const pts = SHAPES.includes(stroke.tool) ? [p[0], p[1], p[p.length - 2], p[p.length - 1]] : p;
    for (let i = 0; i < pts.length - 2 || i === 0; i += 2) {
      const bx = pts[i + 2] ?? pts[i], by = pts[i + 3] ?? pts[i + 1];
      if (segmentDistance(px, py, pts[i] * rect.width, pts[i + 1] * rect.height, bx * rect.width, by * rect.height) < 12) {
        removeStroke(stroke.id, true);
        break;
      }
      if (pts.length <= 2) break;
    }
  }
}

function removeStroke(id: string, broadcast: boolean) {
  const stroke = strokes.value.get(id);
  if (!stroke) return;
  strokes.value.delete(id);
  if (stroke.author === me.value) undone.push(stroke);
  redraw();
  if (broadcast) send({ k: "del", id });
}

function onDown(event: PointerEvent) {
  if (!canDraw.value) return;
  pickerOpen.value = false;
  canvasRef.value?.setPointerCapture(event.pointerId);
  if (mode.value === "eraser") {
    erasing = true;
    eraseAt(event);
    return;
  }
  const point = pointAt(event);
  drawing = { id: newId(), author: me.value, tool: mode.value, color: color.value, width: width.value, points: SHAPES.includes(mode.value) ? [...point, ...point] : point };
  strokes.value.set(drawing.id, drawing);
  undone.length = 0;
  pending = [...drawing.points];
  redraw();
  sendTimer ??= setTimeout(flush, SEND_EVERY_MS);
}

function onMove(event: PointerEvent) {
  if (erasing) {
    eraseAt(event);
    return;
  }
  if (!drawing) return;
  const point = pointAt(event);
  if (SHAPES.includes(drawing.tool)) drawing.points.splice(2, 2, ...point);
  else {
    drawing.points.push(...point);
    pending.push(...point);
  }
  redraw();
  sendTimer ??= setTimeout(flush, SEND_EVERY_MS);
}

function onUp() {
  erasing = false;
  if (!drawing) return;
  if (sendTimer) clearTimeout(sendTimer);
  flush();
  drawing = null;
}

function undo() {
  const last = myStrokes.value[myStrokes.value.length - 1];
  if (last) removeStroke(last.id, true);
}

function redo() {
  const stroke = undone.pop();
  if (!stroke || !canDraw.value) return;
  strokes.value.set(stroke.id, stroke);
  redraw();
  send({ k: "add", ...serialize(stroke) });
}

async function clearAll() {
  if (!canModerate.value || !strokes.value.size) return;
  if (!await dialog.showConfirm(t("whiteboard.clearConfirm"), "", { danger: true, confirmLabel: t("whiteboard.clearShort") })) return;
  strokes.value.clear();
  undone.length = 0;
  redraw();
  send({ k: "clear" });
}

function toggleLock() {
  if (!canModerate.value) return;
  locked.value = !locked.value;
  send({ k: "lock", v: locked.value });
}

function exportImage() {
  canvasRef.value?.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "whiteboard.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}

function parseStroke(raw: Record<string, unknown>, author: string): Stroke | null {
  const tool = String(raw.tool || "pen") as Tool;
  if (typeof raw.id !== "string" || !["pen", "marker", ...SHAPES].includes(tool) || !Array.isArray(raw.p)) return null;
  const points = raw.p.map(Number).filter((n) => Number.isFinite(n) && n >= 0 && n <= 1);
  return {
    id: raw.id.slice(0, 32),
    author,
    tool,
    color: /^#[0-9a-f]{6}$/i.test(String(raw.c)) ? String(raw.c) : COLORS[5],
    width: Math.min(24, Math.max(1, Number(raw.w) || 4)),
    points: points.slice(0, points.length - (points.length % 2)),
  };
}

// Every rule is checked on arrival too: a modified client cannot draw when locked or erase others.
function onSignal(roomId: string, data: Record<string, unknown>, from: string) {
  if (roomId !== room.value || data.t !== "board" || !from) return;
  const author = from.toLowerCase();
  const allowedToDraw = !locked.value || isModerator(author);
  const k = data.k;
  if ((k === "pts" || k === "shape" || k === "add") && allowedToDraw) {
    const incoming = parseStroke(data, author);
    if (!incoming) return;
    const existing = strokes.value.get(incoming.id);
    if (existing && existing.author !== author) return;
    if (k === "pts" && existing) existing.points.push(...incoming.points);
    else strokes.value.set(incoming.id, existing && k === "shape" ? { ...existing, points: incoming.points } : incoming);
    redraw();
  } else if (k === "del" && typeof data.id === "string") {
    if (strokes.value.get(data.id)?.author === author) {
      strokes.value.delete(data.id);
      redraw();
    }
  } else if (k === "clear" && isModerator(author)) {
    strokes.value.clear();
    redraw();
  } else if (k === "lock" && isModerator(author)) {
    locked.value = Boolean(data.v);
  } else if (k === "sync-req") {
    send({ k: "sync", lock: locked.value, s: [...strokes.value.values()].slice(-MAX_SYNC_STROKES).map((stroke) => ({ ...serialize(stroke), a: stroke.author })) });
  } else if (k === "sync" && Array.isArray(data.s)) {
    if (isModerator(author)) locked.value = Boolean(data.lock);
    if (strokes.value.size) return;
    for (const raw of data.s) {
      if (!raw || typeof raw !== "object") continue;
      const stroke = parseStroke(raw as Record<string, unknown>, String((raw as Record<string, unknown>).a || "").toLowerCase());
      if (stroke && stroke.author) strokes.value.set(stroke.id, stroke);
    }
    redraw();
  }
}

function onKey(event: KeyboardEvent) {
  const target = event.target;
  if (!room.value || dialog.dialogState.open || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) return;
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (key === "escape") {
    if (pickerOpen.value) pickerOpen.value = false;
    else close();
  } else if (mod && key === "z" && !event.shiftKey) {
    event.preventDefault();
    undo();
  } else if (mod && (key === "y" || (key === "z" && event.shiftKey))) {
    event.preventDefault();
    redo();
  } else if (mod && key === "s") {
    event.preventDefault();
    exportImage();
  } else if (!mod && key === "[") {
    width.value = Math.max(1, width.value - 1);
  } else if (!mod && key === "]") {
    width.value = Math.min(24, width.value + 1);
  } else if (!mod && /^[1-7]$/.test(key)) {
    color.value = COLORS[Number(key) - 1];
    if (mode.value === "eraser") mode.value = "pen";
  } else if (!mod) {
    const tool = TOOLS.find((item) => item.key.toLowerCase() === key);
    if (tool) mode.value = tool.id;
  }
}

function close() {
  props.messenger.state.whiteboardRoom = "";
}

watch(room, async (value, previous) => {
  if (previous && value !== previous) {
    strokes.value.clear();
    undone.length = 0;
    locked.value = false;
  }
  if (!value) {
    unsubscribe?.();
    unsubscribe = null;
    resizeObserver?.disconnect();
    window.removeEventListener("keydown", onKey);
    return;
  }
  unsubscribe ??= props.messenger.onRoomSignal(onSignal);
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  window.addEventListener("keydown", onKey);
  await nextTick();
  resize();
  if (canvasRef.value) {
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvasRef.value);
  }
  send({ k: "sync-req" });
});

watch(() => props.messenger.state.activeRoom, (active) => {
  if (room.value && active !== room.value) close();
});

onBeforeUnmount(() => {
  unsubscribe?.();
  resizeObserver?.disconnect();
  window.removeEventListener("keydown", onKey);
  if (sendTimer) clearTimeout(sendTimer);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="qx-fade">
      <div v-if="room" class="whiteboard" role="dialog" :aria-label="t('whiteboard.title')">
        <header class="whiteboard__bar">
          <div class="whiteboard__title">
            <strong>{{ t('whiteboard.title') }}</strong>
            <span>{{ locked ? t('whiteboard.lockedNote') : t('whiteboard.subtitle') }}</span>
          </div>
          <button type="button" class="icon-btn" :aria-label="t('message.close')" @click="close">
            <Icon name="close" viewBox="0 0 24 24" />
          </button>
        </header>

        <div class="whiteboard__stage">
          <canvas ref="canvasRef" class="whiteboard__canvas" :class="{ 'is-readonly': !canDraw, 'is-erasing': mode === 'eraser' }"
            @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp"></canvas>

          <div v-if="canDraw" class="whiteboard__dock" role="toolbar" :aria-label="t('whiteboard.tools')">
            <button v-for="tool in TOOLS" :key="tool.id" type="button" class="whiteboard__tool" :class="{ 'is-active': mode === tool.id }"
              :aria-label="t(`whiteboard.tool.${tool.id}`)" :title="`${t(`whiteboard.tool.${tool.id}`)} (${tool.key})`"
              :aria-pressed="mode === tool.id" @click="mode = tool.id">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
                aria-hidden="true"><path :d="tool.icon" /></svg>
            </button>
            <span class="whiteboard__sep" aria-hidden="true"></span>
            <button v-for="(swatch, index) in COLORS" :key="swatch" type="button" class="whiteboard__swatch"
              :class="{ 'is-active': color === swatch }" :style="{ background: swatch }"
              :aria-label="t('whiteboard.colorN', { n: String(index + 1) })" :title="`${index + 1}`" @click="color = swatch"></button>
            <button type="button" class="whiteboard__swatch whiteboard__swatch--custom" :class="{ 'is-active': !COLORS.includes(color) }"
              :style="{ '--custom': color }" :aria-label="t('whiteboard.customColor')" :aria-expanded="pickerOpen"
              @click="pickerOpen = !pickerOpen"></button>
            <span class="whiteboard__sep" aria-hidden="true"></span>
            <label class="whiteboard__size" :title="`${t('whiteboard.size')} ([ ])`">
              <span class="whiteboard__size-dot" :style="{ width: `${Math.min(18, width + 2)}px`, height: `${Math.min(18, width + 2)}px`, background: color }"></span>
              <input v-model.number="width" type="range" min="1" max="24" :aria-label="t('whiteboard.size')" />
            </label>
            <span class="whiteboard__sep" aria-hidden="true"></span>
            <button type="button" class="whiteboard__tool" :aria-label="t('whiteboard.undo')" :title="`${t('whiteboard.undo')} (Ctrl+Z)`" @click="undo">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
                aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></svg>
            </button>
            <button type="button" class="whiteboard__tool" :aria-label="t('whiteboard.redo')" :title="`${t('whiteboard.redo')} (Ctrl+Shift+Z)`" @click="redo">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
                aria-hidden="true"><path d="m15 14 5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h3" /></svg>
            </button>
            <button type="button" class="whiteboard__tool" :aria-label="t('whiteboard.export')" :title="`${t('whiteboard.export')} (Ctrl+S)`" @click="exportImage">
              <Icon name="download" viewBox="0 0 24 24" />
            </button>
            <template v-if="canModerate">
              <span class="whiteboard__sep" aria-hidden="true"></span>
              <button v-if="isCommunity" type="button" class="whiteboard__tool" :class="{ 'is-active': locked }"
                :aria-label="locked ? t('whiteboard.unlock') : t('whiteboard.lock')" :title="locked ? t('whiteboard.unlock') : t('whiteboard.lock')"
                :aria-pressed="locked" @click="toggleLock">
                <Icon name="lock" viewBox="0 0 24 24" />
              </button>
              <button type="button" class="whiteboard__tool is-danger" :aria-label="t('whiteboard.clear')" :title="t('whiteboard.clear')" @click="clearAll">
                <Icon name="trash" viewBox="0 0 24 24" />
              </button>
            </template>
          </div>
          <Transition name="picker-pop">
            <div v-if="pickerOpen && canDraw" class="whiteboard__picker" @pointerdown.stop>
              <ColorPicker v-model="color" :swatches="COLORS" />
            </div>
          </Transition>
          <div v-if="!canDraw" class="whiteboard__readonly">
            <Icon name="lock" viewBox="0 0 24 24" />
            <span>{{ t('whiteboard.readonly') }}</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.whiteboard {
  position: fixed;
  top: var(--app-top-inset, 0px);
  right: 0;
  bottom: 0;
  left: 0;
  z-index: var(--z-modal);
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--text);
}

.whiteboard__bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: calc(10px + var(--mobile-status-offset, 0px)) 14px 10px 18px;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
}

.whiteboard__title {
  display: flex;
  flex-direction: column;
  min-width: 0;
  margin-right: auto;
}

.whiteboard__title strong {
  font-size: 15px;
}

.whiteboard__title span {
  color: var(--muted);
  font-size: 11.5px;
}

.whiteboard__stage {
  position: relative;
  flex: 1;
  min-height: 0;
}

.whiteboard__canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  touch-action: none;
  cursor: crosshair;
  background:
    radial-gradient(circle, color-mix(in srgb, var(--text) 12%, transparent) 1px, transparent 1px) 0 0 / 22px 22px,
    var(--surface);
}

.whiteboard__canvas.is-erasing {
  cursor: cell;
}

.whiteboard__canvas.is-readonly {
  cursor: default;
}

.whiteboard__dock {
  position: absolute;
  left: 50%;
  bottom: max(18px, var(--app-safe-bottom));
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: calc(100% - 24px);
  padding: 6px 8px;
  overflow-x: auto;
  border-radius: 16px;
  background: color-mix(in srgb, var(--surface) 90%, transparent);
  -webkit-backdrop-filter: blur(18px) saturate(1.5);
  backdrop-filter: blur(18px) saturate(1.5);
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.28), 0 0 0 1px var(--line-strong);
  transform: translateX(-50%);
  scrollbar-width: none;
  animation: dock-in var(--dur-slow) var(--ease-spring) both;
}

.whiteboard__dock::-webkit-scrollbar {
  display: none;
}

@keyframes dock-in {
  from { opacity: 0; transform: translate(-50%, 16px); }
}

.whiteboard__tool {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 10px;
  color: var(--text);
  transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}

.whiteboard__tool:hover {
  background: color-mix(in srgb, var(--text) 9%, transparent);
}

.whiteboard__tool:active {
  transform: scale(.92);
}

.whiteboard__tool.is-active {
  background: var(--accent);
  color: #fff;
}

.whiteboard__tool.is-danger {
  color: var(--red);
}

.whiteboard__tool svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
}

.whiteboard__swatch {
  width: 22px;
  height: 22px;
  flex: none;
  margin: 0 2px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.18);
  transition: transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
}

.whiteboard__swatch.is-active {
  box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--accent);
  transform: scale(1.08);
}

.whiteboard__swatch--custom {
  background: conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
  position: relative;
}

.whiteboard__swatch--custom::after {
  content: "";
  position: absolute;
  inset: 5px;
  border-radius: 50%;
  background: var(--custom);
  box-shadow: 0 0 0 1.5px #fff;
}

.whiteboard__picker {
  position: absolute;
  z-index: 2;
  bottom: calc(max(18px, var(--app-safe-bottom)) + 62px);
  left: 50%;
  width: 250px;
  padding: 12px;
  border-radius: 14px;
  background: var(--surface);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35), 0 0 0 1px var(--line-strong);
  transform: translateX(-50%);
}

.whiteboard__size {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 6px;
  flex: none;
}

.whiteboard__size-dot {
  display: block;
  border-radius: 50%;
  flex: none;
}

.whiteboard__size input {
  width: 80px;
  accent-color: var(--accent);
}

.whiteboard__sep {
  width: 1px;
  height: 22px;
  margin: 0 4px;
  flex: none;
  background: var(--line-strong);
}

.whiteboard__readonly {
  position: absolute;
  left: 50%;
  bottom: max(18px, var(--app-safe-bottom));
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 90%, transparent);
  -webkit-backdrop-filter: blur(18px);
  backdrop-filter: blur(18px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.24), 0 0 0 1px var(--line-strong);
  color: var(--muted);
  font-size: 13px;
  transform: translateX(-50%);
}

.whiteboard__readonly svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
}

.picker-pop-enter-active {
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-slow) var(--ease-spring);
}

.picker-pop-leave-active {
  transition: opacity var(--dur-fast) var(--ease-in), transform var(--dur-fast) var(--ease-in);
}

.picker-pop-enter-from,
.picker-pop-leave-to {
  opacity: 0;
  transform: translate(-50%, 10px) scale(.96);
}

@media (prefers-reduced-motion: reduce) {
  .whiteboard__dock {
    animation: none;
  }

  .picker-pop-enter-from,
  .picker-pop-leave-to {
    transform: translateX(-50%);
  }
}
</style>
