// Per-call cost visibility for the POC. There's no API/CLI access to
// account-wide usage from here — this only reports what a single call cost,
// using response.usage, which is the real ground truth for that call.

import type Anthropic from "@anthropic-ai/sdk";

// $ per million tokens. Sonnet 5 intro pricing applies through 2026-08-31;
// swap to the standard rate (3.00 / 15.00) after that if you're re-running this later.
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 2.0, output: 10.0 }, // intro rate through 2026-08-31
  "claude-opus-5": { input: 5.0, output: 25.0 },
};

export function logUsage(label: string, model: string, usage: Anthropic.Usage) {
  const rate = PRICING[model];
  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens; // includes thinking tokens
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;

  let costLine = "";
  if (rate) {
    const cost = (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
    costLine = ` (~$${cost.toFixed(4)})`;
  }

  console.log(
    `[usage] ${label}: input=${inputTokens} output=${outputTokens}` +
      (cacheRead || cacheWrite ? ` cache_read=${cacheRead} cache_write=${cacheWrite}` : "") +
      costLine,
  );
}
