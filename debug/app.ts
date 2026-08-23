import { OpenAIProvider } from "../engine/provider/index.js";
import { ReadabilityPacer, renderedWorldText } from "../engine/pacing/index.js";
import { applyDecision, buildDecisionContext, NEXT_DEVELOPMENT_PRESETS, rulesFor } from "../engine/decision/index.js";
import { deserializeSimulationState, placeCharactersRandomly, serializeSimulationState, SimulationState } from "../engine/state/index.js";
import type { CharacterProfile, Scene } from "../engine/state/index.js";
import { attachCharacterMoodHover, renderWorldToPng } from "../rendering/index.js";
import type { CharacterMoodHoverBinding, RenderingConfig } from "../rendering/index.js";

interface SceneOption { id: string; label: string; definition: string }
interface CharacterOption { id: string; profile: string; manifest: string; enabled?: boolean }
interface DebugConfig { scenes: SceneOption[]; characters: CharacterOption[]; moodAssets: RenderingConfig["moodAssets"] }
interface CharacterEditor { option: CharacterOption; profile: CharacterProfile; enabled: HTMLInputElement; personality: HTMLTextAreaElement; background: HTMLTextAreaElement }
interface World { scene: Scene; profiles: CharacterProfile[]; rendering: RenderingConfig; state: ReturnType<SimulationState["snapshot"]> }

const fileInput = element<HTMLInputElement>("world-file");
const sceneSelect = element<HTMLSelectElement>("scene-select");
const characterControls = element<HTMLElement>("character-controls");
const modelInput = element<HTMLInputElement>("model");
const worldTendencyInput = element<HTMLInputElement>("world-tendency");
const worldTendencyValue = element<HTMLOutputElement>("world-tendency-value");
const pomposityInput = element<HTMLInputElement>("pomposity");
const pomposityValue = element<HTMLOutputElement>("pomposity-value");
const humorousnessInput = element<HTMLInputElement>("humorousness");
const humorousnessValue = element<HTMLOutputElement>("humorousness-value");
const worldDynamicInput = element<HTMLInputElement>("world-dynamic");
const worldDynamicValue = element<HTMLOutputElement>("world-dynamic-value");
const requestedDevelopmentSelect = element<HTMLSelectElement>("requested-development");
const customDevelopmentInput = element<HTMLInputElement>("custom-development");
const simulateButton = element<HTMLButtonElement>("simulate");
const autoSimulateInput = element<HTMLInputElement>("auto-simulate");
const promptArea = element<HTMLTextAreaElement>("provider-request");
const rawResponseArea = element<HTMLTextAreaElement>("raw-response");
const stateArea = element<HTMLTextAreaElement>("world-state");
const actionsArea = element<HTMLTextAreaElement>("actions");
const historyList = element<HTMLOListElement>("simulation-history");
const historyCount = element<HTMLElement>("history-count");
const responseMeta = element<HTMLElement>("response-meta");
const status = element<HTMLElement>("status");
const worldImage = element<HTMLImageElement>("world-image");
const renderingMeta = element<HTMLElement>("rendering-meta");
let config: DebugConfig;
let editors = new Map<string, CharacterEditor>();
let world: World;
let simulationState: SimulationState;
let displayedStateJson = "";
let worldImageUrl: string | null = null;
let moodHoverBinding: CharacterMoodHoverBinding | null = null;
let simulationBusy = false;
const readabilityPacer = new ReadabilityPacer();

requestedDevelopmentSelect.replaceChildren(
  option("", "Let faith choose"),
  ...NEXT_DEVELOPMENT_PRESETS.map((preset) => option(preset, preset)),
  option("custom", "Your own…"),
);
requestedDevelopmentSelect.addEventListener("change", () => {
  customDevelopmentInput.hidden = requestedDevelopmentSelect.value !== "custom";
  if (!customDevelopmentInput.hidden) customDevelopmentInput.focus();
});

for (const [input, output] of [[worldTendencyInput, worldTendencyValue], [pomposityInput, pomposityValue], [humorousnessInput, humorousnessValue], [worldDynamicInput, worldDynamicValue]] as const) {
  input.addEventListener("input", () => updateSignedSliderLabel(input, output));
  updateSignedSliderLabel(input, output);
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try { await loadConfig(JSON.parse(await file.text())); setStatus(`Loaded ${file.name}`); }
  catch (error) { showError(error); }
});
sceneSelect.addEventListener("change", () => void resetWorld("Scene changed; placements randomized"));
simulateButton.addEventListener("click", () => void simulateNextStep());
autoSimulateInput.addEventListener("change", () => { if (autoSimulateInput.checked && !simulationBusy) void simulateNextStep(); });

