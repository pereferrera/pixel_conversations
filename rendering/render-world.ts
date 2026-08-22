import { Activity } from "../engine/state/index.js";
import type { CharacterProfile, CharacterState, FacingDirection, SimulationSnapshot } from "../engine/state/index.js";
import { moodOverlayBounds } from "./mood.js";
import type { CharacterMoodHitRegion, MoodOverlay } from "./mood.js";
import { drawLatestSpeech, wrapText } from "./speech.js";

interface Point { x: number; y: number }
interface RenderPosition {
  id: string;
  renderer?: { kind: "standing"; baseline: Point } | { kind: "seat"; elementInstanceId: string; seatId: string };
}
interface ElementType {
  asset: string;
  canvas: { width: number; height: number };
  placementAnchor: Point;
  seats: Array<{ id: string; contactAnchor: Point }>;
}
interface SceneInstance { id: string; kind: string; type?: string; anchor?: Point; depthBaselineY: number }
interface RenderScene {
  id: string;
  canvas: { width: number; height: number; characterDisplayScale: number; elementDisplayScale: number };
  assets: { background: string };
  elementTypes: Record<string, ElementType>;
  positions: RenderPosition[];
  example: { instances: SceneInstance[] };
}
interface CharacterManifest {
  logicalCanvas: { width: number; height: number };
  standing: { footBaselineY: number; horizontalCenterX: number };
  sitting: { seatContactAnchors: Record<"left" | "right", Point> };
  sittingSleeping: { seatContactAnchors: Record<"left" | "right", Point> };
  assets: Record<string, string>;
}
export interface RenderingConfig {
  sceneDefinition: string;
  characterManifests: Record<string, string>;
  moodAssets: Partial<Record<CharacterState["mood"]["emotionalState"], string>>;
}
export interface RenderWorldRequest { state: SimulationSnapshot; profiles: CharacterProfile[]; rendering: RenderingConfig }
export interface RenderWorldResult { png: Blob; warnings: string[]; characterMoodHitRegions: CharacterMoodHitRegion[] }
interface Drawable { depth: number; url: string; x: number; y: number; width: number; height: number; moodUrl?: string; characterScale?: number }

