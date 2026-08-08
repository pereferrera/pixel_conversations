import type { CharacterProfile, FacingDirection, SimulationSnapshot } from "../engine/state/index.js";

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
export interface RenderingConfig { sceneDefinition: string; characterManifests: Record<string, string> }
export interface RenderWorldRequest { state: SimulationSnapshot; profiles: CharacterProfile[]; rendering: RenderingConfig }
export interface RenderWorldResult { png: Blob; warnings: string[] }
interface Drawable { depth: number; url: string; x: number; y: number; width: number; height: number }

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
    const sleeping = character.posture === "sleeping";
    const assetKey = sleeping ? `sitting-sleeping/${facing}` : `${character.posture}/${character.facing}`;
    const asset = manifest.assets[assetKey];
    if (!asset) { warnings.push(`Missing ${assetKey} sprite for ${characterId}.`); continue; }
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
    drawables.push({ depth, url: new URL(asset, manifestUrl).href, x, y, width: manifest.logicalCanvas.width * scale, height: manifest.logicalCanvas.height * scale });
    speakerAnchors.set(characterId, { x: x + manifest.logicalCanvas.width * scale / 2, y: y + 20 });
  }
  for (const drawable of drawables.sort((left, right) => left.depth - right.depth)) {
    context.drawImage(await loadImage(drawable.url), drawable.x, drawable.y, drawable.width, drawable.height);
  }
  drawLatestSpeech(context, state, profiles, speakerAnchors, canvas.width);
  return { png: await canvasPng(canvas), warnings };
}

function drawLatestSpeech(context: CanvasRenderingContext2D, state: SimulationSnapshot, profiles: CharacterProfile[], anchors: Map<string, Point>, canvasWidth: number): void {
  const last = Object.values(state.conversations).filter(({ active }) => active).at(-1)?.beats.at(-1);
  if (!last || last.type !== "say") return;
  const anchor = anchors.get(last.speakerId);
  if (!anchor) return;
  const speakerName = profileName(profiles, last.speakerId);
  const maxWidth = 480;
  const horizontalPadding = 16;
  const verticalPadding = 12;
  const headerHeight = 16;
  const headerBodyGap = 7;
  const bodyLineHeight = 22;
  context.font = "16px DejaVu Sans, system-ui, sans-serif";
  const lines = wrapText(context, last.text, maxWidth - horizontalPadding * 2);
  context.font = "bold 13px DejaVu Sans, system-ui, sans-serif";
  const headerWidth = context.measureText(speakerName).width;
  context.font = "16px DejaVu Sans, system-ui, sans-serif";
  const bodyWidth = Math.max(...lines.map((line) => context.measureText(line).width), 0);
  const width = Math.min(maxWidth, Math.max(220, headerWidth + horizontalPadding * 2, bodyWidth + horizontalPadding * 2));
  const height = verticalPadding * 2 + headerHeight + headerBodyGap + lines.length * bodyLineHeight;
  const x = Math.max(12, Math.min(canvasWidth - width - 12, anchor.x - width / 2));
  const y = Math.max(12, anchor.y - height - 30);
  context.fillStyle = "rgba(246, 238, 219, .97)";
  context.strokeStyle = "#25262b";
  context.lineWidth = 3;
  context.beginPath(); context.moveTo(anchor.x - 10, y + height); context.lineTo(anchor.x, y + height + 16); context.lineTo(anchor.x + 10, y + height); context.fill(); context.stroke();
  context.beginPath(); context.roundRect(x, y, width, height, 12); context.fill(); context.stroke();
  context.fillStyle = "#5e554a";
  context.font = "bold 13px DejaVu Sans, system-ui, sans-serif";
  context.fillText(speakerName, x + horizontalPadding, y + verticalPadding + 12);
  context.fillStyle = "#241f1b";
  context.font = "16px DejaVu Sans, system-ui, sans-serif";
  const bodyY = y + verticalPadding + headerHeight + headerBodyGap + 16;
  lines.forEach((line, index) => context.fillText(line, x + horizontalPadding, bodyY + index * bodyLineHeight));
}

function wrapText(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && context.measureText(next).width > width) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
    else if (!paragraph.trim()) lines.push("");
  }
  return lines.length ? lines : [""];
}
function profileName(profiles: CharacterProfile[], characterId: string): string {
  const identity = profiles.find(({ id }) => id === characterId)?.identity;
  if (identity && typeof identity === "object" && "name" in identity && typeof identity.name === "string") return identity.name;
  return characterId;
}
function sideFacing(facing: FacingDirection): "left" | "right" { return facing === "right" ? "right" : "left"; }
function absoluteUrl(path: string): string { return new URL(path, document.baseURI).href; }
async function getJson<T>(url: string): Promise<T> { const response = await fetch(url); if (!response.ok) throw new Error(`Could not load render asset ${url} (${response.status}).`); return response.json() as Promise<T>; }
async function loadImage(url: string): Promise<HTMLImageElement> { const image = new Image(); image.src = url; await image.decode(); return image; }
function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> { return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not encode the rendered world as PNG.")), "image/png")); }
