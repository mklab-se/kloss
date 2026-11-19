/** fetch for the kloss API: when login is needed, go to the login page and come back. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(path, init);
  if (res.status === 401) {
    location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
  }
  return res;
}
