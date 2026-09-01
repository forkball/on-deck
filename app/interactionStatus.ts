import type { InteractionStatus } from './data/mediaItems.ts'
import { INTERACTION_STATUSES } from './data/schema.ts'
import { DEFAULT_MEDIA_TYPE, MEDIA_TYPE_UI, parseMediaType, type ActiveMediaType } from './mediaTypes.ts'

export function parseInteractionStatus(value: unknown): InteractionStatus | null {
  return INTERACTION_STATUSES.includes(value as InteractionStatus) ? (value as InteractionStatus) : null
}

// Same four statuses everywhere; only the verbs differ, and those live on the
// media-type registry so adding a type doesn't mean editing a second table.
//
// "Not interested" takes no verb — you decline a book as you decline a film — so
// it isn't in StatusVerbs, and it goes last as the one that isn't a stage of
// consuming anything.
export function statusOptionsFor(mediaType: ActiveMediaType): { value: InteractionStatus; label: string }[] {
  const verbs = MEDIA_TYPE_UI[mediaType].statusVerbs
  return [
    { value: 'want_to_consume', label: verbs.want },
    { value: 'in_progress', label: verbs.inProgress },
    { value: 'consumed', label: verbs.done },
    { value: 'not_interested', label: 'Not interested' },
  ]
}

export function statusLabelsFor(mediaType: ActiveMediaType): Record<string, string> {
  return Object.fromEntries(statusOptionsFor(mediaType).map((o) => [o.value, o.label]))
}

export function statusLabel(status: string, mediaType?: unknown): string {
  const type = parseMediaType(mediaType) ?? DEFAULT_MEDIA_TYPE
  return statusLabelsFor(type)[status] ?? status
}

const STATUS_BADGE_COLORS: Record<InteractionStatus, string> = {
  want_to_consume: '#1d4ed8',
  in_progress: '#b45309',
  consumed: '#15803d',
  not_interested: '#6b7280',
}

export function statusBadgeColor(status: string): string {
  return STATUS_BADGE_COLORS[status as InteractionStatus] ?? '#555'
}
