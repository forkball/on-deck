// The `:xId` segments of the route map are database ids, but the router hands
// them over as whatever text was in the path. Read through here so a path like
// /users/abc or /users/-1 answers 404 rather than reaching Postgres as NaN.
//
// Here rather than in each controller because every route area with an id in
// its path needs the same rule, and app/actions is the narrowest place they share.
// Capped at Postgres's `integer`, which every id column is: a larger number is
// no row, and sent as a parameter it is an "out of range" error instead.
const MAX_ID = 2_147_483_647

export function parseIdParam(value: string | undefined): number | null {
  if (value == null || !/^[1-9]\d{0,9}$/.test(value)) return null
  const id = Number(value)
  return id <= MAX_ID ? id : null
}

export function notFound(): Response {
  return new Response('Not Found', { status: 404 })
}
