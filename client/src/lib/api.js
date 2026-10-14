// One place for talking to the API, so every request is checked the same way
export async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  if (res.status === 204) return null // success, nothing to read (e.g. after DELETE)

  const type = res.headers.get('content-type') || ''
  if (!type.includes('application/json')) {
    throw apiError(res.status, `${res.status} ${res.statusText}, ${type || 'no content type'}`)
  }
  const body = await res.json()
  if (!res.ok) {
    // The API answers errors as { error, details? }
    throw apiError(res.status, body.details ? body.details.join(', ') : body.error)
  }
  return body
}

// An Error that also remembers the HTTP status, so callers can react to 401
function apiError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}