async function simulateNextStep(): Promise<void> {
  if (simulationBusy) return;
  const paceApplication = autoSimulateInput.checked;
  try {
    syncProfileOverrides();
    if (stateArea.value !== displayedStateJson) simulationState = deserializeSimulationState(stateArea.value, { scene: world.scene });
    simulationState.beginSimulationIteration();
    publishState();
    const requested = requestedDevelopment();
    const context = buildDecisionContext({
      scene: world.scene,
      profiles: world.profiles,
      state: simulationState.snapshot(),
      tuning: { worldTendency: Number(worldTendencyInput.value), pomposity: Number(pomposityInput.value), humorousness: Number(humorousnessInput.value), worldDynamic: Number(worldDynamicInput.value), requestedDevelopment: requested },
    });
    const provider = new OpenAIProvider({ apiKey: "provided-by-local-proxy", model: modelInput.value.trim() || "gpt-5.6-luna", fetchImpl: captureProviderCall });
    setBusy(true);
    const decision = await provider.decide(context);
    actionsArea.value = pretty(decision.changes);
    if (paceApplication) {
      const remainingMs = readabilityPacer.remainingMs();
      if (remainingMs > 0) setStatus(`Response ready; waiting ${(remainingMs / 1_000).toFixed(1)}s for the current text to be read.`);
      await readabilityPacer.waitUntilReadable();
    }
    applyDecision(simulationState, decision, rulesFor(context));
    publishState();
    renderHistory(world.state.decisionHistory);
    await refreshWorldImage();
    setStatus(`Applied all ${decision.changes.length} returned action(s).`);
  } catch (error) { autoSimulateInput.checked = false; showError(error); }
  finally { setBusy(false); }
  if (autoSimulateInput.checked) void simulateNextStep();
}

async function captureProviderCall(_input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const requestText = typeof init?.body === "string" ? init.body : "";
  promptArea.value = formatJson(requestText);
  rawResponseArea.value = "Waiting for response…";
  responseMeta.textContent = "";
  const response = await fetch("/api/responses", { method: "POST", headers: { "Content-Type": "application/json" }, body: init?.body });
  const rawText = await response.clone().text();
  rawResponseArea.value = formatJson(rawText);
  const details = [`HTTP ${response.status}`];
  const requestId = response.headers.get("x-request-id");
  const processingMs = response.headers.get("openai-processing-ms");
  if (requestId) details.push(`request ${requestId}`);
  if (processingMs) details.push(`${processingMs} ms`);
  responseMeta.textContent = details.join(" · ");
  return response;
}

void fetch("./example-world.json")
  .then(checkedJson<DebugConfig>)
  .then((value) => loadConfig(value))
  .then(() => setStatus("Example loaded with four characters and random placements"))
  .catch(showError);

async function loadConfig(value: unknown): Promise<void> {
  if (!value || typeof value !== "object") throw new TypeError("Debug config must be an object.");
  const candidate = value as DebugConfig;
  if (!Array.isArray(candidate.scenes) || candidate.scenes.length === 0) throw new TypeError("Debug config needs scenes.");
  if (!Array.isArray(candidate.characters) || candidate.characters.length === 0) throw new TypeError("Debug config needs characters.");
  config = structuredClone(candidate);
  sceneSelect.replaceChildren(...config.scenes.map((scene) => option(scene.id, scene.label)));
  const loadedProfiles = await Promise.all(config.characters.map(async (character) => checkedJson<CharacterProfile>(await fetch(character.profile))));
  editors = new Map(config.characters.map((character, index) => [character.id, makeCharacterEditor(character, loadedProfiles[index])]));
  characterControls.replaceChildren(...[...editors.values()].map(editor => editor.enabled.closest("fieldset")!));
  await resetWorld();
}

function makeCharacterEditor(option: CharacterOption, profile: CharacterProfile): CharacterEditor {
  if (profile.id !== option.id) throw new RangeError(`Profile id ${profile.id} does not match ${option.id}.`);
  const fieldset = document.createElement("fieldset");
  fieldset.className = "character-editor";
  const legend = document.createElement("legend");
  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.checked = option.enabled !== false;
  legend.append(enabled, ` ${profile.name}`);
  const personality = textEditor("Personality", profile.personality);
  const background = textEditor("Background", profile.background);
  fieldset.append(legend, personality.label, background.label);
  const editor = { option, profile: structuredClone(profile), enabled, personality: personality.area, background: background.area };
  enabled.addEventListener("change", () => {
    if (![...editors.values()].some(item => item.enabled.checked)) { enabled.checked = true; setStatus("At least one character must be enabled", true); return; }
    fieldset.classList.toggle("disabled", !enabled.checked);
    void resetWorld("Character selection changed; placements randomized");
  });
  fieldset.classList.toggle("disabled", !enabled.checked);
  return editor;
}

