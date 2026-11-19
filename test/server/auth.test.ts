import { describe, expect, test } from "bun:test";
import {
  Auth,
  isEmail,
  LoginLimiter,
  pkceMatches,
  readSecret,
  signToken,
  verifyToken,
} from "../../src/server/auth.ts";

const secret = new TextEncoder().encode("test-secret-test-secret-test-secret");

describe("tokens", () => {
  test("a signed token verifies and carries its claims", () => {
    const t = signToken(secret, { kind: "access", sub: "ada@example.com" }, 60, 1000);
    expect(verifyToken(secret, t, "access", 1000)).toMatchObject({ sub: "ada@example.com" });
  });

  test("expired, wrong kind, tampered or foreign tokens do not verify", () => {
    const t = signToken(secret, { kind: "access", sub: "ada@example.com" }, 60, 1000);
    expect(verifyToken(secret, t, "access", 1000 + 61_000)).toBeNull();
    expect(verifyToken(secret, t, "refresh", 1000)).toBeNull();
    const [body = "", sig = ""] = t.split(".");
    expect(verifyToken(secret, `${body}x.${sig}`, "access", 1000)).toBeNull();
    const other = new TextEncoder().encode("another-secret-another-secret-xx");
    expect(verifyToken(other, t, "access", 1000)).toBeNull();
    expect(verifyToken(secret, "nonsense", "access", 1000)).toBeNull();
  });
});

describe("login", () => {
  test("any e-mail address with the configured password", () => {
    const auth = new Auth({ password: "letmein", secret });
    expect(auth.enabled).toBe(true);
    expect(auth.login("ada@example.com", "letmein", "1.2.3.4")).toEqual({
      ok: true,
      email: "ada@example.com",
    });
    expect(auth.login("Bob@Example.com", "letmein", "1.2.3.4")).toEqual({
      ok: true,
      email: "bob@example.com",
    });
    expect(auth.login("ada@example.com", "wrong", "1.2.3.4").ok).toBe(false);
    expect(auth.login("not-an-email", "letmein", "1.2.3.4").ok).toBe(false);
  });

  test("login is off without a password", () => {
    expect(new Auth({ secret }).enabled).toBe(false);
  });

  test("the admin password is separate", () => {
    const auth = new Auth({ password: "class", adminPassword: "boss", secret });
    expect(auth.adminLogin("me@example.com", "boss", "x").ok).toBe(true);
    expect(auth.adminLogin("me@example.com", "class", "x").ok).toBe(false);
    expect(new Auth({ password: "class", secret }).adminEnabled).toBe(false);
  });

  test("isEmail", () => {
    expect(isEmail("a@b.se")).toBe(true);
    expect(isEmail("a@b")).toBe(false);
    expect(isEmail(" a@b.se")).toBe(false);
    expect(isEmail("a b@c.se")).toBe(false);
  });
});

describe("LoginLimiter", () => {
  test("a few mistakes are free; then each attempt must wait longer", () => {
    let now = 0;
    const l = new LoginLimiter(() => now);
    for (let i = 0; i < 5; i++) {
      expect(l.retryAfter("k")).toBe(0);
      l.failed("k");
    }
    expect(l.retryAfter("k")).toBeGreaterThan(0);
    now += 60_000;
    expect(l.retryAfter("k")).toBe(0);
    l.failed("k");
    const second = l.retryAfter("k");
    expect(second).toBeGreaterThan(1000);
    l.succeeded("k");
    expect(l.retryAfter("k")).toBe(0);
  });

  test("Auth.login refuses while a key must wait, even with the right password", () => {
    const auth = new Auth({ password: "letmein", secret });
    for (let i = 0; i < 6; i++) auth.login("ada@example.com", "nope", "9.9.9.9");
    const r = auth.login("ada@example.com", "letmein", "9.9.9.9");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe("OAuth helpers", () => {
  test("PKCE S256", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    // the example from RFC 7636
    expect(pkceMatches(verifier, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(true);
    expect(pkceMatches(`${verifier}x`, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(false);
  });

  test("a registered client id carries its redirect URIs and survives a restart", () => {
    const a = new Auth({ password: "p", secret });
    const id = a.registerClient(["http://localhost:3333/callback"]);
    const b = new Auth({ password: "p", secret });
    expect(b.clientRedirects(id)).toEqual(["http://localhost:3333/callback"]);
    expect(b.clientRedirects("made-up")).toBeNull();
  });

  test("an authorization code is used once, for the client and redirect it was issued to", () => {
    const auth = new Auth({ password: "p", secret });
    const client = auth.registerClient(["http://localhost/cb"]);
    const code = auth.issueCode({
      email: "ada@example.com",
      clientId: client,
      redirectUri: "http://localhost/cb",
      challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    });
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(auth.redeemCode(code, client, "http://localhost/other", verifier)).toBeNull();
    const ok = auth.redeemCode(code, client, "http://localhost/cb", verifier);
    expect(ok).toBe("ada@example.com");
    expect(auth.redeemCode(code, client, "http://localhost/cb", verifier)).toBeNull();
  });
});

describe("readSecret", () => {
  test("from the variable, from a file, or nothing", async () => {
    const dir = `${process.env.TMPDIR ?? "/tmp"}/kloss-secret-${Date.now()}`;
    await Bun.write(`${dir}/pw`, "from-file\n");
    expect(await readSecret({ KLOSS_PASSWORD: "x" }, "KLOSS_PASSWORD")).toBe("x");
    expect(await readSecret({ KLOSS_PASSWORD_FILE: `${dir}/pw` }, "KLOSS_PASSWORD")).toBe(
      "from-file",
    );
    expect(await readSecret({}, "KLOSS_PASSWORD")).toBeUndefined();
  });
});
