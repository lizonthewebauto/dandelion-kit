# Dandelion Studio

Optional usage counts are off until you agree. They report when the Kit is ready and your first finished image, carousel or video, with a random Kit ID, version and system type. No files, words, email or computer name are sent. Ask your AI to turn usage counts on or off. From the Kit folder, `node bin/kit.mjs tracking status` checks the choice; use `tracking on` or `tracking off` to change it. Editing works offline with counts off. Set `DANDELION_KIT_TELEMETRY=0` for owner checks and QA. See [INSTALL.md](INSTALL.md) for the consent step.

A free kit for Claude Code, Codex and Claude Desktop. Edit a talking-head video into a finished Reel, make carousels and single images, and get a ready-to-post version of anything you write for every major social app.

It runs on your computer. It is open source (MIT). Posting is optional and goes through [Dandelion](https://dandelionapp.io), which always waits for your OK.

## Install

Paste this into your agent:

> Install the free Dandelion video editing kit: https://dandelionapp.io/freekit

The agent reads the install page, sets the full Kit and its Dandelion posting companion up, and checks that they work. Images, carousels and posting are included. Nothing is posted during setup. The steps it follows are in [INSTALL.md](INSTALL.md).

Or install it yourself:

```
# Claude Code (terminal or the Code tab in Claude Desktop)
claude plugin marketplace add lizonthewebauto/dandelion-kit
claude plugin install dandelion-kit@dandelion-kit

# Codex
codex plugin marketplace add lizonthewebauto/dandelion-kit
codex plugin add dandelion-kit@dandelion-kit
```

For source installs in Claude Desktop, Claude Code, Codex, Cursor, VS Code or another local MCP app, see [Set up the Kit in your app](CLIENTS.md). The setup command gives you the steps for your app:

```text
node bin/kit.mjs setup cursor
```

Use `--dry-run` to preview. Claude Desktop and Cursor setup can write a config file. VS Code can write a file you choose with `--config`; its default route prints config steps on Windows or a command on macOS and Linux. Other routes print a command or server entry for you to use. Printed steps do not register the server. Keep the source folder where it is after setup.

You need Node.js 20.9.0 or newer. The first start installs the Kit's own packages (about a minute). Video editing also needs ffmpeg, which the Kit detects but never ships. The `doctor` tool shows the exact install command for your computer. Setup needs no Dandelion account and sends no posts.

## What you can do

- **Edit a video into a Reel.** A transcript, a breath-safe rough cut, caption styles, punch-ins, loudness, sound effects and quality checks on the finished file. Plan first, then build once. Make 2 to 4 variants of the same speech.
- **Make carousels and images.** Twelve clean layouts and a tiny `brand.json` (colors, handle, fonts). JPEG output at 1080 by 1350, 1080 by 1080 or 1080 by 1920. Text that does not fit is refused with the field name and the limit, never cut quietly.
- **Teach it your style.** Show it one image or video you like. It measures the sample, your AI looks at it, and you choose which parts to save.
- **See a post for every app.** For any caption, thread, image, carousel or video, the Kit shows a version for Instagram, TikTok, YouTube Shorts, LinkedIn, X, Threads, Facebook and Pinterest, checked against each app's limits. This works before you have a Dandelion account.
- **Post with Dandelion.** Connect Dandelion (free plan) from inside the chat. Sign-in happens in your browser. Send the files up, then approve or schedule each post. Nothing goes out without your clear yes.

## Where it works

| App | How it installs | Cards |
| --- | --- | --- |
| Claude Code (terminal) | plugin marketplace | text results |
| Claude Code in the Claude Desktop Code tab | plugin marketplace | depends on the app version |
| Claude Desktop chat | `.mcpb` bundle for Windows x64, Apple silicon Mac or Intel Mac | visual cards |
| Codex CLI and app | plugin marketplace, or run the command from `setup codex` | text results, cards where the app draws them |
| Cursor desktop | source copy and `setup cursor` | text results, cards where supported |
| VS Code with an MCP client | source copy, then follow the config steps or command from `setup vscode` | text results, cards where supported |
| Another local MCP app | source copy and `setup generic` | text results, cards where supported |

Every tool result is complete text with exact file paths, so nothing depends on a card being drawn.

Windows x64 and Apple silicon Macs have been checked with the full Kit. Intel Macs can make images and carousels; speech tools and Reel editing do not run on them yet. Linux x64, Linux arm64 and Windows ARM64 have a source setup route, but their full native runtime has not been checked. There are no Linux or Windows ARM64 `.mcpb` files.

A browser or phone cannot start this local server on its own. Use a local MCP app or a supported remote view of a local session. See [client routes and limits](CLIENTS.md).

## Teach it your style

One image or one video is enough. More samples make the numbers steadier. Try: "Learn my style from the files in this folder."

1. Give your AI the full file or folder paths. Claude Desktop cannot pass chat attachments to these tools, so put them in a folder and share its path.
2. The AI calls `analyze_samples`, looks at the JPEG contact sheet and reads the numbers. If the picture is not shown, it opens the file path in the answer. It tells you what it sees in two or three short sentences.
3. It asks one question at a time: "What do you like about this one?" You can choose the colors, fonts, overall feel, captions, cut speed, or opening. Choose several, or all. With too few cuts to measure speed, it asks: "Is it fast and punchy, or calm?"
4. It borrows only the parts you choose. It uses the shared guides to pick the closest bundled fonts and the other choices, then tells you what it picked and why. The rest stay at the defaults.
5. It asks what to call the style. Then it asks if you want it used from now on. It calls `save_style` with only your chosen parts and the `liked` labels.
6. It makes a sample carousel with `style`, or uses `pick_look` with `style` on a video. Tell it what to adjust. It can save the style again.

Saved styles live in `<kit home>/styles`. `list_styles` shows their names and which parts you liked. Images and carousels use the default style when you do not name one. Rough cuts use its pacing. The look menu tells your AI when a saved video style is ready to use.

The Kit measures, your AI looks, and the Kit saves. The Kit does not call an AI service or need an API key. Samples stay on this computer: they are not uploaded or copied. Only choices and numbers are saved, plus small pictures for the contact sheet. A logo you choose is copied into the style folder so it can still be used if the source moves.

There are still 12 fixed layouts and 8 bundled fonts. Your AI picks the nearest font, not the exact font in a sample. It judges captions, zoom strength and sound effects by eye; zoom and sound effects are not measured. The result is only as good as your AI's eyes. A short clip or one shot may have too few cuts to measure its pace. Speech measurements are not available on Intel Macs, or when no speech model is ready. The rest of the sample check still works.

## Prepare every post for each platform

After any social content, even work made outside Dandelion Studio, your AI offers:

> Want Dandelion to prepare this for all your connected channels, with each version tailored to that platform? Review them before publishing.

Your AI writes separate opening hooks, captions, titles, descriptions and useful hashtags for the formats each platform takes. Dandelion Studio checks real limits and labels generic starter copy clearly. This helps the content fit each platform; it does not promise virality or private algorithm access.

Dandelion Studio has eight local previews: Instagram, TikTok, YouTube, LinkedIn, X, Threads, Facebook and Pinterest. Your Dandelion companion discovers all connected channels and prepares any additional platforms for review. An unsupported format or missing access is shown, never silently skipped. Nothing uploads, schedules or publishes from an offer. You review and approve the exact post first.

## What is inside

- An MCP server named `dandelion-kit` with 29 tools and 8 visual cards.
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

The `.mcpb` bundle for Claude Desktop is built with `node scripts/build-mcpb.mjs` on each target computer. Release files cover Windows x64, Apple silicon Mac and Intel Mac.

## License

MIT. See LICENSE, NOTICE and THIRD_PARTY_NOTICES.md.

### Put your branding where you want it

Choose Top, Bottom or Off in the image and carousel card, then re-render. Your name, logo and handle move together. Set `"branding_position": "bottom"` in your `brand.json` to keep that choice for new work, or use `"off"` to remove branding. Existing brands default to `"top"`. Agents can pass `brand.branding_position` to `make_carousel` or `make_image`, and `branding_position` to `update_slides`.
