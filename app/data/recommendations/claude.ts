import Anthropic from '@anthropic-ai/sdk'

import { track } from './timings.ts'

// Resolves ANTHROPIC_API_KEY from env.
const claude = new Anthropic()

const TIGHT_BUDGET_RATIO = 0.9

// max_tokens caps the reasoning and the JSON together — `thinking` is unset and
// these models think by default — so a call can spend its whole allowance
// thinking and leave nothing for the answer.
function recordUsage(name: string, maxTokens: number, response: Anthropic.Message): void {
  const { usage } = response
  const share = Math.round((usage.output_tokens / maxTokens) * 100)
  const line =
    `[generation] ${name} stop=${response.stop_reason} ` +
    `out=${usage.output_tokens}/${maxTokens} (${share}%) ` +
    `think=${usage.output_tokens_details?.thinking_tokens ?? 'n/a'} in=${usage.input_tokens}`

  if (response.stop_reason !== 'end_turn' || usage.output_tokens >= maxTokens * TIGHT_BUDGET_RATIO) {
    console.warn(line)
    return
  }
  console.info(line)
}

// The API reports what a call spent, never what it was allowed, so the budget
// has to be read off the request to be measured against.
export async function requestStructured<T>(
  name: string,
  params: Anthropic.MessageCreateParamsNonStreaming,
  // Handed the answer as it arrived, before parsing. The picks call keeps it, so a
  // run that came back wrong can be read rather than guessed at — see
  // transcripts.ts.
  onRaw?: (text: string) => void,
): Promise<T> {
  const response = await track(name, () => claude.messages.create(params))

  // Ahead of the checks below, which both throw.
  recordUsage(name, params.max_tokens, response)

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
  if (!textBlock) {
    throw new Error(`No text block in Claude response — stop_reason: ${response.stop_reason}`)
  }

  onRaw?.(textBlock.text)
  return JSON.parse(textBlock.text) as T
}
