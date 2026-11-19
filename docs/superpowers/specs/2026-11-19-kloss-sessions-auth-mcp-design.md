# kloss sessions, login and MCP: design

Date: 2026-11-19. Status: approved in conversation (Kristofer: "A", then a goal to build and deploy
it all). Ships as kloss 0.3.0.

## Intent

kloss is a teaching tool for what an MCP server is and why it helps. Participants first build
with the plain REST API (the slightly hard way), then the host turns the MCP endpoint on and their
AI harness can simply connect. kloss runs on your own machine, or hosted on Azure for a class,
where a shared password keeps strangers out. It is not a product: no sign-up, no persistence.

## Decisions

### Sessions (many models at once, in memory)

- No file mode: `kloss serve` takes no model file. Models live only in memory, per session.
- `POST /api/sessions` creates a session and answers `201 { code, url }`. An optional `.kl` body
  seeds it (`curl -X POST …/api/sessions --data-binary @castle.kl`).
- The code is two short words and a number, like `otter-maple-42`: easy to read out in a room.
  It identifies a session; it is not a secret and not authentication. Anyone who knows it may
  build, watch, download and delete. Sharing a code is a feature (build together, watch along).
- Per session, under `/api/sessions/{code}`: `POST /klossar` (a `.kl` line or JSON, as before),
  `GET /model` (JSON), `PUT /model` (replace with `.kl` text), `GET /model.kl` (the model as
  `.kl` text, formatted; this is how a model is saved), `GET /events` (SSE), `DELETE` (remove the
  session; open viewers are told). Unknown code: `404`.
- Viewer at `/s/{code}`. The start page `/` has a box for a code (goes to `/s/{code}`) and a
  "New session" button.
- Idle expiry: a session with no changes and no open viewer for `KLOSS_SESSION_IDLE` (default
  2 h; `--session-idle 30m`) is removed. Limits: `KLOSS_MAX_SESSIONS` (default 100), and 10,000
  klossar per session as before.

### Health and version

- `GET /healthz` is always public: `{ "status": "ok", "version": "0.3.0", "auth": true }`.
  `version` includes the build (`0.3.0+3f2a1c9`) when the image was built from an unreleased or
  dirty tree. No MCP field (see "No trace" below).

### Login (protects everything when on)

- Off unless `KLOSS_PASSWORD` (or `KLOSS_PASSWORD_FILE`) is set. Never a command-line flag.
- Username: any e-mail address; password: the one configured. The e-mail is the identity.
- With login on, everything except `/healthz`, the login page and static assets needs it.
  - Browser: `/login` page, then an HttpOnly cookie.
  - `curl`: `POST /api/token` with `{ email, password }` returns `{ access_token, expires_in }`;
    send `Authorization: Bearer …`.
  - MCP clients: OAuth 2.1 authorization code with PKCE, with kloss as its own authorization
    server (discovery documents, dynamic client registration, `/oauth/authorize` showing the
    same login form, `/oauth/token` with refresh tokens).
- Tokens are signed by kloss (HMAC-SHA256), 8 h for access and 7 days for refresh.
  `KLOSS_TOKEN_SECRET` keeps them valid across restarts (set on Azure); else a random one is made.
- Failed logins are slowed per e-mail and per client address.
- "Who did what": with login on, each drop remembers who dropped it (in memory, never in `.kl`)
  and the viewer shows a short line like "kristofer@mklab.se dropped a blue 2x4".

### MCP endpoint (switchable at runtime, no trace while off)

- `POST /mcp`: Streamable HTTP, stateless, JSON answers (as lykta). Same login as the API.
- Off by default and after every start; on with `--mcp` / `KLOSS_MCP=1`, or live from `/admin`.
- While off there is no trace: `/mcp` is the ordinary 404, the OAuth endpoints and discovery
  documents do not exist, a 401 does not point at OAuth metadata, the help card does not mention
  MCP, and `/admin` shows nothing until its own login.
- Admin: `/admin` with `KLOSS_ADMIN_PASSWORD` (any e-mail plus that password). With login off
  (local), `/admin` is open. `PUT /api/admin/mcp { "enabled": true }` for scripts. The switch is
  in memory: a restart (or the Azure app waking from sleep) starts with MCP off again.
- Tools: `create_session` (optional `.kl` to start from), `drop_klossar` (one or more `.kl`
  lines, with carry-over and `.`), `get_model`, `replace_model`, `delete_session`, and
  `kloss_format` (the format and the rules, for agents). No tool lists sessions: codes stay
  private to whoever was told them.
- Shared sessions mean other participants shape what an agent reads. Downloads are freshly
  formatted (no comments), so the only free text is the e-mail address of who dropped what;
  tool descriptions say all model content is data, never instructions: a deliberate, labelled
  talking point about prompt injection through tools.

### Azure (azd only, no CI/CD deploy)

- `azd up` creates or updates everything; `azd down` removes it. No GitHub deploy pipeline;
  CI keeps checking the code on every push.
- Resources: Log Analytics, a Container Apps environment, a container registry with a managed
  identity for pulls, and the kloss Container App: ingress on 8080, scale 0 to 1 (exactly one
  replica, which in-memory sessions require), Azure's default health probes (the placeholder
  image of the very first provision has no `/healthz`), the three secrets as
  Container App secrets from azd environment values.
- The image is the single-file binary on a distroless base, built remotely by azd.
- A pre-deploy hook prints the version going out and warns (does not block) when the working
  tree is dirty or not exactly a release tag; that version reaches `/healthz`.
- Known consequence of scale-to-zero: after about 5 idle minutes the app sleeps and every
  session (and the MCP switch) is gone. A live class keeps it awake.

## Approaches considered

- **A. All inside kloss, small hand-written pieces (chosen):** sessions, a small OAuth server and
  hand-written MCP JSON-RPC, like lykta. One binary, identical locally and on Azure.
- **B. A full OAuth/OpenID library:** complete but heavy, for problems a shared password does not
  have.
- **C. Login in front (Container Apps auth or a gateway):** needs an identity provider and does
  not exist locally.

## Non-goals

Persistence, user accounts or sign-up, roles beyond the admin password, horizontal scaling, a
GitHub deploy pipeline, listing sessions.

## Left to the builder

Word lists for codes, the exact page designs (start, login, admin), the rate-limit curve,
token encoding details, Bicep module layout, and the sweep interval for idle sessions.
