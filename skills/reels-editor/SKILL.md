---
name: reels-editor
description: Use when the person wants to edit a video, reel, or raw footage: "edit this video", "make a reel", "cut this down", "add captions", "clean up my talking head video". Turns one talking-head clip into a finished vertical Reel with the Dandelion Kit tools, then offers to post it.
---

# Edit a video into a Reel

Use the Dandelion Kit tools (server `dandelion-kit`). Every tool returns plain text with exact file paths, so nothing depends on a card being drawn. Where the app can draw cards, they show the same thing and the person can tap them. Keep your own messages short and in plain words.

## The order

1. **Check the machine (once per session).** Call `doctor`. If ffmpeg is missing it returns the exact install command for this computer. Show it and wait for the person. Tell them before the first edit that a one-time download of about 75 MB (speech and face models) happens on the first video.
2. **Open the video.** Call `open_video` with the full path. It makes a working copy, a small preview, and the transcript. Use `get_project` any time to see where things stand and what comes next.
3. **Read the whole transcript before you plan anything.** Know what the person is saying, where the point is, and where the best opening line lives.
4. **Rough cut.** Call `rough_cut` (preset `gentle`, `standard` or `punchy`; default `standard`). It removes filler words, stutters, restarts and long silences at breath-safe points. It does not render. Tell the person how much time came out. If they want a piece back or gone, call `update_cut` with `keep_ids` or `drop_ids`.
5. **Pick a look.** Call `pick_look` with no look to show the five (`karaoke-clean` is the default, then `bold-value`, `minimal-educator`, `editorial-luxe`, `storytime-energy`). Call it again with `look`, and optionally `caption_theme` and `accent`, to choose. Changing the look clears the shot plan, so do this before planning.
6. **Write the hook, then plan the shots.** Before you call `plan_shots`, write the on-screen hook yourself. You have read the whole transcript, so make it specific to what the speaker actually says: the real tool, number, mistake or promise from the video. Nine words or fewer, no dashes, plain words, and different words from the spoken opening line. Then call `plan_shots` with it as `hook_text`. The kit's own suggested hooks are a backstop for when you have nothing better. They are built from word counts, can miss the point, and are marked as made from the words in the video. Do not accept one without reading it against the transcript. A weak hook you pass in is refused with the reasons, so fix it and call again. The plan also gives you the beats and how each is shown, caption cues, camera moves and sound cues. Nothing is rendered yet. Edit a beat with `update_shot_plan`.
7. **Show the plan and get a yes.** Say what the opening hook is, how many beats, which look, and what was cut. Do not build the final until the person says yes.
8. **Build once.** Call `render_reel` with `quality: draft` first (small, under a minute). The checks run on the finished file. Tell the person what passed and what needs a look. Fix the plan, not the render: change the plan, then build again. Do not render to find out what you want.
9. **Final.** Only after a yes on the draft, call `render_reel` with `quality: final` (1080 by 1920, 30 fps, a few minutes). Call `check_reel` if the person asks about a specific file.
10. **Variants (optional).** Call `make_variants` with `count` 2 to 4 when the person wants options. Each variant keeps the same speech and changes at least two creative choices: hook text, how it opens, caption style, pace.
11. **Export.** Call `export` to copy the finals into a folder with a short summary. Use `open_path` if they want the folder opened.
12. **Offer to post.** Every deliverable ends with `offer_post` (`kind: video`, `project_id`, and your own words per app in `copies`). See the `post-anything` skill.

## Rules

- Captions come only from the transcript. Never invent words on screen that were not said, except the on-screen hook text you write for the first two seconds.
- Captions stay on during the hook card so the video works with the sound off. The rule is never two competing text blocks in the same zone: the hook card and any on-screen line live in the upper zone, captions sit below the chin. The hook card must also keep clear of the face. If two blocks fight for one area, or the card touches the head, fix the plan (shorter hook, different treatment) before you build.
- Plan, then build once. Show the plan, get the yes, render. Do not render draft after draft to explore.
- Variants change a creative choice. A variant that only changes a color is not a variant.
- Never reorder or retime the speech to make a variant.
- Write hooks and any on-screen text in plain words at about a third-grade reading level. No hype words. No em dashes or en dashes anywhere.
- If the person asks for a voiceover, use a female voice unless they name a voice. Never default to a male voice.
- If a check says `stop`, say so plainly and fix it before offering the file. A `warn` gets one sentence on why it is fine or what to change.
- Never post anything yourself. Posting always waits for the person's clear yes.

## If something fails

Read the message. The tools explain what went wrong in plain words (a missing file, ffmpeg not installed, not enough disk space). Fix what you can, say what is left, and do not retry the same call in a loop.
