# Changelog

## 1.1.4 (2026-11-11)

- Make the all-connected-channel posting offer explicit after every social deliverable, including content made outside Dandelion Studio. Instructions require independently written platform hooks, copy, useful hashtags and fitting formats, with exact-post approval before publishing.
- Label text-only fallback as generic starter copy, carry platform writing guidance, and show additional connected channels that need the Dandelion companion. Eight local previews are disclosed separately from companion coverage. No virality or private algorithm claims.
- Pick a supported video format that fits its duration rather than labelling every YouTube video a Short. Shared post bundle entries now include copy_source and guidance; bundles can carry the offer prompt and scope note.

## 1.1.3 (2026-11-10)

- Public name is Dandelion Studio. Existing install links, plugin IDs and commands stay compatible.
- Images and carousels support `brand.branding_position`: `top`, `bottom` or `off`. The card picker and `update_slides` can change it on an existing project. Off hides the name, logo and handle; a brand.json preference carries into new work. Existing brands keep top placement.
- Video titles handle Windows file paths on every supported host. Renderer checks ignore the person's saved branding, and the missing-FFmpeg check respects macOS Homebrew fallback paths.

## 1.1.2 (2026-11-05)

- Add the usage_reporting tool slot and `kit tracking on|off|status`. Optional ready-install and first-finished-output counts require explicit consent, default off and share only a random Kit ID, version and system type with Dandelion. No files or account details leave the computer. Failed reporting never fails an install, render or export. Demo, test and forced-off runs send nothing.
- Desktop install instructions use the owned download-count link with an exact GitHub asset fallback. Download requests, ready installs and first finished outputs are separate signals.

## 1.1.1 (2026-11-05)

- Add kit setup for local AI clients, safe JSON config merging and full-path launch entries. CLIENTS.md lists supported routes and their limits. Command previews do not sign in or post.
- First setup checks for Node 20.9 or newer, uses CPU packages by default and stops with a clear note if it cannot write the install folder.


## 1.1.0 (2026-11-05)

- Teach the Kit your style from one sample. analyze_samples, save_style and list_styles bring the tool count to 28. Your AI asks what you like and saves only those parts.

- ToolOutcome and ToolResult can include image blocks after the text. analyze_samples now returns a local JPEG sheet, measurements, shared rubrics and a partial suggestion. Large cut lists stay in a local JSON file so the reply stays small.

- Add SampleVideo measurements and confidence. Short or single-shot clips leave cut speed, camera strength and density unset. Speech can be unavailable without blocking the other readings.

- Add SavedStyle, VideoStyle, LookOverrides and SampleImage shapes. Image samples can be measured on this computer for colors, contrast, space and background detail.

- Projects and shot plans can keep look_overrides. Video choices now reach planning, variants, caption samples and the color grade, and take part in the render hash.

- Projects can keep style_name and carousel_tokens, a snapshot of image choices. Saved styles can set corners, heading case, backgrounds, margins and footer rules.

- Add partial StyleInput and CarouselTokens shapes, a local style store, and analyze_samples, save_style and list_styles tool slots. Only chosen parts are saved.


Changes to the shared shapes in `core/types.mjs` must be listed here, because every other module builds against them.

## 1.0.14 (2026-11-05)

- The free Kit page moved to https://dandelionapp.io/freekit (share link: https://dandelionapp.io/go/freekit). The paste sentence in INSTALL.md and the README, the homepage in every manifest, the sign-in app address (`CLIENT_URI`, now `/freekit`) and the sign-up link in `server/text.mjs` use it. The old `/kit` and `/go/kit` still work, and Kits installed earlier still count, so nothing already shared or installed breaks.

## 1.0.13 (2026-11-04)

- Fix: first-run setup could wait forever. On one Mac, with Claude Code starting the Kit, `npm install` stalled for good reading its own cache (every file worker stuck in `open`), and the person only ever got "setting up". After 2.5 minutes the Kit now stops npm and tries once more with a fresh cache, so setup finishes or fails with a clear message. npm also writes to its own log file in the temp folder, not the host's stderr.

## 1.0.12 (2026-11-04)

- Fix: older Claude Code versions refused to install the plugin ("Unrecognized key: displayName"). Found on 2.1.22 and 2.1.71 on real Macs. The key is gone from `.claude-plugin/plugin.json`.

## 1.0.11 (2026-11-04)

Found by running the public installers on real Macs.

- Fix: with an ffmpeg that cannot draw captions, `render_reel` and `make_variants` failed with a raw ffmpeg error. They now say so in plain words with the install command (`captionsProblem` in `core/media/ffmpeg.mjs`), and check again each time so a fresh install works with no restart.
- Fix: on an Intel Mac, `doctor` said the speech model downloads on first use and sent the person off to install ffmpeg. It now says reels cannot be edited there. `DoctorReport.models` gained optional `speech_problem`, and `ok` is false when no speech engine can run.

