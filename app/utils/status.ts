import type { LogInteractionInput } from '../data/mediaCatalog.ts'
import { DEFAULT_MEDIA_TYPE, MEDIA_TYPE_UI, parseMediaType, type ActiveMediaType } from './mediaTypes.ts'

export type InteractionStatus = LogInteractionInput['status']

// The three statuses are the same across every medium; only the verbs differ
// — you watch a film but read a book. Verbs live on the media-type registry
// so adding a type doesn't mean editing a second table here.
export function statusOptionsFor(mediaType: ActiveMediaType): { value: InteractionStatus; label: string }[] {
  const verbs = MEDIA_TYPE_UI[mediaType].statusVerbs
  return [
    { value: 'want_to_consume', label: verbs.want },
    { value: 'in_progress', label: verbs.inProgress },
    { value: 'consumed', label: verbs.done },
  ]
}

export function statusLabelsFor(mediaType: ActiveMediaType): Record<string, string> {
  return Object.fromEntries(statusOptionsFor(mediaType).map((o) => [o.value, o.label]))
}

// For the handful of places that render a status without knowing (or caring)
// which medium it belongs to — e.g. a mixed list. Falls back to watch verbs.
export function statusLabel(status: string, mediaType?: unknown): string {
  const type = parseMediaType(mediaType) ?? DEFAULT_MEDIA_TYPE
  return statusLabelsFor(type)[status] ?? status
}

export const STATUS_OPTIONS = statusOptionsFor(DEFAULT_MEDIA_TYPE)
export const STATUS_LABELS = statusLabelsFor(DEFAULT_MEDIA_TYPE)
