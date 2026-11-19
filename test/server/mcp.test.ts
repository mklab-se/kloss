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

  test("tools/list offers the six tools, and none of them lists sessions", () => {
    const tools = (call(context(), "tools/list").result?.tools ?? []) as { name: string }[];
    expect(tools.map((t) => t.name).sort()).toEqual([
      "create_session",
      "delete_session",
      "drop_klossar",
      "get_model",
      "kloss_format",
      "replace_model",
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
