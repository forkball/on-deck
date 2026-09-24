// "1 movie", "3 movies". Here rather than in app/ui/components because the
// import picker, a client entry, needs it too, and app/ui/shared is the part of
// app/ui a client entry may import.
export function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}
