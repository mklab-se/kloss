/**
 * The sessions kloss serves: many models at once, in memory only. A session that has not
 * changed and has no open viewer for `idleMs` is swept away.
 */
import { LimitError, Model } from "./model.ts";
import { newSessionCode } from "./session-code.ts";

export interface Session {
  code: string;
  model: Model;
  createdAt: number;
  /** Open viewers (live event streams). */
  viewers: number;
  /** When the last viewer left, or the session was created. */
  lastSeen: number;
}

export interface SessionOptions {
  idleMs: number;
  maxSessions: number;
  now?: () => number;
}

export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly now: () => number;

  constructor(private readonly opts: SessionOptions) {
    this.now = opts.now ?? Date.now;
  }

  get size(): number {
    return this.sessions.size;
  }

  /** A new session, empty or from .kl text (throws FormatError/LimitError, creating nothing). */
  create(text?: string, by?: string): Session {
    if (this.sessions.size >= this.opts.maxSessions) {
      throw new LimitError(`kloss holds at most ${this.opts.maxSessions} sessions right now`);
    }
    const model = text?.trim() ? Model.from(text, this.now, by) : new Model(this.now);
    let code = newSessionCode();
    while (this.sessions.has(code)) code = newSessionCode();
    const session: Session = {
      code,
      model,
      createdAt: this.now(),
      viewers: 0,
      lastSeen: this.now(),
    };
    this.sessions.set(code, session);
    return session;
  }

  get(code: string): Session | undefined {
    return this.sessions.get(code);
  }

  delete(code: string): boolean {
    const s = this.sessions.get(code);
    if (!s) return false;
    this.sessions.delete(code);
    s.model.emit({ type: "deleted" });
    return true;
  }

  /** Counts an open viewer; returns the function to call when it leaves. */
  watch(code: string): (() => void) | undefined {
    const s = this.sessions.get(code);
    if (!s) return undefined;
    s.viewers++;
    let left = false;
    return () => {
      if (left) return;
      left = true;
      s.viewers--;
      s.lastSeen = this.now();
    };
  }

  /** Removes idle sessions and returns their codes. */
  sweep(): string[] {
    const now = this.now();
    const gone: string[] = [];
    for (const [code, s] of this.sessions) {
      const active = Math.max(s.model.lastChange, s.lastSeen);
      if (s.viewers === 0 && now - active >= this.opts.idleMs) {
        this.delete(code);
        gone.push(code);
      }
    }
    return gone;
  }
}
