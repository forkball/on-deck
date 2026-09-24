// "1 movie", "3 movies". In app/ui/shared because that is the one place every
// layer can import from — client entries included, which may import nothing
// else outside app/browser.
export function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}
