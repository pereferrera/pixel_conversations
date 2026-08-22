import type { DecisionContext } from "./decision-context.js";
import { dynamicPacing } from "./simulation-tuning.js";
import type { DynamicPacing } from "./simulation-tuning.js";

export const DECISION_SYSTEM_PROMPT = "You choose the next small, plausible changes in a quiet character simulation. Return only the requested structured decision. Never invent ids.";

/** Builds the provider-neutral text representation of a simulation decision request. */
export function decisionPrompt(context: DecisionContext): string {
  const tuning = context.tuning;
  const pacing = dynamicPacing(tuning);
  const recentHistory = context.state.decisionHistory.slice(-tuning.decisionHistoryLimit);
  const promptContext = structuredClone(context);
  promptContext.state.decisionHistory = recentHistory;

  return [
    "Decide the next small simulation step from the complete context below.",
    worldTendencyInstruction(tuning.worldTendency),
    pomposityInstruction(tuning.pomposity),
    worldDynamicInstruction(tuning.worldDynamic),
    `Only propose allowed changes. Usually make ${pacing.typicalChangesMin} to ${pacing.typicalChangesMax} meaningful changes. Zero changes are not allowed.`,
    "Use decisionHistory as a guide to avoid repeating the same patterns and stories. Before choosing the next step, compare it with the recent summaries and do not repeat or lightly paraphrase the same actions, conflicts, conversation cycles, events, hazards, or outcomes. Prefer a new consequence, a materially changed response, or progression to a different situation.",
    dynamicPriorityInstruction(tuning.worldDynamic),
    `When at least two placed, awake characters are available and no conversation is active, aim to start a conversation in about ${pacing.conversationStartLikelihoodPercent}% of eligible steps.`,
    "Choose conversational participation primarily from each participant's full profile, personality, conversational style, current mood, social need, relationships, and the recent conversation beats.",
    "Do not alternate speakers mechanically. A shy, guarded, tired, or uncomfortable character may mostly listen; an outgoing, excited, confident, or verbose character may speak repeatedly or temporarily dominate.",
    "Personality creates tendencies, not absolute restrictions. Topic, trust, mood, unanswered questions, and what was just said may change who speaks.",
    "STRICT CHARACTER KNOWLEDGE BOUNDARY: A character knows their own personality and background, but not any other character's personality, background, job, history, interests, plans, secrets, or experiences merely because those profiles appear in the simulation context. Treat other profiles as private direction for portraying those characters, never as shared world knowledge.",
    "A character may know something about another character only when that information appears in that character's own memories or was spoken or directly witnessed in the conversation/event history available to them. Empty memories at the beginning mean they know nothing personal about the other characters. Do not write dialogue that assumes familiarity, addresses another person's undisclosed occupation or interests, or reveals private background before it has been learned naturally.",
    "Use mood.emotionalState to capture the character's concrete visible emotion. The only allowed values are happy, sad, angry, afraid, and neutral. Decide autonomously when it should change; do not change it mechanically every step.",
    "Emotional-state examples: kind or affirming words, success, connection, or an enjoyable exchange may trigger happy; hurtful words, disappointment, loss, rejection, or going without social contact for a while may trigger sad; insults, betrayal, unfair treatment, provocation, or a frustrating remark may trigger angry; danger, a credible threat, sudden alarm, or feeling unsafe may trigger afraid; use neutral when no distinct emotion dominates or after a feeling has naturally settled.",
    "Keep the continuous valence, energy, and socialNeed mood dimensions meaningful alongside emotionalState; emotionalState is not a replacement for them.",
    "Posture is only standing or sitting. Sleeping is an activity, never a posture, and setActivity may select sleeping only for a seated character. Talking activity is managed by conversation actions.",
    `Only when character evidence is weak, use these fallback tendencies: speech in about ${pacing.conversationTurnLikelihoodPercent}% of active-conversation steps, a listening pause in about ${pacing.defaultListeningPauseLikelihoodPercent}%, and the same speaker continuing in about ${pacing.defaultSameSpeakerContinuationLikelihoodPercent}%.`,
    conversationLengthInstruction(pacing, tuning.worldDynamic),
    "Conversation lifecycle is explicit: startConversation creates it, say records exact spoken words, and endConversation marks it closing. A closing conversation accepts no more speech and is deleted automatically before the next simulation step. addEvent must never substitute for any of these.",
    "When ending a conversation, do not move either participant in the same decision. Their closing beat must render where the conversation occurred; movement may happen in the next simulation step.",
    "Use addEvent, in addition to any other necessary changes, when a meaningful non-dialogue occurrence is important to understanding the world. At most one event may be added per step; it remains visible for the resulting frame and expires before the next simulation step.",
    "Physical connection is mandatory before speech. Before startConversation, both participants must occupy one of context.scene.conversationPairs. Starting the conversation automatically turns them to the pair's listed facings so they look toward each other. Return placeCharacter changes first only when their positions do not already form a pair.",
    "To open a conversation, arrange both people if necessary, then return startConversation followed later in the same changes array by one say using conversationId equal to startConversation.id.",
    'Opening example: [{"type":"placeCharacter","characterId":"felix-adebayo","positionId":"chair-2/seat","posture":"sitting","facing":"right"},{"type":"placeCharacter","characterId":"grace-kim","positionId":"floor-center","posture":"standing","facing":"left"},{"type":"startConversation","id":"cafe-chat","participants":["grace-kim","felix-adebayo"],"topic":"amateur astronomy"},{"type":"say","conversationId":"cafe-chat","speakerId":"grace-kim","text":"What first drew you to amateur astronomy?"}]',
    'To continue it later: {"type":"say","conversationId":"cafe-chat","speakerId":"felix-adebayo","text":"I started by learning the winter constellations."}',
    'For a listening beat with no spoken words: {"type":"pauseConversation","conversationId":"cafe-chat"}',
    'To close it: {"type":"endConversation","conversationId":"cafe-chat"}',
    "Follow the action field contracts and position affordances in context.rules exactly. Every change uses `type`, never `action`.",
    "For each active conversation, at most one `say` change is allowed in this step.",
    `Memory is rare. When a conversation ends, create one concise remember action for each participant in about ${tuning.conversationEndMemoryLikelihoodPercent}% of cases, normally with importance ${tuning.conversationEndMemoryImportance}.`,
    `Outside conversation endings, create a memory only for an extraordinary event or sentence (roughly ${tuning.extraordinaryMemoryLikelihoodPercent}% of eligible moments), with importance at least ${tuning.extraordinaryMemoryMinimumImportance}. Memories contain only summary and importance.`,
    "Use only ids from the context.",
    "CONTEXT:", JSON.stringify(promptContext),
    "RECENT WORLD CHANGE SUMMARIES (oldest to newest):", JSON.stringify(recentHistory),
  ].join("\n");
}