function textEditor(title: string, value: string): { label: HTMLLabelElement; area: HTMLTextAreaElement } {
  const label = document.createElement("label");
  const titleNode = document.createElement("span");
  titleNode.textContent = title;
  const area = document.createElement("textarea");
  area.value = value;
  area.rows = 5;
  label.append(titleNode, area);
  return { label, area };
}

async function resetWorld(message?: string): Promise<void> {
  setBusy(true);
  try {
    const sceneOption = config.scenes.find(({ id }) => id === sceneSelect.value) ?? config.scenes[0];
    const scene = await checkedJson<Scene>(await fetch(sceneOption.definition));
    const selected = [...editors.values()].filter(({ enabled }) => enabled.checked);
    const profiles = selected.map(({ profile, personality, background }) => ({ ...profile, personality: personality.value.trim(), background: background.value.trim() }));
    const rendering: RenderingConfig = {
      sceneDefinition: sceneOption.definition,
      characterManifests: Object.fromEntries(selected.map(({ option }) => [option.id, option.manifest])),
      moodAssets: structuredClone(config.moodAssets),
    };
    simulationState = new SimulationState({ scene, characterIds: profiles.map(({ id }) => id) });
    placeCharactersRandomly({ state: simulationState, scene, characterIds: profiles.map(({ id }) => id) });
    world = { scene, profiles, rendering, state: simulationState.snapshot() };
    publishState();
    actionsArea.value = "[]";
    renderHistory([]);
    await refreshWorldImage();
    if (message) setStatus(message);
  } catch (error) { showError(error); }
  finally { setBusy(false); }
}

function syncProfileOverrides(): void {
  world.profiles = world.profiles.map((profile) => {
    const editor = editors.get(profile.id)!;
    return { ...profile, personality: editor.personality.value.trim(), background: editor.background.value.trim() };
  });
}

async function refreshWorldImage(): Promise<void> {
  renderingMeta.textContent = "Rendering…";
  const result = await renderWorldToPng({ state: world.state, profiles: world.profiles, rendering: world.rendering });
  const nextUrl = URL.createObjectURL(result.png);
  moodHoverBinding?.destroy();
  worldImage.src = nextUrl;
  await worldImage.decode();
  moodHoverBinding = attachCharacterMoodHover(worldImage, result.characterMoodHitRegions);
  if (worldImageUrl) URL.revokeObjectURL(worldImageUrl);
  worldImageUrl = nextUrl;
  readabilityPacer.markRendered(renderedWorldText(world.state));
  renderingMeta.textContent = result.warnings.length ? result.warnings.join(" · ") : "PNG ready";
}

function publishState(): void { world.state = simulationState.snapshot(); displayedStateJson = serializeSimulationState(world.state, 2); stateArea.value = displayedStateJson; }
function element<T extends HTMLElement>(id: string): T { const value = document.getElementById(id); if (!value) throw new Error(`Missing #${id}.`); return value as T; }
function option(value: string, label: string): HTMLOptionElement { const item = document.createElement("option"); item.value = value; item.textContent = label; return item; }
async function checkedJson<T>(response: Response): Promise<T> { if (!response.ok) throw new Error(`Could not load ${response.url} (${response.status}).`); return response.json() as Promise<T>; }
function pretty(value: unknown): string { return JSON.stringify(value, null, 2); }
function formatJson(value: string): string { try { return pretty(JSON.parse(value)); } catch { return value; } }
function updateSignedSliderLabel(input: HTMLInputElement, output: HTMLOutputElement): void { const value = Number(input.value); output.value = value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1); }
function requestedDevelopment(): string | null { const value = requestedDevelopmentSelect.value === "custom" ? customDevelopmentInput.value.trim() : requestedDevelopmentSelect.value; return value || null; }
function renderHistory(summaries: string[]): void { historyCount.textContent = String(summaries.length); historyList.replaceChildren(...summaries.map((summary, index) => { const item = document.createElement("li"); item.value = index + 1; item.textContent = summary; return item; })); }
function setBusy(busy: boolean): void { simulationBusy = busy; simulateButton.disabled = busy; simulateButton.textContent = busy ? "Working…" : "Simulate next step"; }
function setStatus(message: string, error = false): void { status.textContent = message; status.classList.toggle("error", error); }
function showError(error: unknown): void { console.error(error); setStatus(error instanceof Error ? error.message : String(error), true); }
