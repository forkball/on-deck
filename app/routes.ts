import { del, form, get, put, post, route } from 'remix/routes'

export const routes = route({
  assets: get('/assets/*path'),
  home: '/',
  // The home page's activity feed, a page at a time. Answers rows, not a page:
  // the landing page renders the first one itself and this serves the rest as
  // the reader reaches them.
  feed: get('feed'),
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
  interactions: route('interactions', {
    update: put(':interactionId'),
    destroy: del(':interactionId'),
  }),
  profile: route('profile', {
    index: get('/'),
    watched: get('watched'),
    following: get('following'),
    followers: get('followers'),
    edit: form('edit', { formMethod: 'PUT', names: { action: 'update' } }),
    settings: post('settings'),
    rebuild: post('rebuild/:mediaType'),
    password: form('password', { formMethod: 'PUT', names: { action: 'update' } }),
    importMovies: route('import-movies', {
      index: get('/'),
      upload: post('/'),
    }),
    // A staged import, from matching through review to saving. Nested under
    // its own key rather than importMovies because the review page is
    // source-agnostic — goodreads and steam batches land here too.
    imports: route('imports', {
      show: get(':batchId'),
      // Polled by the matching page; answers counts, not markup.
      progress: get(':batchId/progress'),
      review: get(':batchId/review'),
      // Candidates for one row, for the picker modal.
      candidates: get(':batchId/rows/:rowId/candidates'),
      resolve: post(':batchId/rows/:rowId/resolve'),
      bulk: post(':batchId/bulk'),
      conflicts: post(':batchId/conflicts'),
      save: post(':batchId/save'),
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
    // One pick, no levers, once a day. A POST of its own rather than a preset on
    // `generate`: it has its own cap and its own rules about what may be picked,
    // and folding those into the general form's action would put both behind the
    // same parse.
    lucky: post('lucky'),
    // The dedicated page the draw is made from — same path as the POST above,
    // different method, the way profile's import routes pair an `index`
    // GET with an `upload` POST on '/'.
    luckyPage: get('lucky'),
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

// Where a "today's pick" call to action goes. Spelled once here rather than at
// each end: the landing page and the profile both link to it.
export function luckyRecommendationsHref(): string {
  return routes.recommendations.luckyPage.href()
}