/** Render one serializable world snapshot into a PNG without exposing canvas logic to callers. */
export async function renderWorldToPng({ state, profiles, rendering }: RenderWorldRequest): Promise<RenderWorldResult> {
  const warnings: string[] = [];
  const sceneUrl = absoluteUrl(rendering.sceneDefinition);
  const scene = await getJson<RenderScene>(sceneUrl);
  if (scene.id !== state.sceneId) throw new RangeError(`Rendering scene ${scene.id} does not match world scene ${state.sceneId}.`);
  const canvas = document.createElement("canvas");
  canvas.width = scene.canvas.width;
  canvas.height = scene.canvas.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser does not support 2D canvas rendering.");
  context.imageSmoothingEnabled = false;
  context.drawImage(await loadImage(new URL(scene.assets.background, sceneUrl).href), 0, 0, canvas.width, canvas.height);

  const drawables: Drawable[] = [];
  const characterMoodHitRegions: CharacterMoodHitRegion[] = [];
  const elementInstances = new Map<string, SceneInstance>();
  for (const instance of scene.example.instances.filter(({ kind }) => kind === "element")) {
    if (!instance.type || !instance.anchor) continue;
    const element = scene.elementTypes[instance.type];
    if (!element) { warnings.push(`Unknown element type ${instance.type}.`); continue; }
    elementInstances.set(instance.id, instance);
    const scale = scene.canvas.elementDisplayScale;
    drawables.push({
      depth: instance.depthBaselineY,
      url: new URL(element.asset, sceneUrl).href,
      x: instance.anchor.x - element.placementAnchor.x * scale,
      y: instance.anchor.y - element.placementAnchor.y * scale,
      width: element.canvas.width * scale,
      height: element.canvas.height * scale,
    });
  }

  const manifests = await Promise.all(Object.entries(state.characters).map(async ([characterId, character]) => {
    const manifestPath = rendering.characterManifests[characterId];
    if (!manifestPath) return [characterId, character, null, null] as const;
    const manifestUrl = absoluteUrl(manifestPath);
    return [characterId, character, await getJson<CharacterManifest>(manifestUrl), manifestUrl] as const;
  }));
  const speakerAnchors = new Map<string, Point>();
  for (const [characterId, character, manifest, manifestUrl] of manifests) {
    if (!character.positionId) continue;
    if (!manifest || !manifestUrl) { warnings.push(`No production sprite manifest for ${characterId}.`); continue; }
    const position = scene.positions.find(({ id }) => id === character.positionId);
    if (!position?.renderer) { warnings.push(`No renderer binding for position ${character.positionId}.`); continue; }
    const positionRenderer = position.renderer;
    const facing = sideFacing(character.facing);
    const sleeping = character.activity === Activity.SLEEPING;
    const assetKey = characterAssetKey(character);
    const asset = manifest.assets[assetKey];
    if (!asset) { warnings.push(`Missing ${assetKey} sprite for ${characterId}.`); continue; }
    const moodPath = sleeping || character.mood.emotionalState === "neutral"
      ? undefined
      : rendering.moodAssets[character.mood.emotionalState];
    if (!sleeping && character.mood.emotionalState !== "neutral" && !moodPath) {
      warnings.push(`Missing shared ${character.mood.emotionalState} mood asset.`);
    }
    const scale = scene.canvas.characterDisplayScale;
    let contact: Point;
    let depth: number;
    let characterAnchor: Point;
    if (positionRenderer.kind === "standing") {
      contact = positionRenderer.baseline;
      characterAnchor = { x: manifest.standing.horizontalCenterX, y: manifest.standing.footBaselineY };
      depth = contact.y;
    } else {
      const instance = elementInstances.get(positionRenderer.elementInstanceId);
      if (!instance?.type || !instance.anchor) { warnings.push(`Missing element ${positionRenderer.elementInstanceId}.`); continue; }
      const element = scene.elementTypes[instance.type];
      const seat = element?.seats.find(({ id }) => id === positionRenderer.seatId);
      if (!element || !seat) { warnings.push(`Missing seat ${positionRenderer.seatId}.`); continue; }
      const elementScale = scene.canvas.elementDisplayScale;
      contact = {
        x: instance.anchor.x + (seat.contactAnchor.x - element.placementAnchor.x) * elementScale,
        y: instance.anchor.y + (seat.contactAnchor.y - element.placementAnchor.y) * elementScale,
      };
      characterAnchor = (sleeping ? manifest.sittingSleeping : manifest.sitting).seatContactAnchors[facing];
      depth = instance.depthBaselineY + 0.5;
    }
    const x = contact.x - characterAnchor.x * scale;
    const y = contact.y - characterAnchor.y * scale;
    const width = manifest.logicalCanvas.width * scale;
    const height = manifest.logicalCanvas.height * scale;
    drawables.push({
      depth,
      url: new URL(asset, manifestUrl).href,
      x,
      y,
      width,
      height,
      moodUrl: moodPath ? absoluteUrl(moodPath) : undefined,
      characterScale: scale,
    });
    characterMoodHitRegions.push({
      characterId,
      name: profileName(profiles, characterId),
      bounds: { x, y, width, height },
      depth,
      mood: structuredClone(character.mood),
    });
    speakerAnchors.set(characterId, { x: x + manifest.logicalCanvas.width * scale / 2, y: y + 20 });
  }
  const moodOverlays: MoodOverlay[] = [];
  for (const drawable of drawables.sort((left, right) => left.depth - right.depth)) {
    const image = await loadImage(drawable.url);
    context.drawImage(image, drawable.x, drawable.y, drawable.width, drawable.height);
    if (drawable.moodUrl && drawable.characterScale) {
      moodOverlays.push(moodOverlayBounds({
        characterX: drawable.x,
        characterY: drawable.y,
        characterWidth: drawable.width,
        topOpaqueRow: topOpaqueRow(image),
        scale: drawable.characterScale,
      }, drawable.moodUrl));
    }
  }
  for (const overlay of moodOverlays) {
    context.drawImage(await loadImage(overlay.url), overlay.x, overlay.y, overlay.width, overlay.height);
  }
  drawLatestSpeech(context, state, profiles, speakerAnchors, canvas.width);
  drawActiveEvent(context, state, canvas.width);
  return { png: await canvasPng(canvas), warnings, characterMoodHitRegions };
}

