# Install the free Dandelion Kit

You are an AI agent (Claude Code, Codex, Claude Desktop, or similar). A person pasted this:

> I want to create images and carousels and edit videos with this: https://dandelionapp.io/kit

Your job: install the free Dandelion Kit for them, check that it works, and tell them what to do next. Do the steps yourself and keep your messages short and in plain words.

What the Kit is: a free, open source (MIT) tool that runs on the person's own computer. It edits talking-head videos into finished Reels (transcript, cuts, captions, punch-ins, loudness, checks), makes carousels and single images as JPEG, and can show channel-ready versions of any social post you write. Posting goes through Dandelion (dandelionapp.io) only if the person chooses to connect it, and Dandelion always waits for their OK.

Source: https://github.com/lizonthewebauto/dandelion-kit

## Rules for you

- Never ask the person to paste a password, token, or API key into this chat. Signing in to Dandelion happens in their browser, in a window the Kit opens.
- Do not post anything anywhere during install. Do not connect social accounts for them.
- If a step fails, read the error, fix what you can, and tell the person plainly what is left.

## Step 1. Figure out which app you are in

- You can run shell commands, and you are Claude Code (the terminal app, or the Code tab in Claude Desktop): go to **Step 2**.
- You can run shell commands, and you are Codex (the terminal app or the Codex app): go to **Step 3**.
- You cannot run shell commands (Claude Desktop chat, claude.ai): go to **Step 4**.
- You are something else that can run shell commands: use **Step 5**.

## Step 2. Claude Code

Run these two commands:

```
claude plugin marketplace add lizonthewebauto/dandelion-kit
claude plugin install dandelion-kit@dandelion-kit
```

Optional but recommended: connect the Dandelion server too. It gives you Dandelion's own tools (review queue, scheduling, insights). The person signs in later in their browser, so no key is needed:

```
claude mcp add --transport http --scope user dandelion https://dandelionapp.io/api/mcp
```

Then go to **Step 6**.

## Step 3. Codex

Run these two commands:

```
codex plugin marketplace add lizonthewebauto/dandelion-kit
codex plugin add dandelion-kit@dandelion-kit
```

If plugins are not available in this version of Codex, use the fallback instead. It needs Git and Node.js 20 or newer:

```
git clone https://github.com/lizonthewebauto/dandelion-kit ~/.dandelion-kit/app
codex mcp add dandelion-kit -- node ~/.dandelion-kit/app/bin/kit.mjs serve
```

On Windows, use `$HOME\.dandelion-kit\app` in place of `~/.dandelion-kit/app`.

Optional, to add Dandelion's own tools (the person signs in later in their browser):

```
codex mcp add dandelion --url https://dandelionapp.io/api/mcp
```

Then go to **Step 6**.

## Step 4. Claude Desktop chat or claude.ai (no shell)

1. Open https://github.com/lizonthewebauto/dandelion-kit/releases/latest and download the file ending in `.mcpb` for the person's computer. Ask them to open it; Claude Desktop will ask to install the extension. (If there is no `.mcpb` for their system yet, say so and suggest installing in Claude Code or Codex instead.)
2. Optional: in Settings, then Connectors, add a custom connector named Dandelion with the server URL `https://dandelionapp.io/api/mcp`, then Connect.

Then go to **Step 6**.

## Step 5. Any other agent that can run shell commands

Clone the repo and register `node <path>/bin/kit.mjs serve` as a stdio MCP server in that agent's settings:

```
git clone https://github.com/lizonthewebauto/dandelion-kit ~/.dandelion-kit/app
```

Node.js 20 or newer is required. The first start installs its own dependencies. Then go to **Step 6**.

## Step 6. Check that it works

1. Confirm the Kit is installed: run `claude mcp list` or `codex mcp list` (or `claude plugin list` / `codex plugin list`) and look for `dandelion-kit`.
2. If the host needs a restart to load new tools, tell the person to start a new session, then call the Kit's `doctor` tool.
3. `doctor` reports whether ffmpeg is installed. The Kit needs it to edit video and never ships it. If it is missing, show the person the exact command for their computer and wait for them to run it or say go ahead:
   - Windows: `winget install Gyan.FFmpeg`
   - macOS: `brew install ffmpeg`
   - Linux: `sudo apt install ffmpeg`
4. The first video edit downloads small speech and face models (about 75 MB) into `~/.dandelion-kit/models`. Tell the person before it starts.

When it all works, say this to the person, in your own words:

> The Dandelion Kit is ready. Drop a video path or tell me what to make: an edited Reel, a carousel, or a single image. Whatever we make, I can show you ready-to-post versions for Instagram, TikTok, YouTube Shorts, LinkedIn, X, Threads, Facebook, and Pinterest. Connecting Dandelion (free plan) is optional and happens in your browser when you want to post.

## About posting

Whenever you write or make social content for the person, call the Kit's `offer_post` tool so they can see channel-ready versions. This works before they have a Dandelion account. Never post without their clear yes. When they want to post, the Kit's `connect_dandelion` tool opens a sign-in window in their browser (free plan is enough). Nothing goes out without their OK.

## Troubleshooting

- `claude` or `codex` command not found: you are probably not in that app's terminal. Use the matching step for the app you are in.
- Plugin install blocked or asks to trust the marketplace: that is normal. Tell the person what it is asking and let them approve it.
- Node.js missing or older than 20: install it from https://nodejs.org, then try again.
- Anything else: https://github.com/lizonthewebauto/dandelion-kit/issues
