import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "assets/audio");
const SAMPLE_RATE = 22_050;
mkdirSync(OUT, { recursive: true });

// Every track is assembled from the same six additive-synthesis voices —
// pad, bass, melody, kick, rim, and hat — plus a circular echo. What makes
// each track actually sound different is which voices are switched on
// (hasPad/hasBass/hasMelody/hasKick/hasRim/hasHat), how busy their rhythm is,
// and per-voice harmonic mixes/envelope shapes/echo/grain. A track that
// drops a whole voice (no pad, no drums, ...) reads as differently
// instrumented, not just differently mixed.
const tracks = [
  {
    filename: "soft-neon-windows.wav",
    bpm: 72,
    bars: 8,
    seed: 1987,
    hasPad: true, hasBass: true, hasMelody: true, hasKick: true, hasRim: true, hasHat: false,
    chords: [[50, 57, 62, 64, 69], [47, 54, 59, 62, 66], [43, 50, 55, 59, 64], [45, 52, 57, 59, 64], [50, 57, 62, 64, 69], [47, 54, 59, 62, 66], [43, 50, 55, 59, 64], [45, 52, 57, 61, 64]],
    bass: [38, 35, 31, 33, 38, 35, 31, 33],
    melody: [[0.75, 74], [2.5, 69], [4.75, 71], [6.5, 66], [8.75, 67], [10.5, 64], [12.75, 69], [14.5, 73], [16.75, 74], [18.5, 69], [20.75, 71], [22.5, 66], [24.75, 67], [26.5, 64], [28.75, 69], [30.5, 73]],
    bassOnsets: [0, 2],
    kickGain: 0.065,
    kickDecay: 22,
    rimOffset: 1,
    rimGain: 0.035,
    padHarmonics: [[1, 1], [2, 0.32], [0.5, 0.12]],
    padAttack: 0.42,
    padRelease: 0.65,
    bassHarmonics: [[1, 1], [2, 0.22]],
    melodyHarmonics: [[1, 1], [2, 0.38], [3, 0.12]],
    melodyLength: 0.82,
    melodyAttack: 0.025,
    melodyRelease: 0.28,
    echoBeats: 0.75,
    echoAmount: 0.19,
    airAmount: 0.0045,
  },
  {
    // Ambient minimalism: pad and melody only — no bass, no drums at all.
    // Near-pure tones, glacial swells, and a long dubby echo.
    filename: "glass-corridor.wav",
    bpm: 54,
    bars: 8,
    seed: 2077,
    hasPad: true, hasBass: false, hasMelody: true, hasKick: false, hasRim: false, hasHat: false,
    chords: [[45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [48, 55, 60, 64, 67], [40, 47, 52, 55, 59], [45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [48, 55, 60, 64, 67], [40, 47, 52, 55, 60]],
    melody: pattern([0.75], [76, 77, 79, 71, 76, 77, 79, 72], 8),
    padHarmonics: [[1, 1], [3, 0.1], [1.5, 0.08]],
    padAttack: 1.4,
    padRelease: 1.6,
    melodyHarmonics: [[1, 1], [3, 0.3], [5, 0.08]],
    melodyLength: 2.2,
    melodyAttack: 0.05,
    melodyRelease: 2.0,
    echoBeats: 1.5,
    echoAmount: 0.32,
    airAmount: 0.002,
  },
];

for (const track of tracks) {
  const duration = track.bars * 4 * 60 / track.bpm;
  const frames = Math.round(duration * SAMPLE_RATE);
  const exactDuration = frames / SAMPLE_RATE;
  const left = new Float64Array(frames);
  const right = new Float64Array(frames);
  let randomState = track.seed >>> 0;
  const random = () => ((randomState = (1664525 * randomState + 1013904223) >>> 0) / 0x100000000) * 2 - 1;
  const hz = (midi) => periodicFrequency(440 * 2 ** ((midi - 69) / 12), exactDuration);

  for (let index = 0; index < frames; index += 1) {
    const t = index / SAMPLE_RATE;
    const beat = t * track.bpm / 60;
    const bar = Math.floor(beat / 4) % track.bars;
    const inBar = beat % 4;
    let l = 0;
    let r = 0;

    if (track.hasPad) {
      for (const [voice, note] of track.chords[bar].entries()) {
        const frequency = hz(note);
        const phase = 2 * Math.PI * frequency * t;
        const padEnvelope = smoothPulse(inBar, 0, 4, track.padAttack, track.padRelease);
        const shimmer = harmonics(track.padHarmonics, phase);
        const drift = 0.96 + 0.04 * Math.sin(2 * Math.PI * periodicFrequency(0.08 + voice * 0.013, exactDuration) * t);
        const sample = shimmer * padEnvelope * drift * 0.042;
        const pan = -0.72 + voice * 1.44 / Math.max(1, track.chords[bar].length - 1);
        l += sample * (1 - pan * 0.32);
        r += sample * (1 + pan * 0.32);
      }
    }

    if (track.hasBass) {
      const bassFrequency = hz(track.bass[bar]);
      for (const start of track.bassOnsets) {
        const age = inBar - start;
        if (age >= 0 && age < 1.15) {
          const envelope = softEnvelope(age, 1.15, 0.035, 0.35);
          const bassPhase = 2 * Math.PI * bassFrequency * t;
          const bass = harmonics(track.bassHarmonics, bassPhase) * envelope * 0.13;
          l += bass;
          r += bass;
        }
      }
    }

    if (track.hasMelody) {
      for (const [start, note] of track.melody) {
        const age = beat - start;
        if (age >= 0 && age < track.melodyLength) {
          const envelope = softEnvelope(age, track.melodyLength, track.melodyAttack, track.melodyRelease);
          const frequency = hz(note);
          const phase = 2 * Math.PI * frequency * t;
          const key = harmonics(track.melodyHarmonics, phase) * envelope * 0.075;
          const pan = Math.sin(start * 1.7) * 0.45;
          l += key * (1 - pan);
          r += key * (1 + pan);
        }
      }
    }

    if (track.hasKick) {
      const kickPhase = inBar % 2;
      if (kickPhase < 0.22) {
        const envelope = Math.exp(-kickPhase * track.kickDecay);
        const kick = Math.sin(2 * Math.PI * (48 + 42 * envelope) * t) * envelope * track.kickGain;
        l += kick;
        r += kick;
      }
    }
    if (track.hasRim) {
      const rimAge = ((inBar - track.rimOffset + 4) % 4);
      if (rimAge < 0.075) {
        const rim = random() * Math.exp(-rimAge * 58) * track.rimGain;
        l += rim * 0.72;
        r += rim;
      }
    }
    if (track.hasHat) {
      const hatAge = (beat * track.hatDensity) % 1;
      if (hatAge < 0.05) {
        const hat = random() * Math.exp(-hatAge * 140) * track.hatGain;
        l += hat;
        r += hat * 0.85;
      }
    }

    const air = random() * track.airAmount;
    const wow = Math.sin(2 * Math.PI * periodicFrequency(0.19, exactDuration) * t) * 0.004;
    left[index] = l + air + wow;
    right[index] = r + air - wow;
  }

  applyCircularEcho(left, Math.round(SAMPLE_RATE * 60 / track.bpm * track.echoBeats), track.echoAmount);
  applyCircularEcho(right, Math.round(SAMPLE_RATE * 60 / track.bpm * track.echoBeats), track.echoAmount);
  normalizeStereo(left, right, 0.78);
  writeWav(resolve(OUT, track.filename), left, right, SAMPLE_RATE);
  console.log(`${track.filename}: ${exactDuration.toFixed(3)}s, ${track.bpm} BPM`);
}

// Repeats a one-bar rhythmic cell (beat offsets within a 4-beat bar) across
// `bars` bars, assigning each hit the next pitch from a cycling pitch list.
function pattern(cellBeats, pitchCycle, bars) {
  const events = [];
  for (let bar = 0; bar < bars; bar += 1) {
    for (let i = 0; i < cellBeats.length; i += 1) {
      const step = bar * cellBeats.length + i;
      events.push([bar * 4 + cellBeats[i], pitchCycle[step % pitchCycle.length]]);
    }
  }
  return events;
}
function harmonics(pairs, phase) {
  let sum = 0;
  for (const [ratio, weight] of pairs) sum += weight * Math.sin(phase * ratio);
  return sum;
}
function periodicFrequency(frequency, duration) { return Math.max(1, Math.round(frequency * duration)) / duration; }
function smoothstep(value) { return value * value * (3 - 2 * value); }
function softEnvelope(age, length, attack, release) {
  const attackGain = smoothstep(Math.min(1, age / attack));
  const releaseGain = smoothstep(Math.min(1, (length - age) / release));
  return attackGain * releaseGain;
}
function smoothPulse(position, start, end, attack, release) {
  return softEnvelope(position - start, end - start, attack, release);
}
function applyCircularEcho(signal, delay, amount) {
  const original = signal.slice();
  for (let i = 0; i < signal.length; i += 1) signal[i] += original[(i - delay + signal.length) % signal.length] * amount;
}
function normalizeStereo(left, right, peak) {
  let maximum = 0;
  for (let i = 0; i < left.length; i += 1) maximum = Math.max(maximum, Math.abs(left[i]), Math.abs(right[i]));
  const gain = maximum ? peak / maximum : 1;
  for (let i = 0; i < left.length; i += 1) { left[i] *= gain; right[i] *= gain; }
}
function writeWav(filename, left, right, sampleRate) {
  const frames = left.length;
  const dataBytes = frames * 4;
  const buffer = Buffer.allocUnsafe(44 + dataBytes);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write("WAVE", 8);
  buffer.write("fmt ", 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 4, 28); buffer.writeUInt16LE(4, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0, offset = 44; i < frames; i += 1, offset += 4) {
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), offset);
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), offset + 2);
  }
  writeFileSync(filename, buffer);
}
