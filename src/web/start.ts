/** The start page: go to a session by its code, or start a new one. */
import { apiFetch } from "./api.ts";

const form = document.querySelector<HTMLFormElement>("#join");
const input = document.querySelector<HTMLInputElement>("#code");
const error = document.querySelector<HTMLDivElement>("#error");
const button = document.querySelector<HTMLButtonElement>("#new");
const who = document.querySelector<HTMLParagraphElement>("#who");

function show(message: string): void {
  if (!error) return;
  error.textContent = message;
  error.hidden = false;
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = (input?.value ?? "").trim().toLowerCase().replace(/\s+/g, "-");
  if (!code) return;
  const res = await apiFetch(`/api/sessions/${encodeURIComponent(code)}`);
  if (res.ok) location.href = `/s/${code}`;
  else if (res.status === 404)
    show(`There is no session "${code}". Check the code, or start a new one.`);
  else show("Something went wrong; try again.");
});

button?.addEventListener("click", async () => {
  const res = await apiFetch("/api/sessions", { method: "POST" });
  if (!res.ok) {
    show(
      res.status === 503
        ? "kloss is full right now; try again later."
        : "Could not start a session.",
    );
    return;
  }
  const { code } = (await res.json()) as { code: string };
  location.href = `/s/${code}`;
});

(async () => {
  const me = (await (await fetch("/api/me")).json()) as {
    auth: boolean;
    email: string | null;
    version: string;
  };
  if (me.auth && !me.email) {
    location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
    return;
  }
  if (who) who.textContent = `${me.email ? `Logged in as ${me.email} · ` : ""}kloss ${me.version}`;
})();
