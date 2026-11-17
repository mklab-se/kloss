/**
 * The heads-up display: the model's file name and kloss count, the connection dot, the Auto-fit
 * switch, a hint while the model is empty, and the help card (toggled with `?`).
 */
import type { Status } from "./stream.ts";

export interface Overlay {
  setFile(name: string): void;
  setCount(n: number): void;
  setStatus(s: Status): void;
  setAutoFit(on: boolean): void;
  onAutoFitClick(fn: () => void): void;
  toggleHelp(force?: boolean): void;
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
  ["Home", "Back to the start view"],
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

export function createOverlay(root: HTMLElement): Overlay {
  const curl = `curl -X POST ${location.origin}/api/klossar -d '2x4 blue 2,0'`;

  const info = el("div", "hud hud-info");
  const dot = el("span", "dot");
  dot.title = "Connecting";
  const file = el("span", "file", "kloss");
  const count = el("span", "count", "");
  info.append(dot, file, count);

  const fit = el("button", "hud hud-fit");
  fit.type = "button";
  const fitKnob = el("span", "switch");
  fit.append(fitKnob, el("span", "", "Auto-fit"));

  const helpButton = el("button", "hud hud-help", "?");
  helpButton.type = "button";
  helpButton.title = "Controls";

  const empty = el("div", "empty");
  empty.append(el("div", "empty-title", "Drop your first kloss"), el("code", "empty-code", curl));

  const help = el("div", "help");
  help.hidden = true;
  help.append(el("div", "help-title", "Controls"));
  const table = el("dl", "help-table");
  for (const [key, what] of CONTROLS) table.append(el("dt", "", key), el("dd", "", what));
  help.append(table, el("div", "help-title", "Drop a kloss"), el("code", "help-code", curl));

  root.append(info, fit, helpButton, empty, help);

  let autoFitHandler = () => {};
  fit.addEventListener("click", () => autoFitHandler());

  const overlay: Overlay = {
    setFile(name) {
      file.textContent = name;
      document.title = `${name} · kloss`;
    },
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
  };
  helpButton.addEventListener("click", () => overlay.toggleHelp());
  window.addEventListener("keydown", (e) => {
    if (e.key === "?") overlay.toggleHelp();
    if (e.key === "Escape") overlay.toggleHelp(false);
  });
  return overlay;
}
