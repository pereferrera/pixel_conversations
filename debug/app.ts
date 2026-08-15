import { OpenAIProvider } from "../engine/provider/index.js";
import { buildDecisionContext, WorldRules } from "../engine/decision/index.js";
import { applyChange } from "../engine/decision/world-rules.js";
import { Activity, ChangeType, ConversationStatus, placeCharactersRandomly, SimulationState } from "../engine/state/index.js";
import type { CharacterProfile, Scene, SimulationSnapshot } from "../engine/state/index.js";
import { attachCharacterMoodHover, renderWorldToPng } from "../rendering/index.js";
import type { CharacterMoodHoverBinding, RenderingConfig } from "../rendering/index.js";

interface WorldFile { scene: Scene; profiles: CharacterProfile[]; rendering: RenderingConfig; state: SimulationSnapshot }

const fileInput = element<HTMLInputElement>("world-file");
const modelInput = element<HTMLInputElement>("model");
const worldTendencyInput = element<HTMLInputElement>("world-tendency");
const worldTendencyValue = element<HTMLOutputElement>("world-tendency-value");
const pomposityInput = element<HTMLInputElement>("pomposity");
const pomposityValue = element<HTMLOutputElement>("pomposity-value");
const worldDynamicInput = element<HTMLInputElement>("world-dynamic");
const worldDynamicValue = element<HTMLOutputElement>("world-dynamic-value");
const simulateButton = element<HTMLButtonElement>("simulate");
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
let world: WorldFile;
let worldImageUrl: string | null = null;
let moodHoverBinding: CharacterMoodHoverBinding | null = null;

for (const [input, output] of [
  [worldTendencyInput, worldTendencyValue],
  [pomposityInput, pomposityValue],
  [worldDynamicInput, worldDynamicValue],
] as const) {
  input.addEventListener("input", () => updateSignedSliderLabel(input, output));
  updateSignedSliderLabel(input, output);
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try { loadWorld(JSON.parse(await file.text())); setStatus(`Loaded ${file.name}`); }
  catch (error) { showError(error); }
});

simulateButton.addEventListener("click", async () => {
  try {
    world.state = JSON.parse(stateArea.value);
    const state = restoreState(world);
    state.beginSimulationIteration();
    world.state = state.snapshot();
    stateArea.value = pretty(world.state);
    const context = buildDecisionContext({ scene: world.scene, profiles: world.profiles, state: state.snapshot() });
    const provider = new OpenAIProvider({
      apiKey: "provided-by-local-proxy",
      model: modelInput.value.trim() || "gpt-5.6-luna",
      fetchImpl: captureProviderCall,
      tuning: {
        worldTendency: Number(worldTendencyInput.value),
        pomposity: Number(pomposityInput.value),
        worldDynamic: Number(worldDynamicInput.value),
      },
    });
    setBusy(true);
    const decision = await provider.decide(context);
    actionsArea.value = pretty(decision.changes);
    let applied = 0;
    let eventApplied = false;
    const skipped: string[] = [];
    for (const [index, change] of decision.changes.entries()) {
      try {
        if (change.type === ChangeType.ADD_EVENT && eventApplied) throw new Error("A simulation step may add at most one event.");
        const rules = new WorldRules({ scene: world.scene, state: state.snapshot() });
        rules.assertValid({ summary: decision.summary, changes: [change] });
        applyChange(state, change);
        if (change.type === ChangeType.ADD_EVENT) eventApplied = true;
        applied += 1;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        skipped.push(`#${index + 1} ${change.type}: ${reason}`);
        console.error(`Skipped action ${index}`, change, error);
      }
    }
    if (applied > 0) state.recordDecision(decision.summary);
    world.state = state.snapshot();
    stateArea.value = pretty(world.state);
    renderHistory(world.state.decisionHistory);
    await refreshWorldImage();
    setStatus(`Applied ${applied} of ${decision.changes.length} returned action(s).${skipped.length ? ` Skipped ${skipped.join(" · ")}` : ""}`, skipped.length > 0);
  } catch (error) { showError(error); }
  finally { setBusy(false); }
});

async function captureProviderCall(_input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const requestText = typeof init?.body === "string" ? init.body : "";
  promptArea.value = formatJson(requestText);
  rawResponseArea.value = "Waiting for response…";
  responseMeta.textContent = "";

  const response = await fetch("/api/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: init?.body,
  });
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
  .then((response) => { if (!response.ok) throw new Error(`Could not load example (${response.status}).`); return response.json(); })
  .then((value) => { loadWorld(value, true); setStatus("Example world loaded with random placements"); })
  .catch(showError);

