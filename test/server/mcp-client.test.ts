/** The official MCP client talks to kloss's endpoint, with and without login. */
import { afterEach, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Server } from "bun";
import { Auth } from "../../src/server/auth.ts";
import { startServer } from "../../src/server/http.ts";
import { SessionStore } from "../../src/server/sessions.ts";

const secret = new TextEncoder().encode("mcp-client-test-secret-xxxxxxxxxx");
let server: Server<undefined> | undefined;

afterEach(() => server?.stop(true));

function serve(password?: string) {
  const auth = new Auth({ password, secret });
  server = startServer({
    sessions: new SessionStore({ idleMs: 60_000, maxSessions: 5 }),
    auth,
    mcp: { enabled: true },
    port: 0,
    hostname: "127.0.0.1",
    version: "1.2.3",
  });
  return { url: new URL(`http://127.0.0.1:${server.port}/mcp`), auth };
}

async function build(client: Client) {
  const tools = await client.listTools();
  expect(tools.tools.map((t) => t.name)).toContain("drop_klossar");
  const made = await client.callTool({ name: "create_session", arguments: {} });
  const { code } = JSON.parse((made.content as { text: string }[])[0]?.text ?? "{}");
  const dropped = await client.callTool({
    name: "drop_klossar",
    arguments: { code, lines: ["0,0|2x2|red", ".", "2,0|2x4|blue"] },
  });
  expect(dropped.isError).toBeFalsy();
  return code as string;
}

test("locally (no login), the SDK client builds a model", async () => {
  const { url } = serve();
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(url));
  await build(client);
  await client.close();
});

test("with login, the SDK client builds a model with a bearer token, as the dropper", async () => {
  const { url, auth } = serve("class");
  const client = new Client({ name: "test", version: "1.0.0" });
  const token = auth.accessToken("agent@example.com");
  await client.connect(
    new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  const code = await build(client);
  const model = await client.callTool({ name: "get_model", arguments: { code } });
  const data = JSON.parse((model.content as { text: string }[])[0]?.text ?? "{}");
  expect(data.droppedBy).toEqual(["agent@example.com"]);
  await client.close();
});