## 1.0.10 (2026-11-04)

- Fix: on an Intel Mac, editing a reel failed with a missing file error. The speech engine (`onnxruntime-node`) ships no Intel Mac files since 1.24, so the Kit now says so in plain words (`transformersCanRun` in `core/transcribe/whisper.mjs`). Carousels, images and posting still work there. An Intel Mac with `whisper-cli` and a model file can still edit reels.

## 1.0.9 (2026-11-04)

- Fix: on a Mac, reels hit "cannot draw captions". Homebrew's plain `ffmpeg` has no libass, so the install hint is now `brew install ffmpeg-full`. The Kit also finds ffmpeg-full by name, since Homebrew keeps it off PATH, and looks in Homebrew's folders when an app opened from the Dock has a short PATH.
- New: Claude Desktop bundles for Mac (Apple Silicon and Intel) on the release.

## 1.0.8 (2026-11-04)

- Fix: a render always asked for 3 GB free, even for a 10 second clip. It now asks for 1 GB plus 25 MB a second, up to 3 GB (`renderSpaceBytes` in `core/util/disk.mjs`). Reels of about 80 seconds or more still ask for the full 3 GB, and so does a length the kit cannot read.

## 1.0.7 (2026-11-04)

- Fix: video editing failed in Codex with "Cannot find package '@huggingface/transformers'". Codex replaces a plugin's whole version folder a few seconds into every session, which wiped a `node_modules` inside it while the Kit was already running. Inside a plugin cache the packages now go in the `plugins` folder (`depsHome` in `bin/deps.mjs`), which Node's lookup still reaches. `depsReady` also compares the Kit version there, so an update installs its own packages. Found by a model-driven run on a Mac, with a folder watch showing 154 packages drop to 0.

## 1.0.6 (2026-11-04)

Found by tapping every button on the real cards in Claude Desktop.

- Fix: Post with Dandelion on the export card put the reel and its variants into one video post. It now offers only the main reel, and `offer_post` refuses a video post with more than one video.
- Fix: with an out of date final, the Draft tab offered no way to build it again. Render final again now shows on every tab.
- Fix: Run checks again gave no sign that it ran. The card now says so.

## 1.0.5 (2026-11-04)

- Fix: after a kit update, Claude Desktop kept showing the old card with the new tools until the app restarted. The card address now carries the kit version (`ui://dandelion-kit/v<version>/<id>.html`), so each release is a new card. Cards in chats from an older version may not draw; their text is still there.
- Fix: a scheduled post can now be cancelled from the post card, in two taps. `skip_post` waits out the few seconds after scheduling when Dandelion answers that the post changed.
- Fix: while a post is "Getting ready", the card shows the person's words, not Dandelion's draft. This changes `PostJob.copy` for a `preparing` job.
- Fix: `export` could copy a final reel older than the shot plan and say nothing. `export` now answers with `warnings`, the export card and summary.md say so, and the preview card marks an out of date reel and offers Render final again.

## 1.0.4 (2026-11-04)

Found by tapping Approve on the real post card in Claude Desktop.

- Fix: a post Dandelion stops, such as a duplicate, was a dead end in the card, with "send force: true" on screen. The card now says why in plain words and offers Post it anyway, which takes two taps. `approve_post` gained an optional `force`, and its stop message no longer tells a person to send a field.
- Fix: the post card kept saying "Nothing has gone out yet" after a post was approved.

## 1.0.3 (2026-11-04)

- Fix: a caption with no hashtags now means none. Dandelion drafts its own hashtags, and they stayed on the post when the person's words had none. The post card also shows a post's hashtags now, so nothing goes out unseen. Found by checking 1.0.2 against real Dandelion.

## 1.0.2 (2026-11-04)

Found by the first real post from the kit (Instagram, 3 slide carousel).

- Fix: a post could go out with words the person never wrote. In review mode Dandelion takes about a minute to prepare a post and refuses new words until then. The kit waited 45 seconds, its save was refused, and the card still offered Approve on Dandelion's own draft. It now waits up to 3 minutes and never saves words early. A post still not ready gets the new `PostJob.status` value `preparing`: the card offers Check again instead of Approve, and `approve_post` refuses it while Dandelion is still preparing.
- Fix: `send_to_dandelion` timed out in hosts that stop waiting after about a minute, and the card showed an error while the send carried on. It now runs in the background like `render_reel`: after 40 seconds it answers `{pending: true, tool, bundle_id, progress, message}`, and the same call joins the same send. `RenderJob.quality` is now optional.
- Fix: new posts are saved to the bundle as soon as Dandelion makes them, so a send that gets cut off cannot share them twice. Sending again finishes them.
- Fix: with no brand set, slides said "YOUR BRAND" and "@yourhandle", which would go out in a real post. `DEFAULT_BRAND` now has an empty `name` and `handle`, and the slides leave them out.

