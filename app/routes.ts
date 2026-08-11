import { del, form, get, put, post, route } from 'remix/routes'

export const routes = route({
  assets: get('/assets/*path'),
  home: '/',
  // The nav's "Media" link — redirects to /movies/search or /tv/search
  // based on whichever type the user was last looking at (see
  // middleware/mediaType.ts), so it doesn't always bounce back to movies.
  media: get('media'),
  auth: route('auth', {
    signup: form('signup'),
    login: form('login'),
    logout: post('logout'),
  }),
  notifications: route('notifications', {
    index: get('/'),
    unreadCount: get('unread-count'),
    read: get(':notificationId/read'),
  }),
  movies: route('movies', {
    search: get('search'),
    suggest: get('suggest'),
    import: get('import'),
    show: get(':mediaItemId'),
    log: post(':mediaItemId/log'),
    rematch: post(':mediaItemId/rematch'),
  }),
  books: route('books', {
    search: get('search'),
    suggest: get('suggest'),
    import: get('import'),
    show: get(':mediaItemId'),
    log: post(':mediaItemId/log'),
    rematch: post(':mediaItemId/rematch'),
  }),
  games: route('games', {
    search: get('search'),
    suggest: get('suggest'),
    import: get('import'),
    show: get(':mediaItemId'),
    log: post(':mediaItemId/log'),
    rematch: post(':mediaItemId/rematch'),
  }),
  tv: route('tv', {
    search: get('search'),
    suggest: get('suggest'),
    import: get('import'),
    show: get(':mediaItemId'),
    log: post(':mediaItemId/log'),
    rematch: post(':mediaItemId/rematch'),
  }),
  // Not media-type-specific — a logged interaction is just a (user, media
  // item) row regardless of whether that item is a movie or a TV show, so
  // both the movie and TV detail/edit UIs post here rather than each having
  // their own copy.
  interactions: route('interactions', {
    update: put(':interactionId'),
    destroy: del(':interactionId'),
  }),
  profile: route('profile', {
    index: get('/'),
    watched: get('watched'),
    following: get('following'),
    followers: get('followers'),
    // Email, username and bio, on their own page rather than inline on the
    // profile — the two handles are unique and validated, so editing them
    // needs somewhere to put per-field errors.
    edit: form('edit', { formMethod: 'PUT', names: { action: 'update' } }),
    importMovies: route('import-movies', {
      index: get('/'),
      upload: post('/'),
    }),
    importBooks: route('import-books', {
      index: get('/'),
      upload: post('/'),
    }),
    importGames: route('import-games', {
      index: get('/'),
      upload: post('/'),
    }),
    // Linking a Steam account. `connect` redirects out to Steam, `callback`
    // is where Steam redirects back — a GET, because that's what OpenID
    // does, which is why its parameters are verified rather than trusted.
    steam: route('steam', {
      connect: get('connect'),
      callback: get('callback'),
      disconnect: post('disconnect'),
    }),
  }),
  recommendations: route('recommendations', {
    index: get('/'),
    generate: post('/'),
    // The wait while a run is generating, and the endpoint it polls. Both
    // keyed by a persisted job id (see data/recommendations/jobs.ts).
    generating: get('generating/:jobId'),
    status: get('status/:jobId'),
    show: get(':runId'),
  }),
  users: route('users', {
    search: get('search'),
    suggest: get('suggest'),
    show: get(':userId'),
    watched: get(':userId/watched'),
    following: get(':userId/following'),
    followers: get(':userId/followers'),
    follow: post(':userId/follow'),
    unfollow: post(':userId/unfollow'),
  }),
})