export function worldTendencyInstruction(tendency: number): string {
  const positiveBiasPercent = Math.round((tendency + 1) * 50);
  const adverseBiasPercent = 100 - positiveBiasPercent;
  const value = tendency > 0 ? `+${tendency}` : String(tendency);
  if (tendency === 1) return "WORLD TENDENCY +1: Keep outcomes consistently happy, peaceful, cooperative, and fortunate. Do not introduce disasters, hostility, or conflict.";
  if (tendency === -1) return "WORLD TENDENCY -1: Prefer adverse consequences, conflict, hostility, misfortune, danger, meaningful setbacks, and unfavorable resolutions. Do not prolong a setback merely by restating it or incrementally worsening the same situation. Resolve or materially transform the current problem, even when it resolves badly, then progress toward a causally distinct problem. Peaceful or fortunate outcomes should be exceptionally rare.";
  if (tendency === 0) return "WORLD TENDENCY 0: Keep outcomes balanced and causally plausible; allow warmth, conflict, good fortune, and setbacks according to the characters and current situation without favoring either direction.";
  return `WORLD TENDENCY ${value}: Use this as a narrative prior of approximately ${positiveBiasPercent}% peaceful/fortunate outcomes and ${adverseBiasPercent}% adverse/conflict outcomes. Preserve character causality and choose the next event with this directional bias.`;
}

