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

// What a form posted in place folds once it has saved: the
// <details data-close-on-submit> it sits in (a FloatingDropdown, an import
// review row) and the Modal it sits in. Both opt in by attribute rather than
// "any enclosing <details>", so a form inside a Collapsible doesn't fold the
// section around it. Runs before the caller's reload, while these ancestors
// still exist in the DOM the frame swap is about to replace.
function closeSubmittedForm(form: HTMLFormElement): void {
  form.closest('details[data-close-on-submit]')?.removeAttribute('open')
  const toggle = form.closest('[data-modal]')?.querySelector<HTMLInputElement>('input[data-modal-toggle]')
  if (toggle) toggle.checked = false
}

// postInPlace for a server-rendered <form>, with its submit buttons disabled
// while the request is out, and its dropdown or modal closed once it has saved.
export async function submitInPlace(
  form: HTMLFormElement,
  signal: AbortSignal,
  afterSuccess: () => Promise<unknown>,
): Promise<void> {
  // The attribute, not `form.action`: a field named "action" (the import
  // review's forms have one) shadows that property with the input element.
  const action = form.getAttribute('action') ?? window.location.href
  const buttons = Array.from(form.querySelectorAll<HTMLButtonElement>('button[type="submit"]'))
  for (const button of buttons) button.disabled = true

  try {
    await postInPlace(action, new FormData(form), signal, async () => {
      closeSubmittedForm(form)
      await afterSuccess()
    })
  } finally {
    if (!signal.aborted) for (const button of buttons) button.disabled = false
  }
}
