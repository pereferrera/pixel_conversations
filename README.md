# Pixel Conversations

## Overview

Pixel Conversations is a lightweight, browser-based simulation where small pixel-art characters engage in AI-generated conversations inside carefully crafted scenes.

The experience is intentionally minimalistic and atmospheric. Rather than focusing on gameplay, the project aims to create a living diorama: a small world where conversations naturally emerge while the user observes, tweaks a few parameters, and enjoys the ambience.

Everything runs entirely in the browser.

---

# Project Goals

The project prioritizes:

- Simplicity
- Artistic presentation
- Smooth performance
- Modular architecture
- Easy experimentation

This is **not** intended to become a full simulation game. Instead, it should feel closer to an interactive art piece or a digital zen garden populated by conversational characters.

---

# Technical Decisions

## Frontend Only

The entire application runs client-side.

There is:

- no backend
- no database
- no authentication
- no persistence layer

Refreshing the page resets the simulation.

Future persistence can always be added later, but it is intentionally outside the scope of this project.

---

## AI Provider

All conversations are generated through external AI APIs.

The engine communicates with providers through an abstraction layer, making it possible to swap providers without affecting the rest of the application.

Example providers may include:

- OpenAI
- Anthropic
- Google Gemini
- OpenRouter

The simulation engine never depends directly on a specific provider.

---

# Simulation Constraints

To keep the project lightweight and focused, all assets are finite.

## Characters

There are exactly **10 characters**.

- 5 male
- 5 female

Each character has predefined attributes, for example:

- name
- appearance
- personality
- interests
- conversational style

Characters are reusable across every scene.

---

## Scenes

There are exactly **6 scenes**.

Examples might include:

- park
- café
- library
- rooftop
- beach
- forest

Each scene defines:

- background artwork
- ambient effects
- available seating/positions
- visual mood

Scenes are static pixel-art environments.

---

## Music

There are exactly **7 ambient music tracks**.

Each track is designed to support a particular atmosphere rather than attract attention.

Examples:

- rain
- café ambience
- soft piano
- lo-fi
- synth pads
- forest ambience
- nighttime

Music loops continuously and can be selected by the user.

---

# User Interaction

The user is an observer.

Rather than controlling the characters directly, the user adjusts parameters that influence the simulation.

Possible controls include:

- conversation speed
- friendliness
- creativity
- randomness
- memory length
- scene selection
- music selection
- pause/resume simulation

The simulation reacts continuously as settings change.

---

# Architecture

The project is organized into small, focused modules.

```
.
├── scenes
├── engine
│   ├── provider
│   └── state
├── characters
├── audio
└── control
```

---

# Directory Responsibilities

## `/scenes`

Contains all visual environments.

Responsibilities:

- scene definitions
- background artwork
- scene metadata
- character placement
- visual effects

---

## `/engine`

The heart of the simulation.

Responsible for:

- simulation loop
- scheduling conversations
- event generation
- character interactions
- orchestration

The engine should remain independent from rendering.

---

## `/engine/provider`

Contains AI provider implementations.

Responsibilities:

- prompt construction
- API requests
- response parsing
- provider abstraction

Every provider exposes a common interface so the simulation can switch providers without changing engine logic.

---

## `/engine/state`

Stores the simulation state.

Examples include:

- active conversations
- character moods
- memories
- relationships
- current scene
- simulation parameters

This module contains no rendering logic.

---

## `/characters`

Contains all character definitions.

Each character includes:

- sprite assets
- profile
- personality
- default behavior
- metadata

No runtime logic should live here.

---

## `/audio`

Responsible for all sound.

Includes:

- ambient music
- sound effects
- playback
- volume control
- music selection

---

## `/control`

Contains the user interface.

Responsibilities include:

- sliders
- dropdowns
- buttons
- pause/play
- parameter editing

Controls communicate with the engine through well-defined interfaces.

---

# Guiding Principles

Throughout development, the following principles should guide every decision.

## Keep it small

A limited number of characters, scenes, and music tracks is a feature, not a limitation.

---

## Keep it modular

Rendering, simulation, AI providers, audio, and controls should remain independent whenever possible.

---

## Keep it expressive

The goal is not realism.

Simple pixel animations, subtle ambient music, and well-written conversations should create the feeling of a living world.

---

## Keep it observable

The user watches the simulation unfold.

The project should encourage curiosity rather than optimization or competition.

---

# Long-Term Vision

The project should feel like opening a tiny window into another world.

The characters talk.

They react.

They remember.

They drift through beautiful pixel-art scenes while soft ambient music plays.

The user simply sits back, adjusts a few parameters, and enjoys watching a small world come alive.
