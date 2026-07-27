import Anthropic from '@anthropic-ai/sdk'

// Shared client for every Claude call in the app (taste-profile regeneration,
// recommendation generation). Resolves ANTHROPIC_API_KEY from env.
export const claude = new Anthropic()

// Every call in this app uses structured output (json_schema) and expects a
// single text block containing the JSON. Shared here so each call site isn't
// re-deriving the same "find the text block, parse it, or throw" logic.
export function parseStructuredResponse<T>(response: Anthropic.Message): T {
  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
  if (!textBlock) {
    throw new Error(`No text block in Claude response — stop_reason: ${response.stop_reason}`)
  }
  return JSON.parse(textBlock.text) as T
}
