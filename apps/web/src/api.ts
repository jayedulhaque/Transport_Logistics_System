const apiBase = () =>
  import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? 'http://localhost:5000';

export const signalrBase = () =>
  import.meta.env.VITE_SIGNALR_URL?.replace(/\/$/, '') ?? apiBase();

export function getToken(): string | null {
  return localStorage.getItem('transport_token');
}

export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');

  const res = await fetch(`${apiBase()}${path}`, { ...options, headers });
  return res;
}
