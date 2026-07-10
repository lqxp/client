/**
 * callSounds — sons UI pour les actions d'appel, générés via Web Audio API.
 * Aucun fichier audio externe requis.
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

/** Joue une séquence de bips définie par des notes { freq, duration, gap } */
function playTones(notes: { freq: number; dur: number; gap?: number }[], volume = 0.18, flag?: string): void {
  if (flag && !_flags[flag]) return;
  try {
    const ac = getCtx();
    resume(ac).then(() => {
      let t = ac.currentTime + 0.01;
      for (const note of notes) {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.connect(gain);
        gain.connect(ac.destination);

        osc.type = "sine";
        osc.frequency.setValueAtTime(note.freq, t);

        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(volume, t + 0.01);
        gain.gain.setValueAtTime(volume, t + note.dur - 0.02);
        gain.gain.linearRampToValueAtTime(0, t + note.dur);

        osc.start(t);
        osc.stop(t + note.dur);

        t += note.dur + (note.gap ?? 0.04);
      }
    }).catch(() => {});
  } catch {
    // AudioContext non disponible (SSR, test, etc.)
  }
}

/** Mute — bip sourd court */
export function playMuteSound(preview = false): void {
  playTones([{ freq: 300, dur: 0.1 }], 0.12, preview ? undefined : "mute");
}

/** Unmute — bip clair court */
export function playUnmuteSound(preview = false): void {
  playTones([{ freq: 600, dur: 0.1 }], 0.12, preview ? undefined : "unmute");
}

/** Join vocal — deux bips montants doux */
export function playJoinSound(preview = false): void {
  playTones([
    { freq: 440, dur: 0.08, gap: 0.03 },
    { freq: 660, dur: 0.12 }
  ], 0.16, preview ? undefined : "join");
}

/** Leave vocal — deux bips descendants */
export function playLeaveSound(preview = false): void {
  playTones([
    { freq: 520, dur: 0.08, gap: 0.03 },
    { freq: 340, dur: 0.14 }
  ], 0.16, preview ? undefined : "leave");
}

/** Camera enabled — short rising beep */
export function playCameraOnSound(preview = false): void {
  playTones([
    { freq: 880, dur: 0.06, gap: 0.02 },
    { freq: 1100, dur: 0.08 }
  ], 0.13, preview ? undefined : "cameraOn");
}

/** Caméra désactivée — bip court descendant */
export function playCameraOffSound(preview = false): void {
  playTones([
    { freq: 660, dur: 0.08, gap: 0.02 },
    { freq: 440, dur: 0.1 }
  ], 0.13, preview ? undefined : "cameraOff");
}

/** Partage d'écran activé — bip triple montant */
export function playScreenOnSound(preview = false): void {
  playTones([
    { freq: 520, dur: 0.06, gap: 0.02 },
    { freq: 660, dur: 0.06, gap: 0.02 },
    { freq: 880, dur: 0.1 }
  ], 0.13, preview ? undefined : "screenOn");
}

/** Screen share disabled — triple falling beep */
export function playScreenOffSound(preview = false): void {
  playTones([
    { freq: 880, dur: 0.06, gap: 0.02 },
    { freq: 660, dur: 0.06, gap: 0.02 },
    { freq: 440, dur: 0.1 }
  ], 0.13, preview ? undefined : "screenOff");
}

/** Message — bip notification */
export function playMessageSound(preview = false): void {
  playTones([
    { freq: 880, dur: 0.06, gap: 0.02 },
    { freq: 1100, dur: 0.1 }
  ], 0.14, preview ? undefined : "message");
}