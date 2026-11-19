/**
 * The REST API described in OpenAPI 3.1, served at /openapi.json and shown at /docs.
 *
 * On purpose it describes only the REST API: the MCP endpoint, the OAuth endpoints MCP clients
 * use and the admin API are left out entirely (a test checks that none of them is mentioned), so
 * an agent that reads these docs learns nothing about MCP until the host turns it on and says so.
 */
import { PALETTE, SIZES } from "../core/format.ts";

export interface OpenApiDoc {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: { url: string }[];
  tags: { name: string; description: string }[];
  paths: Record<string, unknown>;
  components: { securitySchemes: Record<string, unknown>; schemas: Record<string, unknown> };
  security?: Record<string, string[]>[];
}

const json = (schema: unknown) => ({ "application/json": { schema } });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const text = (example?: string) => ({
  "text/plain": { schema: { type: "string" }, ...(example ? { example } : {}) },
});

const error = (description: string) => ({ description, content: json(ref("Error")) });

const codeParam = {
  name: "code",
  in: "path",
  required: true,
  description: 'The session code, like "otter-maple-42".',
  schema: { type: "string", pattern: "^[a-z]+-[a-z]+-\\d{2}$" },
};

export function openApi(o: { baseUrl: string; version: string; auth: boolean }): OpenApiDoc {
  const notLoggedIn = o.auth ? { 401: error("Not logged in: get a token from /api/token.") } : {};
  const open = { security: [] };
  const noSession = { 404: error("There is no session with this code (it may have expired).") };
  const changes = { 403: error("The request came from another web page.") };

  const paths: Record<string, unknown> = {
    "/healthz": {
      get: {
        tags: ["Server"],
        summary: "Health and version",
        description:
          "Always public: whether kloss is up, which version it runs and whether login is on.",
        ...open,
        responses: { 200: { description: "Up.", content: json(ref("Health")) } },
      },
    },
    "/api/me": {
      get: {
        tags: ["Login"],
        summary: "Who you are",
        description: "Whether login is on, and the e-mail address you are logged in with (if any).",
        ...open,
        responses: { 200: { description: "You.", content: json(ref("Me")) } },
      },
    },
    "/api/sessions": {
      post: {
        tags: ["Sessions"],
        summary: "Start a session",
        description:
          "Starts a new session (a model of its own, in memory) and returns its code and the URL of its live 3D view. Optionally starts from a whole model: send the .kl text as the body.",
        requestBody: { required: false, content: text("0,0|2x2|red\n.\n2,0|2x4|blue\n") },
        responses: {
          201: { description: "Started.", content: json(ref("Session")) },
          400: error("The .kl text has a mistake (the answer says which line)."),
          ...notLoggedIn,
          ...changes,
          503: error("kloss holds as many sessions as it can right now."),
        },
      },
    },
    "/api/sessions/{code}": {
      parameters: [codeParam],
      get: {
        tags: ["Sessions"],
        summary: "A session",
        responses: {
          200: { description: "The session.", content: json(ref("Session")) },
          ...notLoggedIn,
          ...noSession,
        },
      },
      delete: {
        tags: ["Sessions"],
        summary: "Remove a session",
        description: "Removes the session and its model for everyone. It cannot be undone.",
        responses: { 204: { description: "Removed." }, ...notLoggedIn, ...changes, ...noSession },
      },
    },
    "/api/sessions/{code}/klossar": {
      parameters: [codeParam],
      post: {
        tags: ["Building"],
        summary: "Drop a kloss",
        description:
          "Drops one kloss: it falls from the sky and lands on the first thing it touches (everyone watching sees it). The body is one .kl line, like `2,0|2x4|blue`; a left-out size or color is the last one used (`5,1`, `5,1|red`), and `.` repeats the last drop. JSON works too.",
        requestBody: {
          required: true,
          content: {
            ...text("2,0|2x4|blue"),
            "application/json": { schema: ref("KlossInput") },
          },
        },
        responses: {
          201: { description: "Dropped; where it landed.", content: json(ref("PlacedKloss")) },
          400: error("The line has a mistake."),
          ...notLoggedIn,
          ...changes,
          ...noSession,
          413: error("The model is full (10,000 klossar)."),
        },
      },
    },
    "/api/sessions/{code}/klossar/last": {
      parameters: [codeParam],
      delete: {
        tags: ["Building"],
        summary: "Take back the last kloss",
        description:
          "Takes back the most recent kloss (it vanishes for everyone watching). Again takes back the one before." +
          (o.auth ? " Only the person who dropped a kloss can take it back." : ""),
        responses: {
          200: { description: "Taken back.", content: json(ref("Undone")) },
          409: error(
            o.auth
              ? "Nothing to take back, or the last kloss belongs to someone else."
              : "Nothing to take back.",
          ),
          ...notLoggedIn,
          ...changes,
          ...noSession,
        },
      },
    },
    "/api/sessions/{code}/model": {
      parameters: [codeParam],
      get: {
        tags: ["Models"],
        summary: "The model as JSON",
        description: "Every kloss with where it landed (`level`, 0 is the floor).",
        responses: {
          200: { description: "The model.", content: json(ref("Model")) },
          ...notLoggedIn,
          ...noSession,
        },
      },
      put: {
        tags: ["Models"],
        summary: "Replace the model",
        description:
          "Replaces the whole model with .kl text. Every line is checked first; if any is wrong, nothing changes.",
        requestBody: { required: true, content: text("0,0|2x2|red\n.\n") },
        responses: {
          200: { description: "Replaced.", content: json(ref("Model")) },
          400: error("The .kl text has a mistake (the answer says which line)."),
          ...notLoggedIn,
          ...changes,
          ...noSession,
        },
      },
    },
    "/api/sessions/{code}/model.kl": {
      parameters: [codeParam],
      get: {
        tags: ["Models"],
        summary: "Download the model",
        description: "The model as .kl text: how a model is saved (`curl … > castle.kl`).",
        responses: {
          200: { description: "The .kl text.", content: text("  0,  0 | 2x2 | red\n.\n") },
          ...notLoggedIn,
          ...noSession,
        },
      },
    },
    "/api/sessions/{code}/optimize": {
      parameters: [codeParam],
      post: {
        tags: ["Models"],
        summary: "Optimize the model",
        description:
          "Merges klossar of the same color that lie side by side on the same level into bigger ones (two 2x2 into a 2x4, four 1x1 in a row into a 4x1, two 4x2 into an 8x2), where the model looks and stands exactly the same. Everyone watching sees the slimmer model.",
        parameters: [
          {
            name: "preview",
            in: "query",
            required: false,
            description: "Only report what it would save; change nothing.",
            schema: { type: "boolean" },
          },
        ],
        responses: {
          200: { description: "What it did.", content: json(ref("Optimized")) },
          ...notLoggedIn,
          ...changes,
          ...noSession,
        },
      },
    },
    "/api/sessions/{code}/render.png": {
      parameters: [codeParam],
      get: {
        tags: ["Models"],
        summary: "A picture of the model",
        description:
          "The model rendered as a PNG picture, from an angle or straight from the top, the front or the side.",
        parameters: [
          {
            name: "view",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["iso", "top", "front", "side"], default: "iso" },
          },
          {
            name: "size",
            in: "query",
            required: false,
            description: "The longest side in pixels.",
            schema: { type: "integer", minimum: 64, maximum: 2048, default: 768 },
          },
        ],
        responses: {
          200: {
            description: "The picture.",
            content: { "image/png": { schema: { type: "string", format: "binary" } } },
          },
          400: error("Unknown view or size."),
          ...notLoggedIn,
          ...noSession,
        },
      },
    },
    "/api/sessions/{code}/chickens": {
      parameters: [codeParam],
      get: {
        tags: ["Chickens"],
        summary: "List the chickens",
        description:
          "Every chicken in the session: where it stands (or is heading), and who spawned it.",
        responses: {
          200: { description: "The chickens.", content: json(ref("Chickens")) },
          ...notLoggedIn,
          ...noSession,
        },
      },
      post: {
        tags: ["Chickens"],
        summary: "Spawn chickens",
        description:
          "Drops 1 to 10 chickens from the sky. They flutter down, each its own way, and land on top of whatever is below, near `x`,`y` or else near the middle of the model. From then on they live their own lives: they walk around, flutter up one kloss, hop down from any height and explore the model, and everyone watching sees them. A session holds at most 50. A kloss that lands on a chicken is the end of that chicken.",
        requestBody: {
          required: false,
          content: json(ref("SpawnChickens")),
        },
        responses: {
          201: { description: "Chickens on their way down.", content: json(ref("Spawned")) },
          400: error("count, x or y is not valid."),
          409: error("The session already holds 50 chickens."),
          ...notLoggedIn,
          ...changes,
          ...noSession,
        },
      },
    },
    "/api/sessions/{code}/events": {
      parameters: [codeParam],
      get: {
        tags: ["Models"],
        summary: "Live updates",
        description:
          "Server-Sent Events: `model` (the whole model, on connect and when it is replaced or optimized), `drop` (one kloss), `undo` (a kloss taken back), `chickens` (every chicken, on connect), `moves` (chickens on the move), `chicken-gone` (a kloss landed on one), `deleted` (the session is gone) and `ping` every 15 seconds.",
        responses: {
          200: {
            description: "An event stream.",
            content: { "text/event-stream": { schema: { type: "string" } } },
          },
          ...notLoggedIn,
          ...noSession,
        },
      },
    },
  };

  if (o.auth) {
    paths["/api/token"] = {
      post: {
        tags: ["Login"],
        summary: "Log in: get a token",
        description:
          "Log in with any e-mail address and the password you were given. Send the token as `Authorization: Bearer <token>` with every other call. It is valid for 8 hours.",
        ...open,
        requestBody: { required: true, content: json(ref("Login")) },
        responses: {
          200: { description: "Logged in.", content: json(ref("Token")) },
          401: error("Wrong e-mail address or password (or too many attempts: wait a moment)."),
        },
      },
    };
  }

  const sizes = Object.keys(SIZES);
  const colors = Object.keys(PALETTE);
  return {
    openapi: "3.1.0",
    info: {
      title: "kloss",
      version: o.version,
      description: intro(o.auth, sizes, colors),
    },
    servers: [{ url: o.baseUrl }],
    tags: [
      { name: "Server", description: "Whether kloss is up, and which version it runs." },
      ...(o.auth
        ? [
            {
              name: "Login",
              description: "Log in with any e-mail address and the password you were given.",
            },
          ]
        : [{ name: "Login", description: "Login is off on this kloss." }]),
      {
        name: "Sessions",
        description: "A session is one model, shared by everyone who knows its code.",
      },
      { name: "Building", description: "Drop klossar, and take back the last one." },
      {
        name: "Chickens",
        description:
          "Chickens that roam your model on their own. Mind where you drop your klossar.",
      },
      {
        name: "Models",
        description: "Read, replace, download, optimize, picture and follow a model.",
      },
    ],
    paths,
    components: {
      securitySchemes: o.auth
        ? { bearer: { type: "http", scheme: "bearer", description: "A token from /api/token." } }
        : {},
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: { type: "string" },
            line: { type: "integer", description: "The line with the mistake, for .kl text." },
          },
          required: ["error"],
        },
        Health: {
          type: "object",
          properties: {
            status: { const: "ok" },
            version: { type: "string" },
            auth: { type: "boolean", description: "Whether login is on." },
          },
        },
        Me: {
          type: "object",
          properties: {
            auth: { type: "boolean" },
            email: { type: ["string", "null"] },
            version: { type: "string" },
          },
        },
        Login: {
          type: "object",
          properties: {
            email: { type: "string", format: "email", example: "you@example.com" },
            password: { type: "string" },
          },
          required: ["email", "password"],
        },
        Token: {
          type: "object",
          properties: {
            access_token: { type: "string" },
            token_type: { const: "Bearer" },
            expires_in: { type: "integer", description: "Seconds." },
          },
        },
        Session: {
          type: "object",
          properties: {
            code: { type: "string", example: "otter-maple-42" },
            url: { type: "string", description: "The live 3D view." },
            klossar: { type: "integer", description: "How many klossar the model has." },
          },
        },
        KlossInput: {
          type: "object",
          properties: {
            size: { enum: sizes, description: "<w>x<d>: w pluppar along x, d along y." },
            color: { enum: colors },
            x: { type: "integer", minimum: -10000, maximum: 10000 },
            y: { type: "integer", minimum: -10000, maximum: 10000 },
          },
          required: ["size", "color", "x", "y"],
        },
        PlacedKloss: {
          allOf: [
            ref("KlossInput"),
            {
              type: "object",
              properties: {
                index: { type: "integer" },
                level: { type: "integer", description: "Where it landed; 0 is the floor." },
                ...(o.auth ? { by: { type: "string", description: "Who dropped it." } } : {}),
              },
            },
          ],
        },
        Model: {
          type: "object",
          properties: {
            code: { type: "string" },
            klossar: { type: "array", items: ref("PlacedKloss") },
          },
        },
        Undone: {
          type: "object",
          properties: {
            code: { type: "string" },
            undone: ref("PlacedKloss"),
            klossar: { type: "integer" },
          },
        },
        Chicken: {
          type: "object",
          properties: {
            id: { type: "integer" },
            x: { type: "integer" },
            y: { type: "integer" },
            level: { type: "integer", description: "The level it stands on (0 is the floor)." },
            by: { type: "string", description: "Who spawned it (with login on)." },
          },
        },
        Chickens: {
          type: "object",
          properties: {
            code: { type: "string" },
            chickens: { type: "array", items: ref("Chicken") },
            count: { type: "integer" },
          },
        },
        SpawnChickens: {
          type: "object",
          properties: {
            count: { type: "integer", minimum: 1, maximum: 10, default: 1 },
            x: { type: "integer", description: "Near here (default: the middle of the model)." },
            y: { type: "integer" },
          },
          example: { count: 3 },
        },
        Spawned: {
          type: "object",
          properties: {
            code: { type: "string" },
            spawned: { type: "array", items: ref("Chicken") },
            count: { type: "integer", description: "How many chickens the session has now." },
          },
        },
        Optimized: {
          type: "object",
          properties: {
            code: { type: "string" },
            before: { type: "integer" },
            after: { type: "integer" },
            merges: { type: "integer" },
            applied: { type: "boolean" },
          },
        },
      },
    },
    ...(o.auth ? { security: [{ bearer: [] }] } : {}),
  };
}

