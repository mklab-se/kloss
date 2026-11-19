import { describe, expect, test } from "bun:test";
import { openApi } from "../../src/server/openapi.ts";

const spec = (auth = true) => openApi({ baseUrl: "https://kloss.example", version: "1.2.3", auth });

describe("the OpenAPI description", () => {
  test("is OpenAPI 3.1 for this server and version", () => {
    const s = spec();
    expect(s.openapi).toBe("3.1.0");
    expect(s.info.version).toBe("1.2.3");
    expect(s.servers).toEqual([{ url: "https://kloss.example" }]);
  });

  test("describes every REST call", () => {
    const paths = spec().paths as Record<string, Record<string, unknown>>;
    const calls = Object.entries(paths).flatMap(([p, ops]) =>
      Object.keys(ops)
        .filter((m) => ["get", "post", "put", "delete", "patch"].includes(m))
        .map((m) => `${m.toUpperCase()} ${p}`),
    );
    expect(calls.sort()).toEqual(
      [
        "GET /healthz",
        "POST /api/token",
        "GET /api/me",
        "POST /api/sessions",
        "GET /api/sessions/{code}",
        "DELETE /api/sessions/{code}",
        "POST /api/sessions/{code}/klossar",
        "DELETE /api/sessions/{code}/klossar/last",
        "GET /api/sessions/{code}/model",
        "PUT /api/sessions/{code}/model",
        "GET /api/sessions/{code}/model.kl",
        "GET /api/sessions/{code}/events",
        "POST /api/sessions/{code}/optimize",
        "GET /api/sessions/{code}/render.png",
        "GET /api/sessions/{code}/chickens",
        "POST /api/sessions/{code}/chickens",
      ].sort(),
    );
  });

  test("the intro sells building, visualizing and optimizing, then shows how to start", () => {
    const d = spec(true).info.description;
    for (const word of ["Build", "visualize", "Optimize", "/api/token", "```", "x,y|size|color"])
      expect(d).toContain(word);
    // without login there is nothing to log in to
    expect(spec(false).info.description).not.toContain("/api/token");
  });

  test("on purpose, says nothing about MCP, OAuth or the admin API", () => {
    const text = JSON.stringify(spec()).toLowerCase();
    for (const word of ["mcp", "oauth", "admin", "model context"]) expect(text).not.toContain(word);
  });

  test("with login on, calls need a bearer token (except health, token and me)", () => {
    const s = spec(true);
    expect(s.components.securitySchemes.bearer).toMatchObject({ type: "http", scheme: "bearer" });
    const paths = s.paths as Record<string, Record<string, { security?: unknown[] }>>;
    expect(paths["/healthz"]?.get?.security).toEqual([]);
    expect(paths["/api/token"]?.post?.security).toEqual([]);
    expect(s.security).toEqual([{ bearer: [] }]);
  });

  test("with login off, there is no login to describe", () => {
    const s = spec(false);
    expect(s.security).toBeUndefined();
    expect((s.paths as Record<string, unknown>)["/api/token"]).toBeUndefined();
  });
});
