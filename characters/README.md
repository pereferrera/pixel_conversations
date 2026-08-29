# Characters

This folder contains the simulation's fixed roster of ten editable character
profiles. A profile intentionally has five fields:

- `id`: stable kebab-case identifier used by state and assets.
- `name`: display name.
- `age`: fixed age matched to the character's production sprite.
- `personality`: two or three sentences describing temperament and conversation style.
- `background`: two or three sentences describing the character's life, work,
  interests, knowledge, and current story hooks.

`age`, `personality`, and `background` are sent to the decision model. Age is an
immutable identity attribute; the two plain-text behavioural fields remain
editable without requiring the UI to understand a nested schema.

Profiles are private character direction, not shared knowledge. Each character
knows their own background; they learn about other people only through witnessed
events, conversation history, and their own stored memories.

## Sprite contract

Production poses use a 48 × 128 px transparent canvas with hard alpha and
nearest-neighbour pixels. Standing sprites use foot baseline `(24, 111)`.
Sitting and seated-sleeping sprites use contact anchors `(34, 74)` facing left
and `(13, 74)` facing right. Right-facing side poses are exact horizontal
mirrors of their left-facing versions.

Awake assets use `{posture}/{direction}/neutral-idle.png`; seated sleeping uses
`sitting-sleeping/{direction}/sleeping.png`. Character manifests select these
files while mood is rendered separately as a shared icon.
