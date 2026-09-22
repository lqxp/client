<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";

const props = defineProps<{ active: boolean }>();

const COVERED =
  ".msg__avatar, .reply-ref__avatar, .bubble__author > span:first-child," +
  " .jumbo__author, .reply-ref__username, .reply-ref__text, .reply-card__author, .reply-card__text," +
  " .bubble__text, .att-file-meta, .embed__body, .reactions, .jumbo__glyph, .att-image-link," +
  " .audio-player, .video-player, .embed__media";

const SELECTOR = `.msg.is-streamer-blur :is(${COVERED}), .spoiler`;
const BLUR_RE = /blur\(([\d.]+)px\)/;

const DENSITY = 2.2 / 100; // per px2; the reference 8 reads as white static here
const MAX_ALPHA = 0.5; // the blur underneath does the hiding, the dots only veil it
const MAX_PARTICLES = 14000;
const LIFE_MIN = 80;
const LIFE_MAX = 150;
const DRIFT = 0.05;
const MEASURE_MS = 60; // re-reading layout every frame would be the whole cost
const BASE_BLUR = 5; // fallback when --redact-blur is not set on the element

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  alpha: number;
  holeX: number;
  holeY: number;
  holeR: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  region: number;
}

const canvas = ref<HTMLCanvasElement | null>(null);
let ctx: CanvasRenderingContext2D | null = null;
let frame = 0;
let lastMeasure = 0;
let regions: Region[] = [];
let weights: number[] = [];
let totalArea = 0;
let particles: Particle[] = [];
let dpr = 1;
let dotColor = "255, 255, 255";
const buckets: number[][] = [[], [], [], [], [], []];

function readDotColor() {
  const probe = getComputedStyle(document.documentElement).getPropertyValue("--text").trim();
  if (!probe) return;
  const el = document.createElement("span");
  el.style.color = probe;
  document.body.appendChild(el);
  const rgb = getComputedStyle(el).color.match(/\d+/g);
  el.remove();
  if (rgb && rgb.length >= 3) dotColor = `${rgb[0]}, ${rgb[1]}, ${rgb[2]}`;
}

let bounds = { x: 0, y: 0, w: 0, h: 0 };

/**
 * The cloud is clipped to the message feed. A viewport-wide canvas painted its
 * dots over the thread header and the composer, which sit above the feed and
 * must stay legible.
 */
