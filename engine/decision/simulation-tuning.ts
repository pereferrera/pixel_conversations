export interface SimulationTuning {
  worldTendency: number;
  pomposity: number;
  worldDynamic: number;
  promptHistoryLimit: number;
  typicalChangesMin: number;
  typicalChangesMax: number;
  conversationStartLikelihoodPercent: number;
  conversationTurnLikelihoodPercent: number;
  memoryLimitPerCharacter: number;
  conversationEndMemoryLikelihoodPercent: number;
  conversationEndMemoryImportance: number;
  extraordinaryMemoryLikelihoodPercent: number;
  extraordinaryMemoryMinimumImportance: number;
  typicalConversationMinTurns: number;
  typicalConversationMaxTurns: number;
  defaultListeningPauseLikelihoodPercent: number;
  defaultSameSpeakerContinuationLikelihoodPercent: number;
}

/**
 * Central defaults for state limits, simulation pacing, and prompt context.
 * Consumers may override relevant values where they construct state/providers.
 */
export const DEFAULT_SIMULATION_TUNING: Readonly<SimulationTuning> = Object.freeze({
  worldTendency: 0,
  pomposity: 0,
  worldDynamic: 0,
  promptHistoryLimit: 20,
  typicalChangesMin: 2,
  typicalChangesMax: 4,
  conversationStartLikelihoodPercent: 70,
  conversationTurnLikelihoodPercent: 85,
  memoryLimitPerCharacter: 12,
  conversationEndMemoryLikelihoodPercent: 100,
  conversationEndMemoryImportance: 0.6,
  extraordinaryMemoryLikelihoodPercent: 10,
  extraordinaryMemoryMinimumImportance: 0.8,
  typicalConversationMinTurns: 4,
  typicalConversationMaxTurns: 10,
  defaultListeningPauseLikelihoodPercent: 15,
  defaultSameSpeakerContinuationLikelihoodPercent: 35,
});

export function resolveSimulationTuning(overrides: Partial<SimulationTuning> = {}): SimulationTuning {
  const tuning = { ...DEFAULT_SIMULATION_TUNING, ...overrides };
  signed(tuning.worldTendency, "worldTendency");
  signed(tuning.pomposity, "pomposity");
  signed(tuning.worldDynamic, "worldDynamic");
  positiveInteger(tuning.promptHistoryLimit, "promptHistoryLimit");
  positiveInteger(tuning.typicalChangesMin, "typicalChangesMin");
  positiveInteger(tuning.typicalChangesMax, "typicalChangesMax");
  if (tuning.typicalChangesMin > tuning.typicalChangesMax || tuning.typicalChangesMax > 12) {
    throw new RangeError("Typical change counts must be ordered and no greater than the 12-change world-rule limit.");
  }
  percentage(tuning.conversationStartLikelihoodPercent, "conversationStartLikelihoodPercent");
  percentage(tuning.conversationTurnLikelihoodPercent, "conversationTurnLikelihoodPercent");
  positiveInteger(tuning.memoryLimitPerCharacter, "memoryLimitPerCharacter");
  percentage(tuning.conversationEndMemoryLikelihoodPercent, "conversationEndMemoryLikelihoodPercent");
  unit(tuning.conversationEndMemoryImportance, "conversationEndMemoryImportance");
  percentage(tuning.extraordinaryMemoryLikelihoodPercent, "extraordinaryMemoryLikelihoodPercent");
  unit(tuning.extraordinaryMemoryMinimumImportance, "extraordinaryMemoryMinimumImportance");
  positiveInteger(tuning.typicalConversationMinTurns, "typicalConversationMinTurns");
  positiveInteger(tuning.typicalConversationMaxTurns, "typicalConversationMaxTurns");
  if (tuning.typicalConversationMinTurns > tuning.typicalConversationMaxTurns) {
    throw new RangeError("Typical conversation turn counts must be ordered.");
  }
  percentage(tuning.defaultListeningPauseLikelihoodPercent, "defaultListeningPauseLikelihoodPercent");
  percentage(tuning.defaultSameSpeakerContinuationLikelihoodPercent, "defaultSameSpeakerContinuationLikelihoodPercent");
  return tuning;
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${label} must be a positive integer.`);
}

function percentage(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new RangeError(`${label} must be between 0 and 100.`);
}

function unit(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`${label} must be between 0 and 1.`);
}

function signed(value: number, label: string): void {
  if (!Number.isFinite(value) || value < -1 || value > 1) throw new RangeError(`${label} must be between -1 and 1.`);
}
