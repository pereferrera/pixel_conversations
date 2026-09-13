# Music

The two background loops are intentionally quiet and
harmonically unresolved so they can repeat beneath long conversations without
demanding attention, but each is deliberately instrumented differently.

- **Soft Neon Windows** — 72 BPM, full band (pad, bass, melody, kick, rim):
  vaporwave-inspired suspended pads, rounded bass, muted electric keys,
  restrained percussion, and subtle tape texture.
- **Glass Corridor** — 54 BPM, pad and melody only, no bass or drums at all:
  near-pure tones, glacial swells, and a long dubby echo — the sparsest,
  cleanest track.
All assets are stereo 16-bit PCM WAV files at 22.05 kHz. Their oscillator
frequencies and delay lines are periodic over the exact file duration, making
them suitable for gapless looping. They contain no samples or third-party
material.

Regenerate both tracks deterministically from the repository root with:

```bash
node audio/generate-loops.mjs
```

Track ids and playback metadata live in `tracks.json`.
