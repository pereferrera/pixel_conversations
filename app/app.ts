import { applyDecision, buildDecisionContext, NEXT_DEVELOPMENT_PRESETS, rulesFor } from "../engine/decision/index.js";
import { ReadabilityPacer, renderedWorldText } from "../engine/pacing/index.js";
import { OpenAIProvider } from "../engine/provider/index.js";
import { placeCharactersRandomly, SimulationState } from "../engine/state/index.js";
import type { CharacterProfile, Scene } from "../engine/state/index.js";
import { attachCharacterMoodHover, renderWorldToPng } from "../rendering/index.js";
import type { CharacterMoodHoverBinding, RenderingConfig } from "../rendering/index.js";

interface SceneOption { id: string; label: string; definition: string; thumbnail: string }
interface CharacterOption { id: string; profile: string; manifest: string; thumbnail: string }
interface AppConfig { scenes: SceneOption[]; characters: CharacterOption[]; audioTracks: string; moodAssets: RenderingConfig["moodAssets"] }
interface CharacterDraft { option: CharacterOption; profile: CharacterProfile }
interface AudioTrack { id: string; title: string; file: string; durationSeconds: number; bpm: number; mood: string; loop: boolean }

const setup = element<HTMLElement>("setup");
const experience = element<HTMLElement>("experience");
const sceneStep = element<HTMLElement>("scene-step");
const sceneList = element<HTMLElement>("scene-list");
const characterStep = element<HTMLElement>("character-step");
const backToScenesButton = element<HTMLButtonElement>("back-to-scenes");
const characterList = element<HTMLElement>("character-list");
const enterButton = element<HTMLButtonElement>("enter-world");
const worldTitle = element<HTMLElement>("world-title");
const status = element<HTMLElement>("status");
const worldImage = element<HTMLImageElement>("world-image");
const playButton = element<HTMLButtonElement>("play");
const stopButton = element<HTMLButtonElement>("stop");
const musicPlayer = element<HTMLElement>("music-player");
const musicToggleButton = element<HTMLButtonElement>("music-toggle");
const musicTrackSelect = element<HTMLSelectElement>("music-track");
const musicVolumeInput = element<HTMLInputElement>("music-volume");
const requestedDevelopmentSelect = element<HTMLSelectElement>("requested-development");
const customDevelopmentInput = element<HTMLInputElement>("custom-development");
const tuningInputs = {
  worldTendency: element<HTMLInputElement>("world-tendency"),
  pomposity: element<HTMLInputElement>("pomposity"),
  humorousness: element<HTMLInputElement>("humorousness"),
  worldDynamic: element<HTMLInputElement>("world-dynamic"),
};

let config: AppConfig;
let selectedScene: SceneOption | null = null;
let availableProfiles = new Map<string, CharacterProfile>();
const chosen = new Map<string, CharacterDraft>();
let scene!: Scene;
let profiles: CharacterProfile[] = [];
let rendering!: RenderingConfig;
let simulationState!: SimulationState;
let running = false;
let busy = false;
let consecutiveStepFailures = 0;
let worldImageUrl: string | null = null;
let moodHoverBinding: CharacterMoodHoverBinding | null = null;
const readabilityPacer = new ReadabilityPacer();
let audioTracks: AudioTrack[] = [];
const backgroundMusic = new Audio();
let musicMuted = readMusicPreference("musicMuted") === "true";

requestedDevelopmentSelect.replaceChildren(
  selectOption("", "Let faith choose"),
  ...NEXT_DEVELOPMENT_PRESETS.map((preset) => selectOption(preset, preset)),
  selectOption("custom", "Your own…"),
);
requestedDevelopmentSelect.addEventListener("change", () => {
  customDevelopmentInput.hidden = requestedDevelopmentSelect.value !== "custom";
  if (!customDevelopmentInput.hidden) customDevelopmentInput.focus();
});

