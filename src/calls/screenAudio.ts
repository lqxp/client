// Native system-audio capture bridge for screen sharing.
//
// Tauri desktop WebViews (WebView2/WKWebView/WebKitGTK) cannot capture system
// audio through `getDisplayMedia({ audio: true })`. The Rust `screen-audio`
// plugin captures the system mix (WASAPI loopback on Windows, PipeWire/Pulse
// monitor on Linux, ScreenCaptureKit on macOS) and streams little-endian mono
// f32 @ 48 kHz samples to this module over a binary Tauri `Channel`. We feed
// those samples into an `AudioWorklet` whose output is a
// `MediaStreamAudioDestinationNode`, producing a real `MediaStreamTrack` that
// the WebRTC layer can negotiate like any other audio track.
//
// The microphone is a completely separate concept and is never touched here.

import { invoke, Channel } from "@tauri-apps/api/core";

const SAMPLE_RATE = 48_000;
// Ring buffer size in frames (2^N for cheap masking).
const RING_BITS = 15;
const RING_SIZE = 1 << RING_BITS; // 32768 frames ≈ 0.68 s @ 48 kHz

export function isTauriDesktopRuntime() {
  if (typeof window === "undefined") return false;
  const candidate = window as any;
  if (!(candidate.__TAURI_INTERNALS__ || candidate.__TAURI__)) return false;
  const ua = String(navigator?.userAgent || "").toLowerCase();
  return !ua.includes("android") && !/iphone|ipad|ipod/.test(ua);
}

interface ActiveCapture {
  track: MediaStreamTrack;
  ctx: AudioContext;
  worklet: AudioWorkletNode;
}

let active: ActiveCapture | null = null;

// SharedArrayBuffer layout:
//   [0]  = write cursor (frames)
//   [1]  = read cursor (frames)
//   [2..] = Float32Array mono samples
function writeCursor(sb: SharedArrayBuffer): Int32Array {
  return new Int32Array(sb, 0, 2);
}
function sampleView(sb: SharedArrayBuffer): Float32Array {
  return new Float32Array(sb, 8, RING_SIZE);
}

/**
 * Starts native system-audio capture and returns a live audio track.
 *
 * Returns `null` when the capture cannot start (unsupported platform, no
 * monitor device, missing macOS permission, …). The caller keeps sharing video
 * in that case.
 */
export async function startSystemAudioCapture(): Promise<MediaStreamTrack | null> {
  if (active) return active.track;

  // Ring buffer shared between the JS event listener (producer) and the audio
  // worklet (consumer), allocated before the Rust side starts producing.
  let sb: SharedArrayBuffer;
  try {
    sb = new SharedArrayBuffer(8 + RING_SIZE * 4);
  } catch {
    // SharedArrayBuffer unavailable (some WebKitGTK builds without
    // cross-origin isolation) → report unavailable and keep video-only.
    return null;
  }

  // Build the audio graph first so the track exists before samples arrive.
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });

  const processorSrc = `
    const RING_MASK = ${RING_SIZE - 1};
    class ScreenAudioProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        this.state = null;
        this.samples = null;
        this.port.onmessage = (e) => {
          this.state = new Int32Array(e.data.heap, 0, 2);
          this.samples = new Float32Array(e.data.heap, 8, ${RING_SIZE});
        };
      }
      process(_inputs, outputs) {
        const output = outputs[0];
        if (!output || !output[0] || !this.samples) return true;
        const dest = output[0];
        for (let i = 0; i < dest.length; i++) {
          const write = Atomics.load(this.state, 0);
          const read = Atomics.load(this.state, 1);
          if (write === read) {
            dest[i] = 0; // underrun → silence
          } else {
            dest[i] = this.samples[read];
            Atomics.store(this.state, 1, (read + 1) & RING_MASK);
          }
        }
        return true;
      }
    }
    registerProcessor("screen-audio-processor", ScreenAudioProcessor);
  `;

  const blob = new Blob([processorSrc], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }

  const worklet = new AudioWorkletNode(ctx, "screen-audio-processor", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  worklet.port.postMessage({ heap: sb });

  const destination = ctx.createMediaStreamDestination();
  worklet.connect(destination);
  // Do NOT connect the worklet to ctx.destination: monitoring the captured
  // mix back through the user's speakers would cause feedback.

  const track = destination.stream.getAudioTracks()[0];

  // Producer: receives raw little-endian f32 mono bytes from the Rust plugin
  // via a binary Channel and writes them into the shared ring.
  const channel = new Channel<ArrayBuffer>();
  channel.onmessage = (data) => {
    const bytes = new Uint8Array(data);
    const len = bytes.length - (bytes.length % 4);
    if (len === 0) return;

    const state = writeCursor(sb);
    const samples = sampleView(sb);
    const view = new DataView(bytes.buffer, bytes.byteOffset, len);

    const count = len / 4;
    let write = Atomics.load(state, 0);
    for (let i = 0; i < count; i++) {
      const s = view.getFloat32(i * 4, true);
      samples[write & (RING_SIZE - 1)] = s;
      // If we are about to lap the reader, drop the oldest unread sample.
      const read = Atomics.load(state, 1);
      if (((write + 1) & (RING_SIZE - 1)) === read) {
        Atomics.store(state, 1, (read + 1) & (RING_SIZE - 1));
      }
      write = (write + 1) & (RING_SIZE - 1);
    }
    Atomics.store(state, 0, write);
  };

  // Start the native capture, passing the channel so the backend streams into
  // it directly (no JSON event serialization), and the real AudioContext
  // sample rate so the backend resamples to it exactly (no pitch shift).
  try {
    await invoke("plugin:screen-audio|start", { channel, sampleRate: ctx.sampleRate });
  } catch {
    // Cannot start native capture (unsupported/no device/permission denied).
    // Tear down the graph we just built and report unavailable.
    try {
      worklet.disconnect();
    } catch {
      /* noop */
    }
    try {
      track.stop();
    } catch {
      /* noop */
    }
    try {
      await ctx.close();
    } catch {
      /* noop */
    }
    return null;
  }

  active = { track, ctx, worklet };
  return track;
}

/** Stops native system-audio capture and tears down the audio graph. */
export async function stopSystemAudioCapture() {
  if (!active) return;
  const capture = active;
  active = null;

  try {
    capture.worklet.disconnect();
  } catch {
    /* noop */
  }
  try {
    capture.track.stop();
  } catch {
    /* noop */
  }
  try {
    await capture.ctx.close();
  } catch {
    /* noop */
  }
  try {
    await invoke("plugin:screen-audio|stop");
  } catch {
    /* noop */
  }
}
