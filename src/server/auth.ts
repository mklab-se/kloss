/**
 * Login for a hosted kloss: any e-mail address plus one shared password (and a separate admin
 * password). Educational, not an identity system: nothing is stored and there is no sign-up.
 *
 * Tokens, OAuth client ids and authorization codes are all HMAC-signed rather than stored, so
 * they survive a restart (given a fixed KLOSS_TOKEN_SECRET), which matters when the hosted app
 * sleeps and wakes. Only "this code was already used" is remembered, in memory.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const enc = new TextEncoder();

function b64url(data: Uint8Array | string): string {
  return Buffer.from(typeof data === "string" ? enc.encode(data) : data).toString("base64url");
}

function sign(secret: Uint8Array, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type TokenKind = "access" | "refresh" | "admin" | "client" | "code";

/** A signed token: base64url(JSON claims) "." base64url(HMAC). */
export function signToken(
  secret: Uint8Array,
  claims: { kind: TokenKind } & Record<string, unknown>,
  ttlSeconds: number,
  now = Date.now(),
): string {
  const body = b64url(JSON.stringify({ ...claims, exp: now + ttlSeconds * 1000 }));
  return `${body}.${sign(secret, body)}`;
}

export function verifyToken(
  secret: Uint8Array,
  token: string,
  kind: TokenKind,
  now = Date.now(),
): Record<string, unknown> | null {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  if (!sameText(sig, sign(secret, body))) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (claims?.kind !== kind || typeof claims.exp !== "number" || claims.exp < now) return null;
    return claims;
  } catch {
    return null;
  }
}

/** PKCE S256: base64url(sha256(verifier)) must equal the challenge. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  const hashed = createHash("sha256").update(verifier).digest("base64url");
  return sameText(hashed, challenge);
}

export function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * Slows down guessing: five mistakes are free, then each attempt must wait twice as long as the
 * last (2 s, 4 s, 8 s, up to 15 minutes). Mistakes are forgotten 15 minutes after the last one.
 */
export class LoginLimiter {
  private readonly fails = new Map<string, { count: number; last: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Milliseconds to wait before the next attempt with this key (0: go ahead). */
  retryAfter(key: string): number {
    const f = this.fails.get(key);
    if (!f) return 0;
    const now = this.now();
    if (now - f.last > 15 * 60_000) {
      this.fails.delete(key);
      return 0;
    }
    if (f.count < 5) return 0;
    const wait = Math.min(15 * 60_000, 2000 * 2 ** (f.count - 5));
    return Math.max(0, f.last + wait - now);
  }

  failed(key: string): void {
    const f = this.fails.get(key);
    this.fails.set(key, { count: (f?.count ?? 0) + 1, last: this.now() });
  }

  succeeded(key: string): void {
    this.fails.delete(key);
  }
}

export type LoginResult =
  | { ok: true; email: string }
  | { ok: false; reason: string; retryAfterSeconds?: number };

export interface AuthOptions {
  password?: string;
  adminPassword?: string;
  secret: Uint8Array;
  now?: () => number;
}

export const ACCESS_TTL = 8 * 3600;
export const REFRESH_TTL = 7 * 24 * 3600;
const CODE_TTL = 120;
const CLIENT_TTL = 10 * 365 * 24 * 3600;

export class Auth {
  private readonly limiter: LoginLimiter;
  private readonly now: () => number;
  private readonly usedCodes = new Map<string, number>();

  constructor(private readonly opts: AuthOptions) {
    this.now = opts.now ?? Date.now;
    this.limiter = new LoginLimiter(this.now);
  }

  /** Login is on when a password is configured. */
  get enabled(): boolean {
    return Boolean(this.opts.password);
  }

  get adminEnabled(): boolean {
    return Boolean(this.opts.adminPassword);
  }