musicVolumeInput.value = readMusicPreference("musicVolume") ?? musicVolumeInput.value;
backgroundMusic.volume = Number(musicVolumeInput.value);
backgroundMusic.muted = musicMuted;
setMusicMuted(musicMuted);
musicToggleButton.addEventListener("click", () => setMusicMuted(!musicMuted));
musicVolumeInput.addEventListener("input", () => {
  backgroundMusic.volume = Number(musicVolumeInput.value);
  storeMusicPreference("musicVolume", musicVolumeInput.value);
});

void loadApp();

async function loadApp(): Promise<void> {
  try {
    config = await checkedJson<AppConfig>(await fetch("./config.json"));
    const loaded = await Promise.all(config.characters.map(async ({ profile }) => checkedJson<CharacterProfile>(await fetch(profile))));
    availableProfiles = new Map(loaded.map((profile) => [profile.id, profile]));
    await loadAudioTracks();
    renderSceneChoices();
    renderCharacterList();
  } catch (error) {
    showError(error);
  }
}

function renderSceneChoices(): void {
  sceneList.replaceChildren(...config.scenes.map((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "scene-card";
    button.setAttribute("aria-pressed", String(selectedScene?.id === option.id));
    const image = document.createElement("img");
    image.src = option.thumbnail;
    image.alt = "";
    const label = document.createElement("span");
    label.textContent = option.label;
    button.append(image, label);
    button.addEventListener("click", () => {
      selectedScene = option;
      renderSceneChoices();
      sceneStep.hidden = true;
      characterStep.hidden = false;
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    if (selectedScene?.id === option.id) button.classList.add("selected");
    return button;
  }));
}

backToScenesButton.addEventListener("click", () => {
  characterStep.hidden = true;
  sceneStep.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
});

const CUSTOMIZE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a1.003 1.003 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z"/></svg>';

function renderCharacterList(): void {
  enterButton.disabled = chosen.size === 0 || !selectedScene;
  characterList.replaceChildren(...config.characters.map((option) => {
    const draft = chosen.get(option.id);
    return draft ? chosenCard(draft) : inviteCard(option);
  }));
}

function inviteCard(option: CharacterOption): HTMLElement {
  const profile = availableProfiles.get(option.id)!;
  const card = document.createElement("article");
  card.className = "character-card";
  const summary = document.createElement("div");
  summary.className = "character-summary";
  const portrait = portraitNode(option, profile.name);
  const name = document.createElement("span");
  name.className = "character-name";
  name.textContent = profile.name;
  const invite = document.createElement("button");
  invite.type = "button";
  invite.className = "invite-character";
  invite.textContent = "Invite";
  invite.addEventListener("click", () => {
    chosen.set(option.id, { option, profile: structuredClone(profile) });
    renderCharacterList();
  });
  const actions = document.createElement("div");
  actions.className = "character-actions";
  actions.append(invite);
  summary.append(portrait, name, actions);
  card.append(summary);
  return card;
}

function chosenCard(draft: CharacterDraft): HTMLElement {
  const card = document.createElement("article");
  card.className = "character-card chosen";
  const summary = document.createElement("div");
  summary.className = "character-summary";
  const portrait = portraitNode(draft.option, draft.profile.name);
  const name = document.createElement("span");
  name.className = "character-name";
  name.textContent = draft.profile.name;
  const customizeToggle = document.createElement("button");
  customizeToggle.type = "button";
  customizeToggle.className = "customize-toggle";
  customizeToggle.setAttribute("aria-label", "Customize this character");
  customizeToggle.setAttribute("aria-expanded", "false");
  customizeToggle.title = "Customize this character";
  customizeToggle.innerHTML = CUSTOMIZE_ICON;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove-character";
  remove.setAttribute("aria-label", `Remove ${draft.profile.name}`);
  remove.textContent = "×";
  remove.addEventListener("click", () => {
    chosen.delete(draft.option.id);
    renderCharacterList();
  });
  const actions = document.createElement("div");
  actions.className = "character-actions";
  actions.append(customizeToggle, remove);
  summary.append(portrait, name, actions);

  const fields = document.createElement("div");
  fields.className = "character-fields";
  fields.hidden = true;
  customizeToggle.addEventListener("click", () => {
    const expanded = customizeToggle.getAttribute("aria-expanded") === "true";
    customizeToggle.setAttribute("aria-expanded", String(!expanded));
    fields.hidden = expanded;
  });

  const nameField = profileField("Name", draft.profile.name, false, (value) => { draft.profile.name = value; name.textContent = value || "Unnamed character"; });
  const personalityField = profileField("Personality", draft.profile.personality, true, (value) => { draft.profile.personality = value; });
  const backgroundField = profileField("Background", draft.profile.background, true, (value) => { draft.profile.background = value; });
  const regenerate = document.createElement("button");
  regenerate.type = "button";
  regenerate.className = "generate-all";
  regenerate.textContent = "Generate";
  regenerate.addEventListener("click", async () => {
    regenerate.disabled = true;
    regenerate.textContent = "Generating…";
    try {
      const [newPersonality, newBackground] = await Promise.all([
        generateProfileValue("personality", draft.profile.name, draft.profile.age),
        generateProfileValue("background", draft.profile.name, draft.profile.age),
      ]);
      personalityField.input.value = newPersonality;
      draft.profile.personality = newPersonality;
      backgroundField.input.value = newBackground;
      draft.profile.background = newBackground;
      regenerate.textContent = "Generated";
    } catch (error) {
      console.error(error);
      regenerate.textContent = "Try again";
    } finally {
      regenerate.disabled = false;
      window.setTimeout(() => { if (!regenerate.disabled) regenerate.textContent = "Generate"; }, 1400);
    }
  });
  fields.append(nameField.wrapper, fixedAgeField(draft.profile.age), personalityField.wrapper, backgroundField.wrapper, regenerate);
  card.append(summary, fields);
  return card;
}

function profileField(labelText: string, value: string, multiline: boolean, update: (value: string) => void): { wrapper: HTMLDivElement; input: HTMLInputElement | HTMLTextAreaElement } {
  const wrapper = document.createElement("div");
  wrapper.className = "profile-field";
  const heading = document.createElement("div");
  heading.className = "field-heading";
  const title = document.createElement("span");
  title.textContent = labelText;
  const input = multiline ? document.createElement("textarea") : document.createElement("input");
  input.setAttribute("aria-label", labelText);
  input.value = value;
  input.addEventListener("input", () => update(input.value));
  heading.append(title);
  wrapper.append(heading, input);
  return { wrapper, input };
}

function fixedAgeField(age: number): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.className = "profile-field";
  const heading = document.createElement("div");
  heading.className = "field-heading";
  const title = document.createElement("span");
  title.textContent = "Age";
  const fixed = document.createElement("span");
  fixed.className = "fixed-field";
  fixed.textContent = "Fixed to sprite";
  const input = document.createElement("input");
  input.value = String(age);
  input.readOnly = true;
  input.setAttribute("aria-label", "Age, fixed to character sprite");
  heading.append(title, fixed);
  wrapper.append(heading, input);
  return wrapper;
}

async function generateProfileValue(field: "personality" | "background", name: string, age: number): Promise<string> {
  const variationId = crypto.randomUUID();
  const request = field === "personality"
    ? `Invent a completely new, surprising personality for a character named ${name} in one or two short sentences, about 18 words. Return only the personality text.`
    : `Invent a completely new background for ${name}, who is exactly ${age} years old, with a random occupation, interests, and current story hook in one or two short sentences, about 22 words. Age ${age} is immutable: do not state, imply, or calculate any other age. Return only the background text.`;
  const response = await fetch("/api/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      instructions: "Generate a fresh randomized character-profile field. Do not continue, paraphrase, or infer any existing character content. You may naturally refer to the given character by their name, but never invent another named person, named place, or brand. When an immutable age is provided, preserve it exactly. Keep it grounded and free of stereotypes.",
      input: `${request}\nIndependent variation id: ${variationId}`,
      max_output_tokens: 100,
      reasoning: { effort: "none" },
      text: { verbosity: "low" },
    }),
  });
  if (!response.ok) throw new Error(`Profile generation failed (${response.status}): ${await response.text()}`);
  const text = responseOutputText(await response.json())?.trim().replace(/^['"]|['"]$/g, "");
  if (!text) throw new Error("Profile generation returned no text.");
  return text;
}

function responseOutputText(payload: any): string | null {
  if (typeof payload?.output_text === "string" && payload.output_text.length) return payload.output_text;
  if (!Array.isArray(payload?.output)) return null;
  const text = payload.output
    .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
    .filter((part: any) => part?.type === "output_text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("");
  return text || null;
}

enterButton.addEventListener("click", () => void enterWorld());
playButton.addEventListener("click", startPlaying);
stopButton.addEventListener("click", () => {
  running = false;
  updatePlayback();
  setStatus(busy ? "Pausing after this moment…" : "The world is resting.");
});

async function enterWorld(): Promise<void> {
  if (!selectedScene || chosen.size === 0) return;
  enterButton.disabled = true;
  startBackgroundMusic();
  try {
    scene = await checkedJson<Scene>(await fetch(selectedScene.definition));
    profiles = [...chosen.values()].map(({ profile }) => ({ ...profile, name: profile.name.trim() || "Unnamed character", personality: profile.personality.trim(), background: profile.background.trim() }));
    rendering = {
      sceneDefinition: selectedScene.definition,
      characterManifests: Object.fromEntries([...chosen.values()].map(({ option }) => [option.id, option.manifest])),
      moodAssets: structuredClone(config.moodAssets),
    };
    simulationState = new SimulationState({ scene, characterIds: profiles.map(({ id }) => id) });
    placeCharactersRandomly({ state: simulationState, scene, characterIds: profiles.map(({ id }) => id) });
    worldTitle.textContent = selectedScene.label;
    setup.hidden = true;
    experience.hidden = false;
    await refreshWorldImage();
    experience.scrollIntoView({ behavior: "smooth", block: "start" });
    startPlaying();
  } catch (error) {
    enterButton.disabled = false;
    showError(error);
  }
}

function startPlaying(): void {
  if (running) return;
  running = true;
  updatePlayback();
  setStatus("The world is coming to life…");
  if (!busy) void runNextStep();
}

async function runNextStep(): Promise<void> {
  if (busy || !running) return;
  busy = true;
  updatePlayback();
  try {
    simulationState.beginSimulationIteration();
    const requested = requestedDevelopment();
    const context = buildDecisionContext({
      scene,
      profiles,
      state: simulationState.snapshot(),
      tuning: {
        worldTendency: Number(tuningInputs.worldTendency.value),
        pomposity: Number(tuningInputs.pomposity.value),
        humorousness: Number(tuningInputs.humorousness.value),
        worldDynamic: Number(tuningInputs.worldDynamic.value),
        requestedDevelopment: requested,
      },
    });
    const provider = new OpenAIProvider({ apiKey: "provided-by-local-proxy", fetchImpl: proxyFetch });
    setStatus("Imagining what happens next…");
    const decision = await provider.decide(context);
    const remaining = readabilityPacer.remainingMs();
    if (remaining > 0) setStatus("Giving you a moment to finish reading…");
    await readabilityPacer.waitUntilReadable();
    applyDecision(simulationState, decision, rulesFor(context));
    await refreshWorldImage();
    consecutiveStepFailures = 0;
    setStatus(running ? "Watching…" : "The world is resting.");
  } catch (error) {
    console.error(error);
    consecutiveStepFailures += 1;
    const retryDelayMs = Math.min(1_000 * 2 ** (consecutiveStepFailures - 1), 30_000);
    setStatus(`That moment did not work. The world will try again in ${Math.ceil(retryDelayMs / 1_000)}s…`);
    await wait(retryDelayMs);
  } finally {
    busy = false;
    updatePlayback();
  }
  if (running) void runNextStep();
}

async function refreshWorldImage(): Promise<void> {
  const state = simulationState.snapshot();
  const result = await renderWorldToPng({ state, profiles, rendering });
  const nextUrl = URL.createObjectURL(result.png);
  worldImage.src = nextUrl;
  await worldImage.decode();
  moodHoverBinding?.destroy();
  moodHoverBinding = attachCharacterMoodHover(worldImage, result.characterMoodHitRegions);
  if (worldImageUrl) URL.revokeObjectURL(worldImageUrl);
  worldImageUrl = nextUrl;
  readabilityPacer.markRendered(renderedWorldText(state));
}

async function proxyFetch(_input: string | URL | Request, init?: RequestInit): Promise<Response> {
  return fetch("/api/responses", { method: "POST", headers: { "Content-Type": "application/json" }, body: init?.body });
}

async function loadAudioTracks(): Promise<void> {
  try {
    audioTracks = await checkedJson<AudioTrack[]>(await fetch(config.audioTracks));
  } catch (error) {
    console.error(error);
    audioTracks = [];
  }
  musicPlayer.hidden = audioTracks.length === 0;
  musicTrackSelect.replaceChildren(...audioTracks.map((track, index) => selectOption(String(index), track.title)));
  musicTrackSelect.addEventListener("change", () => playTrack(Number(musicTrackSelect.value)));
}

function startBackgroundMusic(): void {
  if (!audioTracks.length || backgroundMusic.src) return;
  playTrack(Math.floor(Math.random() * audioTracks.length));
}

function playTrack(index: number): void {
  const track = audioTracks[index];
  if (!track) return;
  musicTrackSelect.value = String(index);
  backgroundMusic.src = new URL(track.file, new URL(config.audioTracks, location.href)).href;
  backgroundMusic.loop = track.loop;
  void backgroundMusic.play().catch((error) => console.error(error));
}

function setMusicMuted(muted: boolean): void {
  musicMuted = muted;
  backgroundMusic.muted = muted;
  const label = muted ? "Turn on background music" : "Turn off background music";
  musicToggleButton.setAttribute("aria-pressed", String(!muted));
  musicToggleButton.setAttribute("aria-label", label);
  musicToggleButton.title = label;
  musicToggleButton.querySelector(".icon-on")?.toggleAttribute("hidden", muted);
  musicToggleButton.querySelector(".icon-off")?.toggleAttribute("hidden", !muted);
  storeMusicPreference("musicMuted", String(muted));
}

function readMusicPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storeMusicPreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures (e.g. private browsing); the session default still applies.
  }
}

