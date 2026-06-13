import { createAnthropic } from "@ai-sdk/anthropic";

export const DEFAULT_AI_MODEL = "claude-sonnet-4-6";

export function getAgirModel(modelName = process.env.AGIR_AI_MODEL || DEFAULT_AI_MODEL) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  return createAnthropic({ apiKey })(modelName);
}

