import { applyDecision, buildDecisionContext, NEXT_DEVELOPMENT_PRESETS, rulesFor } from "../engine/decision/index.js";
import { ReadabilityPacer, renderedWorldText } from "../engine/pacing/index.js";
import { OpenAIProvider } from "../engine/provider/index.js";
import { placeCharactersRandomly, SimulationState } from "../engine/state/index.js";
import type { CharacterProfile, Scene } from "../engine/state/index.js";
import { attachCharacterMoodHover, renderWorldToPng } from "../rendering/index.js";
import type { CharacterMoodHoverBinding, RenderingConfig } from "../rendering/index.js";

interface SceneOption { id: string; label: string; definition: string; thumbnail: string }
interface CharacterOption { id: string; profile: string; manifest: string; thumbnail: string }
interface AppConfig { scenes: SceneOption[]; characters: CharacterOption[]; moodAssets: RenderingConfig["moodAssets"] }
interface CharacterDraft { option: CharacterOption; profile: CharacterProfile }

const setup = element<HTMLElement>("setup");
const experience = element<HTMLElement>("experience");
const sceneStep = element<HTMLElement>("scene-step");
const sceneList = element<HTMLElement>("scene-list");
const characterStep = element<HTMLElement>("character-step");
const backToScenesButton = element<HTMLButtonElement>("back-to-scenes");
const characterList = element<HTMLElement>("character-list");
const chosenWrap = element<HTMLElement>("chosen-wrap");
const chosenList = element<HTMLElement>("chosen-list");
const enterButton = element<HTMLButtonElement>("enter-world");
const worldTitle = element<HTMLElement>("world-title");
const status = element<HTMLElement>("status");
const worldImage = element<HTMLImageElement>("world-image");
const playButton = element<HTMLButtonElement>("play");
const stopButton = element<HTMLButtonElement>("stop");
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
let worldImageUrl: string | null = null;
let moodHoverBinding: CharacterMoodHoverBinding | null = null;
const readabilityPacer = new ReadabilityPacer();

requestedDevelopmentSelect.replaceChildren(
  selectOption("", "Let faith choose"),
  ...NEXT_DEVELOPMENT_PRESETS.map((preset) => selectOption(preset, preset)),
  selectOption("custom", "Your own…"),
);
requestedDevelopmentSelect.addEventListener("change", () => {
  customDevelopmentInput.hidden = requestedDevelopmentSelect.value !== "custom";
  if (!customDevelopmentInput.hidden) customDevelopmentInput.focus();
});

void loadApp();

