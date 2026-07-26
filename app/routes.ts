import { form, get, post, route } from 'remix/routes'

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
    log: post(':mediaItemId/log'),
  }),
  profile: form('profile', { formMethod: 'PUT', names: { action: 'update' } }),
})