function drawActiveEvent(context: CanvasRenderingContext2D, state: SimulationSnapshot, canvasWidth: number): void {
  if (!state.event) return;
  const maxWidth = Math.min(620, canvasWidth - 32);
  const horizontalPadding = 20;
  const verticalPadding = 14;
  const headerHeight = 16;
  const headerBodyGap = 7;
  const lineHeight = 22;
  context.font = "16px DejaVu Sans, system-ui, sans-serif";
  const lines = wrapText(context, state.event.summary, maxWidth - horizontalPadding * 2);
  const bodyWidth = Math.max(...lines.map((line) => context.measureText(line).width), 0);
  const width = Math.min(maxWidth, Math.max(280, bodyWidth + horizontalPadding * 2));
  const height = verticalPadding * 2 + headerHeight + headerBodyGap + lines.length * lineHeight;
  const x = (canvasWidth - width) / 2;
  const y = 16;
  const radius = 12;
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fillStyle = "rgba(216, 232, 247, .97)";
  context.strokeStyle = "#334f68";
  context.lineWidth = 3;
  context.fill();
  context.stroke();
  context.fillStyle = "#476b89";
  context.font = "bold 13px DejaVu Sans, system-ui, sans-serif";
  context.fillText("WORLD EVENT", x + horizontalPadding, y + verticalPadding + 12);
  context.fillStyle = "#1f2d38";
  context.font = "16px DejaVu Sans, system-ui, sans-serif";
  const bodyY = y + verticalPadding + headerHeight + headerBodyGap + 16;
  lines.forEach((line, index) => context.fillText(line, x + horizontalPadding, bodyY + index * lineHeight));
}

function profileName(profiles: CharacterProfile[], characterId: string): string {
  return profiles.find(({ id }) => id === characterId)?.name ?? characterId;
}
function sideFacing(facing: FacingDirection): "left" | "right" { return facing === "right" ? "right" : "left"; }
export function characterAssetKey(character: Pick<CharacterState, "activity" | "posture" | "facing">): string {
  return character.activity === Activity.SLEEPING
    ? `sitting-sleeping/${sideFacing(character.facing)}`
    : `${character.posture}/${character.facing}/neutral`;
}
function topOpaqueRow(image: HTMLImageElement): number {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return 0;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (pixels[(y * canvas.width + x) * 4 + 3] > 0) return y;
    }
  }
  return 0;
}
function absoluteUrl(path: string): string { return new URL(path, document.baseURI).href; }
async function getJson<T>(url: string): Promise<T> { const response = await fetch(url); if (!response.ok) throw new Error(`Could not load render asset ${url} (${response.status}).`); return response.json() as Promise<T>; }
async function loadImage(url: string): Promise<HTMLImageElement> { const image = new Image(); image.src = url; await image.decode(); return image; }
function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> { return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not encode the rendered world as PNG.")), "image/png")); }

export { attachCharacterMoodHover, moodOverlayBounds, topmostHitRegion } from "./mood.js";
export type { CharacterMoodHitRegion, CharacterMoodHoverBinding } from "./mood.js";