async function loadApp(): Promise<void> {
  try {
    config = await checkedJson<AppConfig>(await fetch("./config.json"));
    const loaded = await Promise.all(config.characters.map(async ({ profile }) => checkedJson<CharacterProfile>(await fetch(profile))));
    availableProfiles = new Map(loaded.map((profile) => [profile.id, profile]));
    renderSceneChoices();
    renderCharacterChoices();
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

function renderCharacterChoices(): void {
  characterList.replaceChildren(...config.characters.map((option) => {
    const profile = availableProfiles.get(option.id)!;
    const card = document.createElement("article");
    card.className = "character-choice";
    const portrait = portraitNode(option, profile.name);
    const content = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = profile.name;
    const add = document.createElement("button");
    add.type = "button";
    add.className = "add-character";
    add.textContent = chosen.has(option.id) ? "Invited" : "Invite";
    add.disabled = chosen.has(option.id);
    add.addEventListener("click", () => {
      chosen.set(option.id, { option, profile: structuredClone(profile) });
      renderCharacterChoices();
      renderChosenCharacters();
    });
    content.append(name, add);
    card.append(portrait, content);
    return card;
  }));
}

function renderChosenCharacters(): void {
  chosenWrap.hidden = chosen.size === 0;
  enterButton.disabled = chosen.size === 0 || !selectedScene;
  chosenList.replaceChildren(...[...chosen.values()].map((draft) => {
    const card = document.createElement("article");
    card.className = "chosen-character";
    const summary = document.createElement("div");
    summary.className = "chosen-summary";
    const portrait = portraitNode(draft.option, draft.profile.name);
    const name = document.createElement("span");
    name.className = "chosen-name";
    name.textContent = draft.profile.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-character";
    remove.setAttribute("aria-label", `Remove ${draft.profile.name}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      chosen.delete(draft.option.id);
      renderCharacterChoices();
      renderChosenCharacters();
    });
    summary.append(portrait, name, remove);
    const details = document.createElement("details");
    const detailsLabel = document.createElement("summary");
    detailsLabel.textContent = "Make this character your own";
    const fields = document.createElement("div");
    fields.className = "character-fields";
    fields.append(
      profileField("Name", "name", draft, false, (value) => { draft.profile.name = value; name.textContent = value || "Unnamed character"; }),
      fixedAgeField(draft.profile.age),
      profileField("Personality", "personality", draft, true, (value) => { draft.profile.personality = value; }),
      profileField("Background", "background", draft, true, (value) => { draft.profile.background = value; }),
    );
    details.append(detailsLabel, fields);
    card.append(summary, details);
    return card;
  }));
}

function profileField(labelText: string, field: keyof Pick<CharacterProfile, "name" | "personality" | "background">, draft: CharacterDraft, multiline: boolean, update: (value: string) => void): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.className = "profile-field";
  const heading = document.createElement("div");
  heading.className = "field-heading";
  const title = document.createElement("span");
  title.textContent = labelText;
  const input = multiline ? document.createElement("textarea") : document.createElement("input");
  input.setAttribute("aria-label", labelText);
  input.value = draft.profile[field];
  input.addEventListener("input", () => update(input.value));
  const generate = document.createElement("button");
  generate.type = "button";
  generate.className = "generate-field";
  generate.textContent = "Generate";
  generate.addEventListener("click", async () => {
    generate.disabled = true;
    generate.textContent = "Generating…";
    try {
      const value = await generateProfileValue(field, draft.option.id, draft.profile.age);
      input.value = value;
      update(value);
      generate.textContent = "Generated";
    } catch (error) {
      console.error(error);
      generate.textContent = "Try again";
    } finally {
      generate.disabled = false;
      window.setTimeout(() => { if (!generate.disabled) generate.textContent = "Generate"; }, 1400);
    }
  });
  heading.append(title, generate);
  wrapper.append(heading, input);
  return wrapper;
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

async function generateProfileValue(field: "name" | "personality" | "background", characterId: string, age: number): Promise<string> {
  const variationId = crypto.randomUUID();
  const request = field === "name"
    ? `Invent a completely new ${characterGender(characterId)} given name from any culture. Return exactly one word and nothing else.`
    : field === "personality"
      ? "Invent a completely new, surprising personality in one or two short sentences, about 18 words. Use only they/their pronouns. Do not include any personal names. Return only the personality text."
      : `Invent a completely new background for a person who is exactly ${age} years old, with a random occupation, interests, and current story hook in one or two short sentences, about 22 words. Age ${age} is immutable: do not state, imply, or calculate any other age. Start with 'They'. Use only they/their pronouns. Do not include any personal names, named relatives, named acquaintances, named places, or brands. Return only the background text.`;
  const response = await fetch("/api/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      instructions: "Generate a fresh randomized character-profile field. Do not continue, paraphrase, or infer any existing character content. For personality and background fields, never invent or output a personal name. When an immutable age is provided, preserve it exactly. Keep it grounded and free of stereotypes.",
      input: `${request}\nIndependent variation id: ${variationId}`,
      max_output_tokens: 100,
      reasoning: { effort: "none" },
      text: { verbosity: "low" },
    }),
  });
  if (!response.ok) throw new Error(`Profile generation failed (${response.status}): ${await response.text()}`);
  const text = responseOutputText(await response.json())?.trim().replace(/^['"]|['"]$/g, "");
  if (!text) throw new Error("Profile generation returned no text.");
  return field === "name" ? text.split(/\s+/)[0] : text;
}

function characterGender(characterId: string): "feminine" | "masculine" {
  return new Set(["amara-vale", "celia-nwosu", "elise-morrow", "grace-kim", "ines-petrov"]).has(characterId) ? "feminine" : "masculine";
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
playButton.addEventListener("click", () => {
  if (running) return;
  running = true;
  updatePlayback();
  setStatus("The world is coming to life…");
  if (!busy) void runNextStep();
});
stopButton.addEventListener("click", () => {
  running = false;
  updatePlayback();
  setStatus(busy ? "Pausing after this moment…" : "The world is resting.");
});

async function enterWorld(): Promise<void> {
  if (!selectedScene || chosen.size === 0) return;
  enterButton.disabled = true;
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
    setStatus("Ready when you are.");
    experience.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    enterButton.disabled = false;
    showError(error);
  }
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
    setStatus(running ? "Watching…" : "The world is resting.");
  } catch (error) {
    running = false;
    showError(error);
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
function requestedDevelopment(): string | null { const value = requestedDevelopmentSelect.value === "custom" ? customDevelopmentInput.value.trim() : requestedDevelopmentSelect.value; return value || null; }
function selectOption(value: string, label: string): HTMLOptionElement { const item = document.createElement("option"); item.value = value; item.textContent = label; return item; }
function showError(error: unknown): void { console.error(error); setStatus("Something interrupted the world. Please reload and try again."); }
function element<T extends HTMLElement>(id: string): T { const value = document.getElementById(id); if (!value) throw new Error(`Missing #${id}.`); return value as T; }
async function checkedJson<T>(response: Response): Promise<T> { if (!response.ok) throw new Error(`Could not load ${response.url}.`); return response.json() as Promise<T>; }
