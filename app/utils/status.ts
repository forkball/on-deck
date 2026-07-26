import type { LogInteractionInput } from '../data/movies.ts'

export type InteractionStatus = LogInteractionInput['status']

export const STATUS_OPTIONS: { value: InteractionStatus; label: string }[] = [
  { value: 'want_to_consume', label: 'Want to watch' },
  { value: 'in_progress', label: 'Watching' },
  { value: 'consumed', label: 'Watched' },
  { value: 'dropped', label: 'Dropped' },
]

export const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  STATUS_OPTIONS.map((o) => [o.value, o.label]),
)
