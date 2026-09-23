// Posts a server-rendered <form> in the background, then lets the caller bring
// the page up to date — the shared half of FrameForm and InPlaceForms.
//
// Anything but a clean success becomes a real navigation to wherever the server
// sent us: a failed request, or a redirect carrying `?error=`, which a frame
// reload would otherwise throw away along with the message.
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
    const response = await fetch(action, { method: 'POST', body: new FormData(form), signal })
    if (signal.aborted) return

    if (!response.ok || new URL(response.url, window.location.href).searchParams.has('error')) {
      window.location.href = response.url || action
      return
    }

    await afterSuccess()
  } finally {
    if (!signal.aborted) for (const button of buttons) button.disabled = false
  }
}
