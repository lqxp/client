/**
 * callSounds.ts for Sonic Branding for QxChat
 * Generated via Web Audio API. No external files required.
 */

let ctx: AudioContext | null = null;

// Granular per-sound enable flags (all on by default)
const _flags: Record<string, boolean> = {
  join: true,
  leave: true,
  mute: true,
  unmute: true,
  cameraOn: true,
  cameraOff: true,
  screenOn: true,
  screenOff: true,
  message: true
};

export function setSoundFlag(key: string, value: boolean): void {
  if (key in _flags) _flags[key] = value;
}

export function getSoundFlag(key: string): boolean {
  return _flags[key] ?? true;
}

/** @deprecated use setSoundFlag per-sound */
export function setCallSoundsActive(value: boolean): void {
  for (const key of Object.keys(_flags)) _flags[key] = value;
}

function getCtx(): AudioContext {
  if (!ctx || ctx.state === "closed") {
    ctx = new AudioContext();
  }
  return ctx;
}

function resume(ac: AudioContext): Promise<void> {
  return ac.state === "suspended" ? ac.resume() : Promise.resolve();
}

interface SynthNote {
  f: number;             // Frequency Hz
  fEnd?: number;         // End frequency Hz for pitch bends
  d: number;             // Total note duration
  t: number;             // Delay before playing the note
  type?: OscillatorType; // Waveform: 'sine', 'triangle', 'square', 'sawtooth'
  v?: number;            // Volume multiplier (0 to 1)
}

function playSynth(notes: SynthNote[], globalVolume = 0.15, flag?: string): void {
  if (flag && !_flags[flag]) return;
  try {
    const ac = getCtx();
    resume(ac).then(() => {
      const now = ac.currentTime;

      notes.forEach(note => {
        const t = now + note.t;
        const osc = ac.createOscillator();
        const gain = ac.createGain();

        osc.connect(gain);
        gain.connect(ac.destination);

        osc.type = note.type || "sine";

        osc.frequency.setValueAtTime(note.f, t);
        if (note.fEnd) {
          osc.frequency.exponentialRampToValueAtTime(note.fEnd, t + note.d);
        }

        const noteVol = (note.v || 1) * globalVolume;

        const attack = 0.015;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(noteVol, t + attack);
        gain.gain.exponentialRampToValueAtTime(0.00001, t + note.d);

        osc.start(t);
        osc.stop(t + note.d);
      });
    }).catch(() => {});
  } catch { }
}

export function playMuteSound(preview = false): void {
  playSynth([
    { f: 440.00, d: 0.15, t: 0.00, type: "sine", v: 0.4 }, // A4
    { f: 329.63, d: 0.20, t: 0.03, type: "sine", v: 0.5 }  // E4
  ], 0.14, preview ? undefined : "mute");
}

export function playUnmuteSound(preview = false): void {
  playSynth([
    { f: 329.63, d: 0.15, t: 0.00, type: "sine", v: 0.4 }, // E4
    { f: 440.00, d: 0.25, t: 0.04, type: "sine", v: 0.5 }  // A4
  ], 0.14, preview ? undefined : "unmute");
}

export function playJoinSound(preview = false): void {
  playSynth([
    { f: 523.25,  d: 0.60, t: 0.00, type: "sine", v: 0.4 }, // C5
    { f: 783.99,  d: 0.65, t: 0.03, type: "sine", v: 0.5 }, // G5
    { f: 1174.66, d: 0.70, t: 0.06, type: "sine", v: 0.6 }  // D6
  ], 0.15, preview ? undefined : "join");
}

export function playLeaveSound(preview = false): void {
  playSynth([
    { f: 1174.66, d: 0.30, t: 0.00, type: "sine", v: 0.4 }, // D6
    { f: 783.99,  d: 0.40, t: 0.03, type: "sine", v: 0.4 }, // G5
    { f: 523.25,  d: 0.50, t: 0.06, type: "sine", v: 0.5 }  // C5
  ], 0.15, preview ? undefined : "leave");
}

export function playMessageSound(preview = false): void {
  playSynth([
    { f: 1046.50, d: 0.45, t: 0.00, type: "sine", v: 0.8 }, // C6
    { f: 1567.98, d: 0.50, t: 0.02, type: "sine", v: 0.3 }  // G6
  ], 0.15, preview ? undefined : "message");
}

export function playCameraOnSound(preview = false): void {
  playSynth([
    { f: 523.25,  d: 0.10, t: 0.00, type: "sine", v: 0.6 },
    { f: 1046.50, d: 0.20, t: 0.07, type: "sine", v: 0.9 }
  ], 0.12, preview ? undefined : "cameraOn");
}

export function playCameraOffSound(preview = false): void {
  playSynth([
    { f: 783.99, d: 0.10, t: 0.00, type: "sine", v: 0.7 },
    { f: 392.00, d: 0.15, t: 0.07, type: "sine", v: 0.5 }
  ], 0.12, preview ? undefined : "cameraOff");
}

export function playScreenOnSound(preview = false): void {
  playSynth([
    { f: 261.63, d: 0.8, t: 0.00, type: "sine", v: 0.6 },
    { f: 329.63, d: 0.8, t: 0.03, type: "sine", v: 0.5 },
    { f: 392.00, d: 0.8, t: 0.06, type: "sine", v: 0.4 }
  ], 0.16, preview ? undefined : "screenOn");
}

export function playScreenOffSound(preview = false): void {
  playSynth([
    { f: 392.00, d: 0.4, t: 0.00, type: "sine", v: 0.4 },
    { f: 329.63, d: 0.4, t: 0.02, type: "sine", v: 0.5 },
    { f: 261.63, d: 0.4, t: 0.04, type: "sine", v: 0.6 }
  ], 0.16, preview ? undefined : "screenOff");
}