function loadWorld(value: unknown, randomizePlacements = false): void {
  if (!value || typeof value !== "object") throw new TypeError("World JSON must be an object.");
  const candidate = value as WorldFile;
  if (!candidate.scene?.id || !Array.isArray(candidate.scene.positions)) throw new TypeError("World JSON needs scene.id and scene.positions.");
  if (!Array.isArray(candidate.profiles)) throw new TypeError("World JSON needs a profiles array.");
  if (!candidate.state?.characters) throw new TypeError("World JSON needs a state snapshot.");
  if (!candidate.rendering?.sceneDefinition || !candidate.rendering?.characterManifests || !candidate.rendering?.moodAssets) {
    throw new TypeError("World JSON needs rendering sceneDefinition, characterManifests, and moodAssets.");
  }
  if (candidate.state.sceneId !== candidate.scene.id) throw new RangeError("state.sceneId must match scene.id.");
  world = structuredClone(candidate);
  world.state = restoreState(world, randomizePlacements).snapshot();
  stateArea.value = pretty(world.state);
  actionsArea.value = "[]";
  renderHistory(world.state.decisionHistory ?? []);
  void refreshWorldImage().catch(showError);
}

async function refreshWorldImage(): Promise<void> {
  renderingMeta.textContent = "Rendering…";
  const result = await renderWorldToPng({ state: world.state, profiles: world.profiles, rendering: world.rendering });
  const nextUrl = URL.createObjectURL(result.png);
  moodHoverBinding?.destroy();
  worldImage.src = nextUrl;
  moodHoverBinding = attachCharacterMoodHover(worldImage, result.characterMoodHitRegions);
  if (worldImageUrl) URL.revokeObjectURL(worldImageUrl);
  worldImageUrl = nextUrl;
  renderingMeta.textContent = result.warnings.length ? result.warnings.join(" · ") : `${worldImage.naturalWidth || 1152}×${worldImage.naturalHeight || 648} PNG`;
  for (const warning of result.warnings) console.warn("Renderer:", warning);
}

function restoreState({ scene, state: snapshot }: WorldFile, randomizePlacements = false): SimulationState {
  const state = new SimulationState({ scene, characterIds: Object.keys(snapshot.characters) });
  for (const [id, character] of Object.entries(snapshot.characters)) {
    if (!randomizePlacements && character.positionId) state.placeCharacter(id, character.positionId, character.posture, character.facing);
    state.setMood(id, character.mood);
    if (!randomizePlacements && character.activity === Activity.SLEEPING) state.setActivity(id, Activity.SLEEPING);
    for (const memory of character.memories) state.remember(id, memory);
    for (const [toId, relationship] of Object.entries(character.relationships)) state.updateRelationship(id, toId, relationship);
  }
  if (randomizePlacements) placeCharactersRandomly({ state, scene, characterIds: Object.keys(snapshot.characters) });
  for (const conversation of Object.values(snapshot.conversations)) {
    state.startConversation({ id: conversation.id, participants: conversation.participants, topic: conversation.topic });
    for (const beat of conversation.beats) {
      if (beat.type === "say") state.addConversationTurn(conversation.id, beat);
      else state.pauseConversation(conversation.id);
    }
    if (conversation.status === ConversationStatus.CLOSING) state.endConversation(conversation.id);
  }
  const legacySnapshot = snapshot as SimulationSnapshot & { events?: Array<NonNullable<SimulationSnapshot["event"]>> };
  const activeEvent = snapshot.event ?? legacySnapshot.events?.at(-1);
  if (activeEvent) state.addEvent(activeEvent);
  for (const summary of snapshot.decisionHistory ?? []) state.recordDecision(summary);
  return state;
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing #${id}.`);
  return value as T;
}
function pretty(value: unknown): string { return JSON.stringify(value, null, 2); }
function formatJson(value: string): string {
  try { return pretty(JSON.parse(value)); }
  catch { return value; }
}
function updateSignedSliderLabel(input: HTMLInputElement, output: HTMLOutputElement): void {
  const value = Number(input.value);
  output.value = value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1);
}
function renderHistory(summaries: string[]): void {
  historyCount.textContent = String(summaries.length);
  const items = summaries.map((summary, index) => {
    const item = document.createElement("li");
    item.value = index + 1;
    item.textContent = summary;
    return item;
  });
  historyList.replaceChildren(...items);
}
function setBusy(busy: boolean): void { simulateButton.disabled = busy; simulateButton.textContent = busy ? "Simulating…" : "Simulate next step"; }
function setStatus(message: string, error = false): void { status.textContent = message; status.classList.toggle("error", error); }
function showError(error: unknown): void { console.error(error); setStatus(error instanceof Error ? error.message : String(error), true); }
