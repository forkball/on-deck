// 4px spacing scale — keep every padding/gap value on this grid for a
// consistent rhythm instead of one-off px numbers. Lives under app/assets/lib
// (not app/ui/components/styles.ts) because the asset bundler only resolves
// imports rooted under app/assets/**.
export const space = {
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
} as const
