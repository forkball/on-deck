import { del, form, get, put, post, route } from 'remix/routes'

export const routes = route({
  assets: get('/assets/*path'),
  home: '/',
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
