/**
 * Small server-rendered pages: the login form (also used by OAuth's authorize step) and the
 * admin page. Plain HTML forms, so they work without any JavaScript.
 */

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const STYLE = `
:root { --ink: #1f2328; --muted: #5d6670; --line: rgba(31,35,40,.14); --accent: #2f80dc; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px;
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: var(--ink); background: linear-gradient(#3f8fdc 0%, #c4e0f6 55%, #8fc483 55.2%, #6aa364 100%); }
main { width: min(380px, 100%); background: rgba(255,255,255,.92); border-radius: 16px;
  padding: 26px 24px; box-shadow: 0 12px 40px rgba(20,40,60,.25); }
h1 { margin: 0 0 4px; font-size: 24px; letter-spacing: -.01em; }
p { margin: 0 0 18px; color: var(--muted); line-height: 1.45; }
label { display: block; font-size: 13px; font-weight: 600; margin: 12px 0 5px; }
input[type=email], input[type=password], input[type=text] { width: 100%; padding: 10px 12px;
  border: 1px solid var(--line); border-radius: 9px; font: inherit; background: #fff; }
button { margin-top: 18px; width: 100%; padding: 11px; border: 0; border-radius: 9px;
  background: var(--accent); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
button.secondary { background: #e9edf1; color: var(--ink); }
.error { color: #b3261e; background: #fbe9e7; border-radius: 8px; padding: 8px 10px; margin: 0 0 12px; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 0; border-top: 1px solid var(--line); }
.state { font-weight: 700; } .on { color: #2f8a4c; } .off { color: var(--muted); }
small { color: var(--muted); }
`;

function page(title: string, body: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

export function withStatus(res: Response, status: number, headers: Record<string, string> = {}) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(headers)) h.set(k, v);
  return new Response(res.body, { status, headers: h });
}

export interface LoginFormOptions {
  action: string;
  heading?: string;
  intro?: string;
  error?: string;
  email?: string;
  /** Extra hidden fields to post back (OAuth parameters, where to go next). */
  hidden?: Record<string, string>;
  button?: string;
}

export function loginPage(o: LoginFormOptions): Response {
  const hidden = Object.entries(o.hidden ?? {})
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join("");
  return page(
    "Log in · kloss",
    `<h1>${escapeHtml(o.heading ?? "kloss")}</h1>
<p>${escapeHtml(o.intro ?? "Log in with your e-mail address and the password you were given.")}</p>
${o.error ? `<div class="error">${escapeHtml(o.error)}</div>` : ""}
<form method="post" action="${escapeHtml(o.action)}">${hidden}
<label for="email">E-mail address</label>
<input id="email" name="email" type="email" autocomplete="email" required value="${escapeHtml(o.email ?? "")}">
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required>
<button type="submit">${escapeHtml(o.button ?? "Log in")}</button>
</form>`,
  );
}

export function adminPage(o: { mcp: boolean; email?: string; loginOn: boolean }): Response {
  const state = o.mcp ? `<span class="state on">On</span>` : `<span class="state off">Off</span>`;
  return page(
    "Admin · kloss",
    `<h1>kloss admin</h1>
<p>${o.email ? `Logged in as ${escapeHtml(o.email)}.` : "Login is off on this kloss."}</p>
<div class="row"><div><strong>MCP endpoint</strong><br><small>At <code>/mcp</code>. While off, nothing reveals it.</small></div>${state}</div>
<form method="post" action="/admin/mcp"><input type="hidden" name="enabled" value="${o.mcp ? "false" : "true"}">
<button type="submit">${o.mcp ? "Turn MCP off" : "Turn MCP on"}</button></form>
${o.loginOn ? `<form method="post" action="/admin/logout"><button class="secondary" type="submit">Log out of admin</button></form>` : ""}`,
  );
}
