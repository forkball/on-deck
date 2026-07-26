import { form, get, put, post, route } from 'remix/routes'

export const routes = route({
  assets: get('/assets/*path'),
  home: '/',
  auth: route('auth', {
    signup: form('signup'),
    login: form('login'),
    logout: post('logout'),
  }),
  movies: route('movies', {
    search: get('search'),
    show: get(':mediaItemId'),
    log: post(':mediaItemId/log'),
    interactions: route('interactions', {
      update: put(':interactionId'),
    }),
  }),
  profile: form('profile', { formMethod: 'PUT', names: { action: 'update' } }),
})