export function pomposityInstruction(pomposity: number): string {
  const value = pomposity > 0 ? `+${pomposity}` : String(pomposity);
  if (pomposity === 1) return "DIALOGUE POMPOSITY +1: Make spoken dialogue deliberately grand, ornate, theatrical, and Shakespeare-like. Favor elaborate metaphors, formal constructions, heightened rhetoric, and unusually sophisticated vocabulary.";
  if (pomposity === -1) return "DIALOGUE POMPOSITY -1: Make spoken dialogue extremely casual and slang-heavy, using fragments, clipped wording, fillers, and deliberately nonstandard grammar. Keep the meaning understandable and preserve each character's identity.";
  const ornatePercent = Math.round((pomposity + 1) * 50);
  const everydayPercent = 100 - Math.abs(Math.round(pomposity * 100));
  return `DIALOGUE POMPOSITY ${value}: IMPORTANT—write dialogue that sounds spoken by real people, not literary narration. Use contractions, short or incomplete sentences, ordinary vocabulary, occasional hesitation, interruptions, direct replies, and naturally uneven turn lengths. Avoid poetic imagery, polished monologues, aphorisms, theatrical declarations, and characters constantly sounding profound unless their profile and the immediate moment specifically justify it. Match vocabulary and verbal fluency to each character's background, education, personality, and current emotion; average everyday speech is neither unintelligent nor inarticulate. Apply approximately ${ornatePercent}% of the path from slang-heavy speech to ornate speech, while retaining about ${everydayPercent}% everyday conversational naturalness.`;
}

export function worldDynamicInstruction(worldDynamic: number): string {
  const value = worldDynamic > 0 ? `+${worldDynamic}` : String(worldDynamic);
  if (worldDynamic === 1) return "WORLD DYNAMIC +1: Keep the world intensely hectic through meaningful transitions between situations. Characters move often, conversations start and stop quickly, turns are urgent and interruptible, and activities change rapidly while obeying world rules. Rapid pacing requires narrative progression: do not repeat equivalent actions, recycle the same conflict, or immediately restart a recently ended conversation between the same participants on the same topic. Do not sustain long or deeply reflective conversations.";
  if (worldDynamic === -1) return "WORLD DYNAMIC -1: Keep the world exceptionally quiet and still. Characters rarely speak or move from their chosen positions. Prefer pauses, listening, small mood shifts, or occasional posture/activity changes, but every step must still contain at least one meaningful change so the world remains alive.";
  const hecticBiasPercent = Math.round((worldDynamic + 1) * 50);
  const quietBiasPercent = 100 - hecticBiasPercent;
  return `WORLD DYNAMIC ${value}: Use a pacing prior of approximately ${hecticBiasPercent}% hectic/active behavior and ${quietBiasPercent}% quiet/still behavior. Higher values favor movement, rapid activity changes, interruptions, and shorter conversations; lower values favor staying in place, silence, listening, and subtle changes. Every step still needs a meaningful change.`;
}

function dynamicPriorityInstruction(worldDynamic: number): string {
  if (worldDynamic === 1) return "Prioritize visible movement, activity changes, interruptions, conversation endings, and genuinely new situations over sustained social interaction or reflective dialogue. Conversation turnover must advance the story rather than restart the same exchange.";
  if (worldDynamic === -1) return "Prioritize stillness, silence, listening, and subtle state changes. Avoid moving characters or starting conversations unless strongly justified.";
  if (worldDynamic > 0) return "As worldDynamic is positive, increasingly prefer movement, activity changes, interruptions, and conversation turnover over sustained dialogue.";
  if (worldDynamic < 0) return "As worldDynamic is negative, increasingly prefer stillness, silence, listening, and subtle changes over movement or conversation.";
  return "Balance social interaction, movement, stillness, and narrative progression according to character evidence.";
}

function conversationLengthInstruction(pacing: DynamicPacing, worldDynamic: number): string {
  if (worldDynamic === 1) return `Conversations must be brief and hectic: target ${pacing.typicalConversationMinTurns} to ${pacing.typicalConversationMaxTurns} spoken turns total. If an active conversation already has ${pacing.typicalConversationMaxTurns} spoken turns, end it in this step instead of continuing it, then favor movement or another activity.`;
  if (worldDynamic > 0) return `Conversations should typically contain ${pacing.typicalConversationMinTurns} to ${pacing.typicalConversationMaxTurns} spoken turns total. Positive worldDynamic means engagement must not override the pressure to interrupt or end conversations and move on.`;
  return `Conversations typically contain ${pacing.typicalConversationMinTurns} to ${pacing.typicalConversationMaxTurns} spoken turns. Treat this as a soft range, while respecting the quiet-world preference against frequent speech.`;
}