/** The docs page: Scalar (an API reference viewer), pinned, reading /openapi.json. */
export const SCALAR_VERSION = "1.76.4";

/**
 * No developer toolbar, no "Ask AI" (it would send questions to Scalar's service), no telemetry.
 * Scalar's own agent integration stays off by simply not being configured.
 */
const SCALAR_CONFIG = {
  showDeveloperTools: "never",
  telemetry: false,
  agent: { disabled: true },
  hideClientButton: false,
  // the data types are shown with each call; a separate "Models" list would clash with our tag
  hideModels: true,
};

export function docsPage(): Response {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>kloss API</title>
  </head>
  <body>
    <script id="api-reference" data-url="/openapi.json" data-configuration='${JSON.stringify(SCALAR_CONFIG)}'></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@${SCALAR_VERSION}"></script>
  </body>
</html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

/** The intro at the top of /docs: what the API is for, how to start, and the model format. */
function intro(auth: boolean, sizes: string[], colors: string[]): string {
  const steps = [
    ...(auth
      ? [
          "**Log in.** `POST /api/token` with your e-mail address and the password you were given. Send the token as `Authorization: Bearer <token>` on every call.",
        ]
      : []),
    "**Start a session.** `POST /api/sessions` gives you a code like `otter-maple-42` and a link to the live 3D view. Send a `.kl` file in the body to start from a model you already have.",
    "**Build.** `POST .../klossar` drops one kloss at a time; `DELETE .../klossar/last` takes it back.",
    "**Visualize.** Open the link and watch every kloss fall into place as it is dropped, or ask for a picture with `GET .../render.png`.",
    "**Optimize.** `POST .../optimize` merges klossar into bigger ones wherever the model looks and stands exactly the same.",
    "**Keep it.** `GET .../model.kl` downloads the model as a file you can share, edit and load again.",
    "**Add some life.** `POST .../chickens` drops chickens into your model. They roam it on their own, so mind where you drop your klossar.",
  ];
  return [
    "Build, visualize and optimize models made of klossar: virtual building blocks that snap together on an endless floor.",
    "",
    "Describe a model one kloss at a time, from a script, a terminal or your own app, and watch it come together live in 3D in any browser: every kloss falls from the sky and lands exactly where the rules say it must. Share the session with others and build together, render a picture of the result from any side, and let kloss slim the model down to fewer, bigger klossar without changing how it looks.",
    "",
    "## Getting started",
    "",
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    "## The .kl format",
    "",
    "A model is plain text, read from the top down. Each line drops one kloss, written `x,y|size|color`; it lands on the first thing it touches, the floor or another kloss, so you never write a height. Leave out the size or the color to reuse the last one, and a line with just `.` drops the same kloss again, right on top.",
    "",
    "```text",
    "# a gray base, a tower on it, and the start of a red wall",
    "1,1|4x2|gray",
    "1,1|2x2",
    "5,1",
    ".",
    "1,3|2x4|red",
    "```",
    "",
    `Sizes: ${sizes.map((s) => `\`${s}\``).join(", ")}. Colors: ${colors.join(", ")}. \`#\` starts a comment.`,
  ].join("\n");
}
