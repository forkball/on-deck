import { del, form, get, put, post, route } from 'remix/routes'

export const routes = route({
  assets: get('/assets/*path'),
  home: '/',
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
    interactions: route('interactions', {
      update: put(':interactionId'),
      destroy: del(':interactionId'),
    }),
  }),
  profile: route('profile', {
    index: get('/'),
    watched: get('watched'),
    following: get('following'),
    followers: get('followers'),
    updateBio: put('bio'),
    import: route('import', {
      index: get('/'),
      upload: post('/'),
    }),
  }),
  recommendations: route('recommendations', {
    index: get('/'),
    generate: post('/'),
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
