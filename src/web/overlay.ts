/**
 * The heads-up display: the session code and kloss count, the connection dot, the Auto-fit
 * switch, who just dropped what, a hint while the model is empty, the help card (toggled with
 * `?`), and a message when the session is gone.
 */
import { firstSteps, type Step } from "./first-steps.ts";
import type { Status } from "./stream.ts";

export interface About {
  version: string;
  auth: boolean;
  email: string | null;
}

export interface Overlay {
  setCount(n: number): void;
  setStatus(s: Status): void;
  setAutoFit(on: boolean): void;
  onAutoFitClick(fn: () => void): void;
  toggleHelp(force?: boolean): void;
  setAbout(a: About): void;
  /** Whether the MCP endpoint is on (it is only mentioned while it is). */
  setMcp(on: boolean): void;
  /** A short line about what just happened, like "ada@example.com dropped a blue 2x4". */
  activity(text: string): void;
  /** The session does not exist (any more). */
  gone(message: string): void;
}

const CONTROLS: [string, string][] = [
  ["Two-finger swipe", "Move the view"],
  ["Pinch", "Zoom toward the pointer"],
  ["Click and drag", "Rotate around the model"],
  ["Shift + swipe", "Rotate around the model"],
  ["Shift + drag", "Move the view"],
  ["Double-click", "Rotate around that point"],
  ["W A S D / arrows", "Move along the floor"],
  ["Q / E", "Rotate left / right"],
  ["+ / -", "Zoom in / out"],
  ["F or F6", "Fit the model, auto-fit on"],
  ["Home, or click the compass", "Back to the start view"],
  ["?", "Show or hide this card"],
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function createOverlay(root: HTMLElement, code: string): Overlay {
  const sessionUrl = `${location.origin}/s/${code}`;
  /** Fills a box with numbered steps: a short label, then its command to copy. */
  const showSteps = (box: HTMLElement, steps: Step[]) => {
    box.replaceChildren(
      ...steps.flatMap((s, i) => [
        el("div", "step-label", steps.length > 1 ? `${i + 1}. ${s.label}` : s.label),
        el("code", "step-code", s.command),
      ]),
    );
  };
  const initial = firstSteps({ origin: location.origin, code, auth: false });

  const info = el("div", "hud hud-info");
  const dot = el("span", "dot");
  dot.title = "Connecting";
  const name = el("button", "session-code", code);
  name.type = "button";
  name.title = "Copy the link to this session";
  const count = el("span", "count", "");
  info.append(dot, name, count);
  name.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(sessionUrl);
      name.textContent = "link copied";
      setTimeout(() => {
        name.textContent = code;
      }, 1400);
    } catch {}
  });

  const fit = el("button", "hud hud-fit");
  fit.type = "button";
  const fitKnob = el("span", "switch");
  fit.append(fitKnob, el("span", "", "Auto-fit"));

  const helpButton = el("button", "hud hud-help", "?");
  helpButton.type = "button";
  helpButton.title = "Controls";

  const empty = el("div", "empty");
  const emptySteps = el("div", "steps");
  showSteps(emptySteps, initial);
  empty.append(el("div", "empty-title", "Build from your terminal"), emptySteps);

  const feed = el("div", "activity");

  const help = el("div", "help");
  help.hidden = true;
  help.append(el("div", "help-title", "Controls"));
  const table = el("dl", "help-table");
  for (const [key, what] of CONTROLS) table.append(el("dt", "", key), el("dd", "", what));
  const helpSteps = el("div", "steps");
  showSteps(helpSteps, initial);
  const about = el("div", "help-about", "");
  const mcpLine = el("div", "help-about", "");
  mcpLine.hidden = true;
  help.append(
    table,
    el("div", "help-title", "Build from your terminal"),
    helpSteps,
    el("div", "help-title", "This session"),
    el("div", "help-about", sessionUrl),
    Object.assign(el("a", "help-about help-link", "API docs"), { href: "/docs", target: "_blank" }),
    about,
    mcpLine,
  );

  const goneCard = el("div", "gone");
  goneCard.hidden = true;

  root.append(info, fit, helpButton, empty, feed, help, goneCard);

  let autoFitHandler = () => {};
  fit.addEventListener("click", () => autoFitHandler());

  const overlay: Overlay = {
    setCount(n) {
      count.textContent = n === 1 ? "1 kloss" : `${n} klossar`;
      empty.hidden = n > 0;
    },
    setStatus(s) {
      dot.classList.toggle("live", s === "live");
      dot.title = s === "live" ? "Live" : "Reconnecting";
    },
    setAutoFit(on) {
      fit.classList.toggle("on", on);
      fit.setAttribute("aria-pressed", String(on));
      fit.title = on
        ? "Auto-fit is on: the whole model stays in view"
        : "Auto-fit is off (F turns it on)";
    },
    onAutoFitClick(fn) {
      autoFitHandler = fn;
    },
    toggleHelp(force) {
      help.hidden = force === undefined ? !help.hidden : !force;
    },
    setAbout(a) {
      about.textContent = `kloss ${a.version}${a.email ? ` · logged in as ${a.email}` : ""}`;
      const steps = firstSteps({ origin: location.origin, code, auth: a.auth, email: a.email });
      showSteps(emptySteps, steps);
      showSteps(helpSteps, steps);
    },
    setMcp(on) {
      mcpLine.hidden = !on;
      mcpLine.textContent = on ? `MCP endpoint: ${location.origin}/mcp` : "";
    },
    activity(text) {
      const line = el("div", "activity-line", text);
      feed.append(line);
      while (feed.children.length > 4) feed.firstElementChild?.remove();
      setTimeout(() => line.classList.add("fade"), 3500);
      setTimeout(() => line.remove(), 4500);
    },
    gone(message) {
      goneCard.replaceChildren(
        el("div", "gone-title", message),
        Object.assign(el("a", "gone-link", "Go to the start page"), { href: "/" }),
      );
      goneCard.hidden = false;
      empty.hidden = true;
      dot.classList.remove("live");
    },
  };
  helpButton.addEventListener("click", () => overlay.toggleHelp());
  window.addEventListener("keydown", (e) => {
    if (e.key === "?") overlay.toggleHelp();
    if (e.key === "Escape") overlay.toggleHelp(false);
  });
  return overlay;
}
