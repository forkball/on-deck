import Anthropic from '@anthropic-ai/sdk'

// Resolves ANTHROPIC_API_KEY from env.
export const claude = new Anthropic()

// Every call here uses structured output and expects a single text block of JSON.
export function parseStructuredResponse<T>(response: Anthropic.Message): T {
  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
  if (!textBlock) {
    throw new Error(`No text block in Claude response — stop_reason: ${response.stop_reason}`)
  }
  return JSON.parse(textBlock.text) as T
}
