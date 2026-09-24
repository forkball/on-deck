// Posts in the background, then lets the caller bring the page up to date —
// the shared half of FrameForm, InPlaceForms and the import picker.
//
// Anything but a clean success becomes a real navigation to wherever the server
// sent us: a failed request, or a redirect carrying `?error=`, which a frame
// reload would otherwise throw away along with the message.
export async function postInPlace(
  action: string,
  body: FormData,
  signal: AbortSignal | undefined,
  afterSuccess: () => Promise<void>,
): Promise<void> {
  const response = await fetch(action, { method: 'POST', body, signal })
  if (signal?.aborted) return

  if (!response.ok || new URL(response.url, window.location.href).searchParams.has('error')) {
    window.location.href = response.url || action
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
