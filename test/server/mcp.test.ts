import { describe, expect, test } from "bun:test";
import { handleMcp, type McpContext } from "../../src/server/mcp.ts";
import { SessionStore } from "../../src/server/sessions.ts";

function context(email?: string): McpContext {
  return {
    sessions: new SessionStore({ idleMs: 60_000, maxSessions: 10 }),
    email,
    baseUrl: "http://kloss.test",
    version: "9.9.9",
  };
}

let nextId = 1;
function call(ctx: McpContext, method: string, params?: Record<string, unknown>) {
  return handleMcp({ jsonrpc: "2.0", id: nextId++, method, params }, ctx) as {
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  };
}

function tool(ctx: McpContext, name: string, args: Record<string, unknown> = {}) {
  const r = call(ctx, "tools/call", { name, arguments: args }).result as {
    isError?: boolean;
    content: { text: string }[];
  };
  const text = r.content[0]?.text ?? "";
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {}
  return { isError: Boolean(r.isError), text, data: data as Record<string, unknown> };
}

describe("MCP protocol", () => {
  test("initialize names kloss and its version, and agrees on a protocol version", () => {
    const r = call(context(), "initialize", { protocolVersion: "2025-06-18" }).result;
    expect(r?.protocolVersion).toBe("2025-06-18");
    expect(r?.serverInfo).toMatchObject({ name: "kloss", version: "9.9.9" });
    expect(String(r?.instructions)).toContain("create_session");
  });

  test("tools/list offers the nine tools, and none of them lists sessions", () => {
    const tools = (call(context(), "tools/list").result?.tools ?? []) as { name: string }[];
    expect(tools.map((t) => t.name).sort()).toEqual([
      "create_session",
      "delete_session",
      "drop_klossar",
      "get_model",
      "kloss_format",
      "optimize_model",
      "render_model",
      "replace_model",
      "undo_kloss",
    ]);
  });

  test("unknown methods and tools are JSON-RPC errors; notifications get no answer", () => {
    expect(call(context(), "nope").error?.code).toBe(-32601);
    expect(call(context(), "tools/call", { name: "nope" }).error?.code).toBe(-32602);
    expect(
      handleMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, context()),
    ).toBeNull();
  });
});

