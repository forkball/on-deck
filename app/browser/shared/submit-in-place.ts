// Posts in the background, then lets the caller update the page. A failed request
// or a redirect carrying ?error= becomes a real navigation so the message shows.
export async function postInPlace(
  action: string,
  body: FormData,
  signal: AbortSignal | undefined,
  afterSuccess: () => Promise<void>,
): Promise<void> {
  // The server answers a redirect with 204 and its target (middleware/inPlace.ts).
  const response = await fetch(action, { method: 'POST', body, signal, headers: { 'x-in-place': '1' } })
  if (signal?.aborted) return

  const target = response.headers.get('x-location') ?? response.url
  if (!response.ok || new URL(target || action, window.location.href).searchParams.has('error')) {
    window.location.href = target || action
    return
  }

  await afterSuccess()
}

// postInPlace for a server-rendered <form>, with its submit buttons disabled
// while the request is out.
export async function submitInPlace(
  form: HTMLFormElement,
  signal: AbortSignal,
  afterSuccess: () => Promise<void>,
): Promise<void> {
  // The attribute, not `form.action`: a field named "action" (the import
  // review's forms have one) shadows that property with the input element.
  const action = form.getAttribute('action') ?? window.location.href
  const buttons = Array.from(form.querySelectorAll<HTMLButtonElement>('button[type="submit"]'))
  for (const button of buttons) button.disabled = true

  try {
    await postInPlace(action, new FormData(form), signal, afterSuccess)
  } finally {
    if (!signal.aborted) for (const button of buttons) button.disabled = false
  }
}
