import { ConversationStatus } from "../engine/state/index.js";
import type { CharacterProfile, SimulationSnapshot } from "../engine/state/index.js";

interface Point { x: number; y: number }

export function drawLatestSpeech(
  context: CanvasRenderingContext2D,
  state: SimulationSnapshot,
  profiles: CharacterProfile[],
  anchors: Map<string, Point>,
  canvasWidth: number,
): void {
  const last = Object.values(state.conversations)
    .filter(({ status }) => status === ConversationStatus.ACTIVE || status === ConversationStatus.CLOSING)
    .at(-1)?.beats.at(-1);
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
  const radius = 12;
  const tailCenterX = Math.max(x + radius + 10, Math.min(x + width - radius - 10, anchor.x));
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(tailCenterX + 10, y + height);
  context.lineTo(anchor.x, y + height + 16);
  context.lineTo(tailCenterX - 10, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
  context.fill();
  context.stroke();
  context.fillStyle = "#5e554a";
  context.font = "bold 13px DejaVu Sans, system-ui, sans-serif";
  context.fillText(speakerName, x + horizontalPadding, y + verticalPadding + 12);
  context.fillStyle = "#241f1b";
  context.font = "16px DejaVu Sans, system-ui, sans-serif";
  const bodyY = y + verticalPadding + headerHeight + headerBodyGap + 16;
  lines.forEach((line, index) => context.fillText(line, x + horizontalPadding, bodyY + index * bodyLineHeight));
}

export function wrapText(context: CanvasRenderingContext2D, text: string, width: number): string[] {
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
  return profiles.find(({ id }) => id === characterId)?.name ?? characterId;
}
