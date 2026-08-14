import Anthropic from '@anthropic-ai/sdk'

import { track } from './timings.ts'

// Resolves ANTHROPIC_API_KEY from env.
const claude = new Anthropic()

// Past this share of the budget a call finished only just, which is the state
// worth hearing about while it still works — the next slightly longer prompt is
// the one that doesn't.
const TIGHT_BUDGET_RATIO = 0.9

// One budget covers the reasoning and the JSON both: `thinking` is unset and
// these models think by default, so max_tokens caps the two together and a call
// can spend its whole allowance thinking, leaving nothing for the answer. The
// split is the number to read — `think` is what the reasoning took, and out
// minus think roughly what the JSON needed.
function recordUsage(name: string, maxTokens: number, response: Anthropic.Message): void {
  const { usage } = response
  const share = Math.round((usage.output_tokens / maxTokens) * 100)
  const line =
    `[generation] ${name} stop=${response.stop_reason} ` +
    `out=${usage.output_tokens}/${maxTokens} (${share}%) ` +
    `think=${usage.output_tokens_details?.thinking_tokens ?? 'n/a'} in=${usage.input_tokens}`

  // Warned rather than logged for the two shapes worth chasing: a call that ran
  // out of room, and one that nearly did. The rest is the baseline those get
  // read against, which only means anything if the calls that went fine are
  // recorded too.
  if (response.stop_reason !== 'end_turn' || usage.output_tokens >= maxTokens * TIGHT_BUDGET_RATIO) {
    console.warn(line)
    return
  }
  console.info(line)
}

// Every call here uses structured output and expects a single text block of
// JSON. One function so each names its step once — the usage line and the
// timing line are only readable together if they agree on what to call it — and
// so the budget is read off the request, which is the only place it appears
// (the API reports what a call spent, never what it was allowed).
export async function requestStructured<T>(
  name: string,
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<T> {
  const response = await track(name, () => claude.messages.create(params))

  // Ahead of the checks below: both ways out of this function throw, and a call
  // that fails them is the one whose numbers explain why.
  recordUsage(name, params.max_tokens, response)

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
  if (!textBlock) {
    throw new Error(`No text block in Claude response — stop_reason: ${response.stop_reason}`)
  }
  return JSON.parse(textBlock.text) as T
}