  private check(
    scope: string,
    expected: string | undefined,
    email: string,
    password: string,
    client: string,
  ): LoginResult {
    const who = email.trim().toLowerCase();
    const keys = [`${scope}:e:${who}`, `${scope}:c:${client}`];
    const wait = Math.max(...keys.map((k) => this.limiter.retryAfter(k)));
    if (wait > 0) {
      return {
        ok: false,
        reason: "too many attempts; wait a moment",
        retryAfterSeconds: Math.ceil(wait / 1000),
      };
    }
    const good = Boolean(expected) && isEmail(who) && sameText(password, expected ?? "");
    if (!good) {
      for (const k of keys) this.limiter.failed(k);
      return { ok: false, reason: "wrong e-mail address or password" };
    }
    for (const k of keys) this.limiter.succeeded(k);
    return { ok: true, email: who };
  }

  login(email: string, password: string, client: string): LoginResult {
    return this.check("user", this.opts.password, email, password, client);
  }

  adminLogin(email: string, password: string, client: string): LoginResult {
    return this.check("admin", this.opts.adminPassword, email, password, client);
  }

  accessToken(email: string): string {
    return signToken(this.opts.secret, { kind: "access", sub: email }, ACCESS_TTL, this.now());
  }

  refreshToken(email: string): string {
    return signToken(this.opts.secret, { kind: "refresh", sub: email }, REFRESH_TTL, this.now());
  }

  adminToken(email: string): string {
    return signToken(this.opts.secret, { kind: "admin", sub: email }, ACCESS_TTL, this.now());
  }

  /** The e-mail address a token of this kind was issued to, or null. */
  verify(token: string, kind: "access" | "refresh" | "admin"): string | null {
    const claims = verifyToken(this.opts.secret, token, kind, this.now());
    return typeof claims?.sub === "string" ? claims.sub : null;
  }

  /** OAuth dynamic client registration: the client id carries its redirect URIs, signed. */
  registerClient(redirectUris: string[]): string {
    return signToken(this.opts.secret, { kind: "client", r: redirectUris }, CLIENT_TTL, this.now());
  }

  clientRedirects(clientId: string): string[] | null {
    const claims = verifyToken(this.opts.secret, clientId, "client", this.now());
    const r = claims?.r;
    return Array.isArray(r) && r.every((u) => typeof u === "string") ? (r as string[]) : null;
  }

  issueCode(o: {
    email: string;
    clientId: string;
    redirectUri: string;
    challenge: string;
  }): string {
    return signToken(
      this.opts.secret,
      {
        kind: "code",
        sub: o.email,
        c: o.clientId,
        u: o.redirectUri,
        p: o.challenge,
        j: randomBytes(12).toString("base64url"),
      },
      CODE_TTL,
      this.now(),
    );
  }

  /** The e-mail address for a valid, unused code with a matching PKCE verifier, or null. */
  redeemCode(code: string, clientId: string, redirectUri: string, verifier: string): string | null {
    const claims = verifyToken(this.opts.secret, code, "code", this.now());
    if (!claims) return null;
    const { sub, c, u, p, j } = claims;
    if (typeof sub !== "string" || typeof j !== "string" || typeof p !== "string") return null;
    if (c !== clientId || u !== redirectUri || !pkceMatches(verifier, p)) return null;
    // forget long-expired codes, then refuse a second use
    const now = this.now();
    for (const [id, exp] of this.usedCodes) if (exp < now) this.usedCodes.delete(id);
    if (this.usedCodes.has(j)) return null;
    this.usedCodes.set(j, now + CODE_TTL * 1000);
    return sub;
  }
}

/** A secret from `NAME`, or from the file named by `NAME_FILE` (trimmed), or undefined. */
export async function readSecret(
  env: Record<string, string | undefined>,
  name: string,
): Promise<string | undefined> {
  const direct = env[name];
  if (direct) return direct;
  const file = env[`${name}_FILE`];
  if (file) return (await Bun.file(file).text()).trim() || undefined;
  return undefined;
}

/** The token-signing secret: KLOSS_TOKEN_SECRET if set (survives restarts), else random. */
export async function tokenSecret(env: Record<string, string | undefined>): Promise<Uint8Array> {
  const s = await readSecret(env, "KLOSS_TOKEN_SECRET");
  return s ? enc.encode(s) : new Uint8Array(randomBytes(32));
}