function resize() {
  const el = canvas.value;
  if (!el) return;
  const feed = document.querySelector(".feed");
  const rect = feed?.getBoundingClientRect();
  bounds = rect
    ? { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
    : { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };

  dpr = Math.min(window.devicePixelRatio || 1, 2);
  el.style.left = `${bounds.x}px`;
  el.style.top = `${bounds.y}px`;
  el.style.width = `${bounds.w}px`;
  el.style.height = `${bounds.h}px`;
  el.width = Math.max(1, Math.floor(bounds.w * dpr));
  el.height = Math.max(1, Math.floor(bounds.h * dpr));
  ctx = el.getContext("2d");
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function measure() {
  resize();
  const found: Region[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(SELECTOR)) {
    // The blur is a CSS transition, so its live radius says how far along a
    // reveal is; fading the dots on the same value keeps them in step without
    // repeating the timing here.
    const style = getComputedStyle(el);
    const blur = Number.parseFloat(BLUR_RE.exec(style.filter || "")?.[1] ?? "0");
    const base = Number.parseFloat(style.getPropertyValue("--redact-blur")) || BASE_BLUR;
    if (blur <= 0.02) continue;
    const alpha = Math.min(1, blur / base);
    // How far the reveal has run, 0 while fully hidden and 1 once clear.
    const progress = 1 - alpha;
    const originX = Number.parseFloat(el.style.getPropertyValue("--reveal-x"));
    const originY = Number.parseFloat(el.style.getPropertyValue("--reveal-y"));

    // Line boxes, not the bounding box: a wrapped sentence must get one cloud
    // per line rather than one rectangle over the whole paragraph.
    for (const rect of el.getClientRects()) {
      if (rect.bottom < bounds.y - 40 || rect.top > bounds.y + bounds.h + 40) continue;
      if (rect.right < bounds.x || rect.left > bounds.x + bounds.w) continue;
      if (rect.width < 2 || rect.height < 2) continue;
      const x = rect.left - bounds.x;
      const y = rect.top - bounds.y;
      // The hole opens from the pointer, so the clearing sweeps outwards from
      // where the reader actually is rather than fading everywhere at once.
      const hx = Number.isFinite(originX) ? originX : rect.width / 2;
      const hy = Number.isFinite(originY) ? originY : rect.height / 2;
      const reach = Math.hypot(Math.max(hx, rect.width - hx), Math.max(hy, rect.height - hy));
      found.push({
        x,
        y,
        w: rect.width,
        h: rect.height,
        alpha,
        holeX: hx,
        holeY: hy,
        holeR: progress <= 0 ? 0 : progress * reach * 1.25
      });
    }
  }

  regions = found;
  weights = [];
  totalArea = 0;
  for (const region of regions) {
    totalArea += region.w * region.h;
    weights.push(totalArea);
  }
}

function pickRegion(): number {
  if (!regions.length) return -1;
  const target = Math.random() * totalArea;
  for (let i = 0; i < weights.length; i += 1) if (target <= weights[i]) return i;
  return weights.length - 1;
}

function spawn(particle: Particle) {
  const index = pickRegion();
  if (index < 0) {
    particle.life = 0;
    return;
  }
  const region = regions[index];
  const angle = Math.random() * Math.PI * 2;
  const speed = DRIFT * (0.2 + Math.random() * 0.8);
  particle.region = index;
  particle.x = region.x + Math.random() * region.w;
  particle.y = region.y + Math.random() * region.h;
  particle.vx = Math.cos(angle) * speed;
  particle.vy = Math.sin(angle) * speed;
  particle.age = Math.random() * 12; // stagger, so the cloud never pulses as one
  particle.life = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN);
  particle.size = 0.7 + Math.random() * 0.7;
}

function syncPopulation() {
  const wanted = Math.min(MAX_PARTICLES, Math.round(totalArea * DENSITY));
  while (particles.length < wanted) {
    const particle: Particle = { x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 0, size: 1, region: -1 };
    spawn(particle);
    particles.push(particle);
  }
  if (particles.length > wanted) particles.length = wanted;
}

function lifeAlpha(ratio: number): number {
  if (ratio < 0.2) return ratio / 0.2;
  if (ratio > 0.67) return (1 - ratio) / 0.33;
  return 1;
}

function draw(now: number) {
  frame = requestAnimationFrame(draw);
  const context = ctx;
  if (!context) return;

  if (now - lastMeasure > MEASURE_MS) {
    lastMeasure = now;
    measure();
    syncPopulation();
  }

  context.clearRect(0, 0, bounds.w, bounds.h);
  if (!regions.length) return;

  for (const bucket of buckets) bucket.length = 0;
  for (const particle of particles) {
    particle.age += 1;
    if (particle.age >= particle.life || particle.region >= regions.length) {
      spawn(particle);
      continue;
    }
    particle.x += particle.vx;
    particle.y += particle.vy;

    const region = regions[particle.region];
    if (
      particle.x < region.x ||
      particle.x > region.x + region.w ||
      particle.y < region.y ||
      particle.y > region.y + region.h
    ) {
      spawn(particle);
      continue;
    }

    if (region.holeR > 0) {
      const dx = particle.x - (region.x + region.holeX);
      const dy = particle.y - (region.y + region.holeY);
      if (dx * dx + dy * dy < region.holeR * region.holeR) continue;
    }

    const alpha = lifeAlpha(particle.age / particle.life) * region.alpha * MAX_ALPHA;
    if (alpha <= 0.04) continue;
    const bucket = buckets[Math.min(5, Math.floor((alpha / MAX_ALPHA) * 6))];
    bucket.push(particle.x, particle.y, particle.size);
  }

  for (let i = 0; i < buckets.length; i += 1) {
    const bucket = buckets[i];
    if (!bucket.length) continue;
    context.fillStyle = `rgba(${dotColor}, ${(((i + 0.5) / 6) * MAX_ALPHA).toFixed(3)})`;
    for (let j = 0; j < bucket.length; j += 3) {
      context.fillRect(bucket[j], bucket[j + 1], bucket[j + 2], bucket[j + 2]);
    }
  }
}

let themeWatcher: MutationObserver | null = null;

function start() {
  if (frame) return;
  readDotColor();
  resize();
  window.addEventListener("resize", resize);
  // The dots are drawn from --text, which changes with the theme.
  themeWatcher = new MutationObserver(() => readDotColor());
  themeWatcher.observe(document.documentElement, { attributeFilter: ["data-theme"] });
  frame = requestAnimationFrame(draw);
}

function stop() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  window.removeEventListener("resize", resize);
  themeWatcher?.disconnect();
  themeWatcher = null;
  particles = [];
  regions = [];
  ctx?.clearRect(0, 0, bounds.w, bounds.h);
}

watch(
  () => props.active,
  (on) => {
    if (on) requestAnimationFrame(() => start());
    else stop();
  },
  { immediate: true }
);

onBeforeUnmount(stop);
</script>

<template>
  <Teleport to="body">
    <canvas v-if="props.active" ref="canvas" class="spoiler-canvas" aria-hidden="true"></canvas>
  </Teleport>
</template>

<style>
.spoiler-canvas {
  position: fixed;
  z-index: 4;
  pointer-events: none;
  contain: layout paint;
}

@media (prefers-reduced-motion: reduce) {
  .spoiler-canvas {
    display: none;
  }
}
</style>