function portraitNode(option: CharacterOption, name: string): HTMLDivElement {
  const portrait = document.createElement("div");
  portrait.className = "portrait";
  const image = document.createElement("img");
  image.src = option.thumbnail;
  image.alt = name;
  portrait.append(image);
  return portrait;
}

function updatePlayback(): void {
  playButton.disabled = running || busy;
  stopButton.disabled = !running;
}

function setStatus(message: string): void { status.textContent = message; }
function wait(durationMs: number): Promise<void> { return new Promise((resolve) => window.setTimeout(resolve, durationMs)); }
function requestedDevelopment(): string | null { const value = requestedDevelopmentSelect.value === "custom" ? customDevelopmentInput.value.trim() : requestedDevelopmentSelect.value; return value || null; }
function selectOption(value: string, label: string): HTMLOptionElement { const item = document.createElement("option"); item.value = value; item.textContent = label; return item; }
function showError(error: unknown): void { console.error(error); setStatus("Something interrupted the world. Please reload and try again."); }
function element<T extends HTMLElement>(id: string): T { const value = document.getElementById(id); if (!value) throw new Error(`Missing #${id}.`); return value as T; }
async function checkedJson<T>(response: Response): Promise<T> { if (!response.ok) throw new Error(`Could not load ${response.url}.`); return response.json() as Promise<T>; }
