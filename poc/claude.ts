// Proof-of-concept version of app/lib/claude.ts from the plan (section 3, step 3).
// Same shape as the real thing: SQL/in-memory candidate generation hands Claude
// a bounded, grounded pool; Claude only selects and ranks within it, via
// structured outputs so the response is directly parseable.

import Anthropic from "@anthropic-ai/sdk";
import type { MediaItem } from "./data.ts";
import { logUsage } from "./usage.ts";

const client = new Anthropic(); // resolves ANTHROPIC_API_KEY / ant auth profile from env

const RECOMMENDATION_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    recommendations: {
      type: "array" as const,
      items: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          media_id: { type: "string" as const },
          type: { type: "string" as const, enum: ["movie", "tv", "book", "comic", "game"] },
          reason: { type: "string" as const },
          confidence: { type: "number" as const },
        },
        required: ["media_id", "type", "reason", "confidence"],
      },
    },
  },
  required: ["recommendations"],
};

export interface RankedPick {
  media_id: string;
  type: string;
  reason: string;
  confidence: number;
}

export async function rankForSubject(
  profiles: { label: string; liked_tags: string[]; disliked_tags: string[]; summary: string }[],
  candidates: MediaItem[],
  usageLabel: string,
): Promise<RankedPick[]> {
  const isGroup = profiles.length > 1;

  const candidatePayload = candidates.map((c) => ({
    media_id: c.id,
    type: c.type,
    title: c.title,
    tags: c.tags,
  }));

  const prompt = isGroup
    ? `Group of ${profiles.length} people, each with their own taste profile:\n${JSON.stringify(profiles, null, 2)}\n\n` +
      `Select and rank the best "what's next" picks from this candidate pool (never invent titles not listed):\n` +
      `${JSON.stringify(candidatePayload, null, 2)}\n\n` +
      `Reason explicitly about tradeoffs: avoid picks only one person would like; prefer broad appeal; ` +
      `where genuinely interesting, surface a pick that bridges members' different tastes rather than only the ` +
      `bland common denominator. Do not just average genre tags — reason per-person about how each candidate ` +
      `would land for them specifically. For each pick, the reason should note which member(s) it serves and why.`
    : `User's taste profile:\n${JSON.stringify(profiles[0], null, 2)}\n\n` +
      `Select and rank the best "what's next" picks from this candidate pool (never invent titles not listed):\n` +
      `${JSON.stringify(candidatePayload, null, 2)}`;

  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: isGroup ? 16000 : 8000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: isGroup ? "high" : "medium",
      format: { type: "json_schema", schema: RECOMMENDATION_SCHEMA },
    },
    messages: [{ role: "user", content: prompt }],
  });

  logUsage(usageLabel, response.model, response.usage);

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock) {
    throw new Error(`No text block in response — stop_reason: ${response.stop_reason}`);
  }

  const parsed = JSON.parse(textBlock.text) as { recommendations: RankedPick[] };
  return parsed.recommendations;
}
