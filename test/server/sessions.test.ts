import { describe, expect, test } from "bun:test";
import { FormatError } from "../../src/core/format.ts";
import { LimitError } from "../../src/server/model.ts";
import { isSessionCode, newSessionCode } from "../../src/server/session-code.ts";
import { SessionStore } from "../../src/server/sessions.ts";

describe("session codes", () => {
  test("two short words and a number, easy to read out", () => {
    for (let i = 0; i < 200; i++) {
      const code = newSessionCode();
      expect(code).toMatch(/^[a-z]{3,7}-[a-z]{3,7}-\d{2}$/);
      expect(isSessionCode(code)).toBe(true);
    }
  });

  test("isSessionCode refuses anything else", () => {
    for (const bad of ["", "otter", "otter-maple", "Otter-maple-42", "otter-maple-4", "../etc"]) {
      expect(isSessionCode(bad)).toBe(false);
    }
  });

  test("codes are varied", () => {
    const seen = new Set(Array.from({ length: 300 }, () => newSessionCode()));
    expect(seen.size).toBeGreaterThan(290);
  });
});

describe("SessionStore", () => {
  function store(opts: { idleMs?: number; maxSessions?: number } = {}) {
    let now = 0;
    const s = new SessionStore({
      idleMs: opts.idleMs ?? 60_000,
      maxSessions: opts.maxSessions ?? 100,
      now: () => now,
    });
    return { s, advance: (ms: number) => (now += ms) };
  }

  test("create gives a fresh session with a unique code; get finds it; delete removes it", () => {
    const { s } = store();
    const a = s.create();
    const b = s.create();
    expect(a.code).not.toBe(b.code);
    expect(s.get(a.code)).toBe(a);
    expect(s.delete(a.code)).toBe(true);
    expect(s.get(a.code)).toBeUndefined();
    expect(s.delete(a.code)).toBe(false);
    expect(s.size).toBe(1);
  });

  test("a session can start from .kl text; invalid text creates nothing", () => {
    const { s } = store();
    expect(s.create("0,0|2x2|red\n.\n").model.klossar).toHaveLength(2);
    expect(() => s.create("0,0|9x9|red\n")).toThrow(FormatError);
    expect(s.size).toBe(1);
  });

  test("deleting tells the session's listeners", () => {
    const { s } = store();
    const a = s.create();
    const events: string[] = [];
    a.model.subscribe((e) => events.push(e.type));
    s.delete(a.code);
    expect(events).toEqual(["deleted"]);
  });

  test("idle sessions are swept, but not while someone watches or after a change", () => {
    const { s, advance } = store({ idleMs: 1000 });
    const idle = s.create();
    const watched = s.create();
    const busy = s.create();
    const leave = s.watch(watched.code);
    advance(800);
    busy.model.drop({ size: "1x1", color: "red", x: 0, y: 0 });
    advance(400);
    expect(s.sweep()).toEqual([idle.code]);
    expect(s.get(watched.code)).toBeDefined();
    expect(s.get(busy.code)).toBeDefined();
    leave?.();
    advance(1100);
    expect(s.sweep().sort()).toEqual([busy.code, watched.code].sort());
  });

  test("the session limit is enforced", () => {
    const { s } = store({ maxSessions: 2 });
    s.create();
    s.create();
    expect(() => s.create()).toThrow(LimitError);
  });
});
