# Running a class with kloss

This guide is for the trainer: you, or anyone who wants to run the class again. The
[README](../README.md) is written for the participants and presents kloss as the useful tool it
is. This page is about the class around it: what it teaches, how to host it, and how to run the
session.

## The idea

The class teaches what an MCP server is, by letting people feel the difference it makes, and then
what can go wrong.

1. **The hard way.** Participants get a kloss server, a password and the API docs (`/docs`).
   They build something with plain REST calls: log in, start a session, drop klossar one `curl`
   at a time, watch them land in the 3D view. It works, and it is slow work.
2. **The switch.** You turn MCP on from `/admin`. Participants connect their agent and ask for
   the same thing in a sentence. The agent finds the tools, reads the instructions and builds it
   in seconds.
3. **The reflection.** Everything the agent just did, it did because a server it had never seen
   told it how, with the participant's identity, and partly on their own computer. That is the
   power and the risk of MCP in one picture.

While MCP is off it leaves **no trace**: `/mcp`, the OAuth discovery and registration endpoints
and the admin API answer like any unknown address (`404`), and `/docs` and `/openapi.json` never
mention MCP, OAuth or admin (a test makes sure). So before the switch, nothing on the server
gives it away. (The README in this repository does describe MCP; participants who go looking on
GitHub will find it.)

## What you need