## 1.0.1 (2026-11-02)

- Fix: the Codex plugin now starts its own installed copy (`node ./bin/kit.mjs serve` with `cwd: "."`, which Codex resolves to the plugin folder) instead of `npx -y github:lizonthewebauto/dandelion-kit serve`. npx downloaded the Kit again on every start (20 to 70 s), and Codex began the turn with only its built-in tools, so the Kit's tools never arrived. Codex does not expand `${PLUGIN_ROOT}` in a plugin's server args, so the relative `cwd` is the way in.
- Fix: in Codex the Kit's tools never showed up. Codex starts the Kit with `npx github:lizonthewebauto/dandelion-kit serve`, and npx puts the packages one level above the Kit, not in its own `node_modules`. The old check looked only inside, so every start ran the first-run setup, which offers one `setup_status` tool and installs again in the background. Codex lists tools once per session, so the real tools never appeared. The new `bin/deps.mjs` (`depsReady`, `packageReachable`) looks the way Node does, in the Kit folder and then each parent folder, for every runtime dependency. `bin/kit.mjs` and `hooks/session-start.mjs` both use it.
- Fix: `open_video` and `get_project` now say they show the reel editor card. In a Claude Desktop chat, asked to "open my video in the reel editor card", the model called `get_project` and the card showed, but the model then said no tool shows that card.

## 1.0.0 (2026-10-31)

- Fix: caption lines now fit the safe zone at their widest moment. `one-word-pop` swells to 112% and the width check ignored that, so a long word could reach 14 px past x 940 (`captions-safe-zone: stop` on a 113 s clip). `layoutCue` in `core/render/ass.mjs` now fits the measured width including the swell, outline and shadow (`fitWidth`, `FIT_WIDTH`): it shrinks in steps to the theme minimum, then adds lines, and only a single word that is still too wide goes below the minimum (`below_min`). `measureCaptionBounds` holds each pop at its widest swell so the check measures the worst case. `RENDER_VERSION` is now 3, so cached renders from the old layout are not reused. `layoutCue` results gained `fit_width`, `fits` and `below_min`; the layout summary gained `widest_peak`.
- Long builds no longer time out in hosts that stop waiting after about a minute (the official ext-apps basic-host, Claude Desktop). `render_reel` and `make_variants` now run the build in the background and wait up to 40 seconds (`DANDELION_KIT_RENDER_WAIT_MS`, which `kit edit` sets very high so the command line still waits). If it is not done they answer `{project_id, quality, pending: true, progress: 0 to 1, message}` (plus `tool`, and `count` for variants); the same call again joins the same build and never starts a second one, and an error from a build nobody waited for comes back on the next call. `get_project` adds `rendering: {quality, progress, tool}` while a build runs. The preview and project cards draw a progress bar and a Check again button for it. Card data shapes: `PreviewPending` and `ProjectCard.rendering` in `server/widgets/contracts.mjs`. Planned as 1.0.0.
- M8: three skills (`reels-editor`, `carousel-maker`, `post-anything`), Claude Code plugin and marketplace manifests, `.mcp.json`, SessionStart hook, Codex plugin files and marketplace, `AGENTS.md`, README, and the Claude Desktop bundle build (`scripts/build-mcpb.mjs`, `mcpb/manifest.json`). Planned as 1.0.0.
- Scaffold: folder layout, shape definitions in `core/types.mjs`, copy check, licenses, bundled fonts.
- Shapes (review pass): added closed lists `TOOL_NAMES`, `APP_ONLY_TOOLS`, `WIDGET_IDS`, `SFX_NAMES`, `TRANSCRIBE_ENGINES`; added `sample` to `ASSET_KINDS`; new shapes `DoctorReport`, `ExportResult`, `FaceSample`, `PlatformFormat`, `PlatformRule`, `PlatformRules`, `PostJob`, `SentBundle`; `Project.face_boxes` became `Project.face_samples` (each box carries its time); `Project.variants` added; `PostBundle` channel entries gained `limits`, and the bundle gained `rules_source` and `sent`; `DandelionState` gained `workspace`, `usage` and `brand_id` on channels; `Look` gained optional `density_per_10s`.
- License holder is Dandelion (dandelionapp.io).
- Shapes (Fable QA 1): `Hook` gained `source` ("given" or "auto"); `CaptionAnchor` (stored in `ShotPlan.caption_anchor`) gained optional `head_top_y`. Caption theme sizes in `core/render/ass.mjs` are now em pixels; the ASS Fontsize is derived from the font's OS/2 win ascent plus descent (`fontmetrics.mjs` `ass_fontsize`). New check id `hook-clear-of-face`.
