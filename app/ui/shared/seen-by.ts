// How much of a group may already have finished a pick, with the one wording
// both the form and the run page show for it. Here rather than beside the rule
// (data/recommendations/exclusions.ts) because the form is a client entry and
// can only reach app/ui/shared.
//
// The form defaults to 'no_one'. Absent means 'half', the rule every group run
// had before there was a choice, so 'half' is stored as absent and runs saved
// back then read and key the same.
export const SEEN_BY_OPTIONS = [
  { value: 'no_one', label: 'No one has logged' },
  { value: 'half', label: "Half haven't logged" },
  { value: 'any', label: "Doesn't matter" },
] as const

export type SeenBy = (typeof SEEN_BY_OPTIONS)[number]['value']

export function seenByLabel(value: SeenBy): string {
  return SEEN_BY_OPTIONS.find((option) => option.value === value)!.label
}