- An Azure subscription, the Azure CLI (`az login`) and the Azure Developer CLI (`azd auth login`).
- This repository, checked out.
- For the agent check: [Claude Code](https://claude.com/claude-code) and Bun.
- Participants need a terminal with `curl` (and `jq` is handy), a browser and, for step 2, an
  agent that speaks MCP over HTTP with OAuth (Claude Code works well).

## Before the class

### Deploy

kloss runs as an Azure Container App in Sweden Central that sleeps when nobody uses it. There is
no deploy pipeline on purpose: deploy right before a class and remove it afterwards.

```sh
azd up
```

The first time, `azd up` asks for an environment name (for example `class`) and a subscription,
then creates the resource group `rg-kloss-<environment>`, a container registry and the app, and
deploys this working tree. Run it again to deploy changes. Before each deploy kloss prints the
version going out and warns when it is not exactly a release.

### The passwords and the address

The first `azd up` generates three secrets and keeps them in the azd environment, never printed:

| Secret | What it is |
| --- | --- |
| `KLOSS_PASSWORD` | The class password: three words and a number, easy to type. Participants log in with any e-mail address plus this. |
| `KLOSS_ADMIN_PASSWORD` | Yours alone: for `/admin`, where MCP is turned on and off. |
| `KLOSS_TOKEN_SECRET` | Signs the login tokens, so logins survive a restart or a wake-up. |

Read them, and the address, from the repository folder:

```sh
azd env get-value KLOSS_URL
azd env get-value KLOSS_PASSWORD
azd env get-value KLOSS_ADMIN_PASSWORD
```

To choose your own class password, or a new one for the next class, set it and deploy:

```sh
azd env set KLOSS_PASSWORD my-own-words-42
azd up
```

### MCP off at the start

By default the app starts with MCP off, and that is what the class wants. If you deployed with
MCP on (for testing), turn it back off before the class:

```sh
azd env set KLOSS_MCP false
azd up
```

With `KLOSS_MCP` true the app starts with MCP on, also every time it wakes from sleep; `/admin`
can still switch it at runtime either way.

### Check it

- `https://<address>/healthz` is public and shows the version and that login is on
  (`0.3.0+3f2a1c9` for a commit after a release, `-dirty` for uncommitted changes).
- Log in on the start page with any e-mail address and the class password, start a session and
  drop a kloss with the command the empty session shows you.
- `https://<address>/mcp` answers `404` while MCP is off.

Then run the **agent check** locally. It plays the everyday requests ("Visualize castle.kl",
"Open car.kl", "Optimize the open model", "Save the model to house.kl", "Add a blue 2x4 at
1,0") through a real Claude Code against a local kloss and checks each result. It costs real
tokens and a model's answers vary, so it is a script to run before a class, not a CI test:

```sh
bun scripts/agent-check.ts
KLOSS_AGENT_MODEL=sonnet bun scripts/agent-check.ts
```

Run it after any change to the MCP tools, their descriptions or the server's instructions
(`src/server/mcp.ts`).

### Sleep, and what it wipes

The app scales to zero after a few idle minutes and wakes on the next request (the first one
takes a few seconds). Sessions live only in memory, so when it sleeps **every session is gone**,
and the MCP switch goes back to how the app starts (off, unless `KLOSS_MCP` is set). Logins
survive. A class that is building keeps it awake; if there is a long break, expect to start new
sessions and, if MCP was on, to switch it on again.

## During the class

A flow that works, about 90 minutes:

1. **Intro (10 min).** What kloss is: klossar, the `.kl` format, the landing rule. Show the
   castle: start a session from `examples/castle.kl` and open it on the projector.
2. **The hard way (25 min).** Give out the address and the class password. Participants open
   `/docs`, log in with `/api/token` and build something small by hand. Shared sessions are fun
   here: put the room's session on the projector and let everyone drop klossar into it.
3. **The switch (10 min).** Ask how they would get an agent to do this. Then open `/admin`, log
   in with any e-mail address and the admin password, and turn MCP on. `/mcp` exists from that
   moment, and the server log says so (`MCP endpoint turned on from /admin`).
4. **With an agent (25 min).** Participants connect:

   ```sh
   claude mcp add --transport http kloss https://<address>/mcp
   ```

   The agent opens the kloss login page; they log in as before. Then: "Visualize castle.kl",
   "Open car.kl", "Build a small house with a red roof", "Optimize the open model", "Save the
   model to house.kl".
5. **Chickens (5 min).** Ask the agents to let some chickens loose in the room's session. They
   can't: there is no MCP tool for it. Then show `POST …/chickens` in `/docs` and let everyone
   spawn a few with `curl`. Watch them roam on the projector, and drop a kloss on one.
6. **Reflection (20 min).** The talking points below, with the server log on the projector.

Scripts can flip the switch too, with an admin token:

```sh
ADMIN=$(curl -s -X POST https://<address>/api/admin/token -H 'content-type: application/json' \
  -d '{"email":"trainer@example.com","password":"..."}' | jq -r .access_token)
curl -X PUT https://<address>/api/admin/mcp -H "Authorization: Bearer $ADMIN" \
  -H 'content-type: application/json' -d '{"enabled": true}'
```

### Watching what agents do

Every MCP tool call is logged on the server with who made it, which tool and which session,
including calls kloss refused:

```text
mcp: ada@example.com create_session otter-maple-42
mcp: ada@example.com drop_klossar otter-maple-42
```

Show the log live:

```sh
az containerapp logs show --follow --type console \
  -n $(azd env get-value SERVICE_KLOSS_NAME) -g rg-kloss-$(azd env get-value AZURE_ENV_NAME)
```

## Talking points

The power:

- **No integration work.** Nobody wrote a kloss plugin for the agent. It discovered the tools,
  their descriptions and the server's instructions at connect time, and used them.
- **Intent, not calls.** "Build a small house" became dozens of correct drops; "optimize the
  open model" picked the right session from the conversation.
- **Standard login.** OAuth with discovery and dynamic client registration: the agent found out
  how to log in by itself, and the participant only saw a familiar login page.
- **An MCP server is a choice of tools, not the whole API.** Chickens exist only in the REST
  API: the server's owner decided what agents get, and the MCP instructions never mention
  chickens (a test keeps it that way). Most real MCP servers are like this, a curated slice of a
  bigger API.

The risks, all visible in this class:

- **The server can change under you.** The endpoint did not exist, then it did, decided by
  someone else at runtime. Tools, descriptions and instructions can change the same way, after
  you decided to trust them.
- **The server instructs your agent.** The instructions and tool descriptions that made the
  agent so capable are text written by the server's owner, and the agent follows them. A
  less friendly server could steer it anywhere.
- **It acts as you.** Every call carries the participant's identity. Whatever the agent does with
  that token, the server sees as them.
- **It reaches your computer.** "Save the model to house.kl" wrote a file on the participant's
  disk: a remote server's tool output, written locally by the agent's own tools. Combine a
  remote server with local file or shell access and the boundary gets thin.
- **The server sees everything.** The log on the projector shows every call, from everyone.
  Whatever an agent sends, the server's owner can keep.
- **Leaving it out of MCP is not a lock.** An agent that has a shell, has read `/docs`, and holds
  the participant's token can call the chicken API with `curl` anyway. Try it: ask an agent
  with shell access to "let three chickens loose using the API docs". What protects an API is
  its own login and permissions, not which tools the MCP server happens to offer.
- **Data can carry instructions.** A model is text, and so is a comment in a `.kl` file. Ask
  what happens if a model someone shares contains a line written to the agent rather than to
  kloss. (A good live experiment: put such a comment in a model, open it through the agent, and
  see whether it obeys.)

- **Local is a different risk, not a smaller one.** kloss also runs as a local MCP server
  (`claude mcp add kloss -- kloss mcp`): the agent starts it as a process on the participant's
  own machine. No login, no runtime switch, no one else's log; but it runs with all of the
  user's rights. Here what you trust is the package you installed and every update to it, which
  is why `npx some-mcp-server` deserves the same care as any other code you run.

  | | Remote (HTTP) | Local (stdio) |
  | --- | --- | --- |
  | Where it runs | Someone else's server | Your machine, as you |
  | What you trust | The server's owner | The package you installed (and its updates) |
  | What it can reach | Only what it's sent | Your files, network and environment |
  | How it logs in | OAuth | Not at all: it already is you |
  | Can it change under you? | Yes, at any time | When you update it |

Ways to protect yourself, to end on: connect only to servers you trust, review what an agent is
about to do (permission prompts exist for a reason), keep local tools narrow when a remote
server is connected, and prefer servers whose tools cannot change silently.

## After the class

```sh
azd down
```

This removes the resource group and everything in it (it asks first; `--purge --force` skips
the questions). The azd environment, with its passwords, stays on your machine for next time;
set a new `KLOSS_PASSWORD` before the next class.

## Without Azure

For a small room on one network, run kloss on your own machine:

```sh
KLOSS_PASSWORD=class-words-42 KLOSS_ADMIN_PASSWORD=... kloss serve --host 0.0.0.0
```

Participants use `http://<your-ip>:4321`. Without `KLOSS_PASSWORD` login is off and `/admin` is
open to anyone, which is fine for trying things alone but not for a class. Note that agents
usually want HTTPS for OAuth on anything but localhost, so the hosted setup is the safer choice
for step 4.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| Logins fail and then get slow | Failed logins are slowed down per address. Check the password with `azd env get-value KLOSS_PASSWORD`, then wait a moment. |
| "There is no session" | The app slept and the session went with it. Start a new one (from a `.kl` file if you saved it). |
| The agent cannot connect | Is MCP on (`/mcp` gives `401`, not `404`)? If it was added while MCP was off, remove and add it again (`claude mcp remove kloss`). |
| MCP is off again | The app slept and woke up. Switch it on in `/admin`, or deploy with `KLOSS_MCP` true. |
| Not sure which version is running | `/healthz`, or the version in a viewer's help card. |
| A participant's agent does something odd | Look for its calls in the log (`mcp: <their e-mail> ...`), and rerun the agent check before the next class. |

The design behind sessions, login and MCP is in
[`docs/superpowers/specs/2026-11-19-kloss-sessions-auth-mcp-design.md`](superpowers/specs/2026-11-19-kloss-sessions-auth-mcp-design.md).
