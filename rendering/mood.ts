import type { CharacterState } from "../engine/state/index.js";

export interface CharacterMoodHitRegion {
  characterId: string;
  name: string;
  bounds: { x: number; y: number; width: number; height: number };
  depth: number;
  mood: CharacterState["mood"];
}

export interface CharacterMoodHoverBinding { destroy(): void }

export interface MoodOverlay { url: string; x: number; y: number; width: number; height: number }

/** Attach a reusable mood tooltip to an image produced by renderWorldToPng. */
export function attachCharacterMoodHover(
  image: HTMLImageElement,
  hitRegions: CharacterMoodHitRegion[],
): CharacterMoodHoverBinding {
  const tooltip = document.createElement("div");
  tooltip.setAttribute("role", "tooltip");
  Object.assign(tooltip.style, {
    position: "fixed",
    zIndex: "1000",
    display: "none",
    pointerEvents: "none",
    padding: "8px 10px",
    border: "2px solid #25262b",
    borderRadius: "6px",
    background: "rgba(246, 238, 219, .97)",
    color: "#241f1b",
    font: "13px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    whiteSpace: "pre-line",
    boxShadow: "0 4px 14px rgba(0, 0, 0, .25)",
  });
  document.body.append(tooltip);

  const hide = () => { tooltip.style.display = "none"; };
  const move = (event: PointerEvent) => {
    const rect = image.getBoundingClientRect();
    if (!rect.width || !rect.height || !image.naturalWidth || !image.naturalHeight) return hide();
    const canvasX = (event.clientX - rect.left) * image.naturalWidth / rect.width;
    const canvasY = (event.clientY - rect.top) * image.naturalHeight / rect.height;
    const region = topmostHitRegion(hitRegions, canvasX, canvasY);
    if (!region) return hide();
    const { emotionalState, valence, energy, socialNeed } = region.mood;
    tooltip.textContent = `${region.name}\n${emotionalState}\nvalence ${formatMoodValue(valence)} · energy ${formatMoodValue(energy)} · social need ${formatMoodValue(socialNeed)}`;
    tooltip.style.left = `${event.clientX + 14}px`;
    tooltip.style.top = `${event.clientY + 14}px`;
    tooltip.style.display = "block";
  };
  image.addEventListener("pointermove", move);
  image.addEventListener("pointerleave", hide);
  return {
    destroy() {
      image.removeEventListener("pointermove", move);
      image.removeEventListener("pointerleave", hide);
      tooltip.remove();
    },
  };
}

export function topmostHitRegion(hitRegions: CharacterMoodHitRegion[], x: number, y: number): CharacterMoodHitRegion | null {
  let match: CharacterMoodHitRegion | null = null;
  for (const region of hitRegions) {
    const bounds = region.bounds;
    if (x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height) {
      if (!match || region.depth >= match.depth) match = region;
    }
  }
  return match;
}

export function moodOverlayBounds(
  character: { characterX: number; characterY: number; characterWidth: number; topOpaqueRow: number; scale: number },
  url: string,
): MoodOverlay {
  const logicalIconSize = 16;
  const gap = 2 * character.scale;
  const size = logicalIconSize * character.scale;
  return {
    url,
    x: character.characterX + (character.characterWidth - size) / 2,
    y: Math.max(2, character.characterY + character.topOpaqueRow * character.scale - size - gap),
    width: size,
    height: size,
  };
}

function formatMoodValue(value: number): string { return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""); }
