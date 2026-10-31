# Dandelion Kit

A free kit for Claude Code, Codex and Claude Desktop. Edit a talking-head video into a finished Reel, make carousels and single images, and get a ready-to-post version of anything you write for every major social app.

It runs on your computer. It is open source (MIT). Posting is optional and goes through [Dandelion](https://dandelionapp.io), which always waits for your OK.

## Install

Paste this into your agent:

> I want to create images and carousels and edit videos with this: https://dandelionapp.io/kit

The agent reads the install page, sets the Kit up, and checks that it works. The steps it follows are in [INSTALL.md](INSTALL.md).

Or install it yourself:

```
# Claude Code (terminal or the Code tab in Claude Desktop)
claude plugin marketplace add lizonthewebauto/dandelion-kit
claude plugin install dandelion-kit@dandelion-kit

# Codex
codex plugin marketplace add lizonthewebauto/dandelion-kit
codex plugin add dandelion-kit@dandelion-kit
```

Codex without plugin support: clone this repo and run `codex mcp add dandelion-kit -- node <path>/bin/kit.mjs serve`.

You need Node.js 20 or newer. The first start installs the Kit's own packages (about a minute). Video editing also needs ffmpeg, which the Kit detects but never ships. The `doctor` tool shows the exact install command for your computer.

## What you can do

- **Edit a video into a Reel.** A transcript, a breath-safe rough cut, caption styles, punch-ins, loudness, sound effects and quality checks on the finished file. Plan first, then build once. Make 2 to 4 variants of the same speech.
- **Make carousels and images.** Twelve clean layouts and a tiny `brand.json` (colors, handle, fonts). JPEG output at 1080 by 1350, 1080 by 1080 or 1080 by 1920. Text that does not fit is refused with the field name and the limit, never cut quietly.
- **See a post for every app.** For any caption, thread, image, carousel or video, the Kit shows a version for Instagram, TikTok, YouTube Shorts, LinkedIn, X, Threads, Facebook and Pinterest, checked against each app's limits. This works before you have a Dandelion account.
- **Post with Dandelion.** Connect Dandelion (free plan) from inside the chat. Sign-in happens in your browser. Send the files up, then approve or schedule each post. Nothing goes out without your clear yes.

## Where it works

| App | How it installs | Cards |
| --- | --- | --- |
| Claude Code (terminal) | plugin marketplace | text results |
| Claude Code in the Claude Desktop Code tab | plugin marketplace | depends on the app version |
| Claude Desktop chat | `.mcpb` bundle (Windows x64 first, Mac later) | visual cards |
| Codex CLI and app | plugin marketplace, or `codex mcp add` | text results, cards where the app draws them |
| Any other agent that can run a command | clone and register `node bin/kit.mjs serve` over stdio | text results |

Every tool result is complete text with exact file paths, so nothing depends on a card being drawn.

## What is inside

- An MCP server named `dandelion-kit` with 25 tools and 8 visual cards.
- Three skills: `reels-editor`, `carousel-maker` and `post-anything`.
- A session-start hook (Claude Code) and `AGENTS.md` (Codex) that carry one standing rule: whenever the agent makes social content, it calls `offer_post` and shows the card, and it never posts without your yes.

## Privacy

- Editing and rendering happen on your computer. Your videos are not uploaded anywhere unless you choose to send them to Dandelion.
- Signing in to Dandelion happens in your own browser. The Kit stores the sign-in on your computer in `~/.dandelion-kit/auth.json`, readable only by you. It never asks you to paste a password or key into the chat.
- Nothing is posted without your clear yes for that exact post.
- Speech and face models (about 75 MB) are downloaded once into `~/.dandelion-kit/models`.

## Develop

```
npm install
npm test        # unit tests, type check, copy check
node bin/kit.mjs serve --demo    # sample data in every tool, no video needed
```

The `.mcpb` bundle for Claude Desktop is built with `node scripts/build-mcpb.mjs`. A Mac bundle is not built yet.

## License

MIT. See LICENSE, NOTICE and THIRD_PARTY_NOTICES.md.