describe("MCP tools", () => {
  test("create, drop with carry-over, read back, replace and delete", () => {
    const ctx = context("ada@example.com");
    const made = tool(ctx, "create_session");
    const code = String(made.data.code);
    expect(made.data.url).toBe(`http://kloss.test/s/${code}`);

    const dropped = tool(ctx, "drop_klossar", {
      code,
      lines: ["0,0|2x2|red", ".", "2,0|2x4|blue"],
    });
    expect(dropped.isError).toBe(false);
    expect((dropped.data.placed as { level: number }[]).map((k) => k.level)).toEqual([0, 1, 0]);

    const model = tool(ctx, "get_model", { code });
    expect(model.data.klossar).toBe(3);
    expect(String(model.data.model)).toContain("2x4 | blue");
    expect(model.data.droppedBy).toEqual(["ada@example.com"]);

    expect(tool(ctx, "replace_model", { code, model: "0,0|1x1|lime\n" }).data.klossar).toBe(1);
    expect(tool(ctx, "delete_session", { code }).isError).toBe(false);
    expect(tool(ctx, "get_model", { code }).isError).toBe(true);
  });

  test("a session can start from a model; a bad line stops the drop and says which", () => {
    const ctx = context();
    const code = String(tool(ctx, "create_session", { model: "0,0|2x2|red\n" }).data.code);
    const r = tool(ctx, "drop_klossar", { code, lines: ["1,1", "1,1|2x2|teal", "5,5"] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("line 2");
    expect(r.text).toContain('"teal"');
    expect(tool(ctx, "get_model", { code }).data.klossar).toBe(2);
  });

  test("unknown session codes are a tool error that suggests create_session", () => {
    const r = tool(context(), "drop_klossar", { code: "no-such-42", lines: ["0,0|1x1|red"] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("create_session");
  });

  test("kloss_format explains the line format", () => {
    expect(tool(context(), "kloss_format").text).toContain("x,y|size|color");
  });
});

test("undo_kloss takes back the latest kloss, and says so when there is none", () => {
  const ctx = context("ada@example.com");
  const code = String(tool(ctx, "create_session").data.code);
  tool(ctx, "drop_klossar", { code, lines: ["0,0|2x2|red", "2,0|2x4|blue"] });
  const r = tool(ctx, "undo_kloss", { code });
  expect(r.isError).toBe(false);
  expect(r.data).toMatchObject({ undone: { color: "blue" }, klossar: 1 });
  tool(ctx, "undo_kloss", { code });
  const none = tool(ctx, "undo_kloss", { code });
  expect(none.isError).toBe(true);
  expect(none.text).toContain("nothing to undo");
});

test("optimize_model merges klossar, or only reports with preview", () => {
  const ctx = context();
  const code = String(
    tool(ctx, "create_session", { model: "0,0|2x2|red\n2,0|2x2|red\n" }).data.code,
  );
  expect(tool(ctx, "optimize_model", { code, preview: true }).data).toMatchObject({
    before: 2,
    after: 1,
    applied: false,
  });
  expect(tool(ctx, "optimize_model", { code }).data).toMatchObject({ after: 1, applied: true });
  expect(tool(ctx, "get_model", { code }).data.klossar).toBe(1);
});

test("render_model returns the picture as an image the agent can see", () => {
  const ctx = context();
  const code = String(tool(ctx, "create_session", { model: "0,0|2x4|red\n" }).data.code);
  const r = call(ctx, "tools/call", { name: "render_model", arguments: { code, view: "iso" } })
    .result as { content: { type: string; mimeType?: string; data?: string; text?: string }[] };
  const image = r.content.find((c) => c.type === "image");
  expect(image?.mimeType).toBe("image/png");
  const bytes = Buffer.from(image?.data ?? "", "base64");
  expect([...bytes.subarray(1, 4)]).toEqual([80, 78, 71]);
  expect(r.content.some((c) => c.type === "text")).toBe(true);
});

describe("guidance for the everyday requests", () => {
  const instructions = () =>
    String(call(context(), "initialize", { protocolVersion: "2025-06-18" }).result?.instructions);
  const description = (name: string) => {
    const tools = (call(context(), "tools/list").result?.tools ?? []) as {
      name: string;
      description: string;
    }[];
    return tools.find((t) => t.name === name)?.description ?? "";
  };

  test("visualize: ask whether the user wants the live 3D view or a picture", () => {
    expect(instructions()).toContain("live 3D view");
    expect(instructions()).toContain("render_model");
  });

  test("open: start a session from the file and share its link", () => {
    expect(instructions()).toContain("share the session's url");
  });

  test("'the open model' is the session from earlier in the conversation", () => {
    expect(instructions()).toContain("the open model");
  });

  test("save: get_model and write the text to the file", () => {
    expect(instructions()).toContain("get_model");
    expect(description("get_model")).toContain("save");
  });

  test("render_model also gives a link to the picture, for harnesses that do not show images", () => {
    const ctx = context();
    const code = String(tool(ctx, "create_session", { model: "0,0|2x4|red\n" }).data.code);
    const r = call(ctx, "tools/call", { name: "render_model", arguments: { code } }).result as {
      content: { type: string; text?: string }[];
    };
    const text = r.content.find((c) => c.type === "text")?.text ?? "";
    expect(text).toContain(`http://kloss.test/api/sessions/${code}/render.png?view=iso`);
  });

  test("an expired session says why and how to get it back", () => {
    const r = tool(context(), "get_model", { code: "gone-away-12" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("expired");
    expect(r.text).toContain("restarted");
    expect(r.text).toContain("create_session");
  });
});

describe("chickens are not part of MCP, on purpose", () => {
  test("neither the instructions nor any tool mentions them", () => {
    const ctx = context();
    const text = JSON.stringify([
      call(ctx, "initialize", { protocolVersion: "2025-06-18" }).result,
      call(ctx, "tools/list").result,
    ]).toLowerCase();
    for (const word of ["chicken", "flock", "hen"])
      expect(text).not.toMatch(new RegExp(`\\b${word}`));
  });

  test("there is no tool to spawn them, whatever an agent tries", () => {
    const ctx = context();
    for (const name of ["spawn_chickens", "spawn_chicken", "chickens"]) {
      const r = call(ctx, "tools/call", { name, arguments: {} });
      const failed = Boolean(r.error) || Boolean((r.result as { isError?: boolean })?.isError);
      expect(failed).toBe(true);
    }
  });

  test("an agent reading a model sees klossar only, even when chickens roam it", () => {
    const ctx = context();
    const s = ctx.sessions.create("0,0|2x2|red\n");
    s.flock.spawn({ count: 3 });
    const r = tool(ctx, "get_model", { code: s.code });
    expect(r.text.toLowerCase()).not.toContain("chicken");
  });
});
