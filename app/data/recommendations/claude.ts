import Anthropic from '@anthropic-ai/sdk'

import { track } from './timings.ts'

// Resolves ANTHROPIC_API_KEY from env.
const claude = new Anthropic()

// Past this share of the budget a call finished only just, which is the state
// worth hearing about while it still works — the next slightly longer prompt is
// the one that doesn't.
const TIGHT_BUDGET_RATIO = 0.9

// One budget covers the reasoning and the JSON both. `thinking` is unset and
// the model these calls run on thinks by default, so max_tokens caps the two
// together and a call can spend the whole allowance thinking, leaving nothing
// for the answer it was asked for. That makes the split the number to read:
// think against the budget is what the reasoning took, and out minus think
// roughly what the JSON needed — which is what says how much higher a budget
// would have to go.
//
// Nothing already here reports it. Thinking blocks come back with their text
// omitted, so the response body is no evidence of what the thinking cost, and
// the durations in timings.ts measure how long a call took rather than how
// close it came to its ceiling.
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
// JSON. They go through one function so that each one names its step and its
// budget exactly once: the step because the usage line and the timing line are
// only readable together if they agree on what to call the call, and the budget
// because the API reports what a call spent and never what it was allowed, so
// the ceiling has to come from the request to be measured against.
export async function requestStructured<T>(
  name: string,
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<T> {
  const response = await track(name, () => claude.messages.create(params))

  // Ahead of the checks below rather than after them, since the calls that fail
  // here are the ones whose numbers explain why and both ways out of this
  // function throw.
  recordUsage(name, params.max_tokens, response)

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
  if (!textBlock) {
    throw new Error(`No text block in Claude response — stop_reason: ${response.stop_reason}`)
  }
  return JSON.parse(textBlock.text) as T
}
