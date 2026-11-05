---
name: carousel-maker
description: Use when the person wants a carousel, a slide post, an infographic, or a single social image. Makes clean JPEG slides from twelve layouts and a tiny brand file with the Dandelion Kit tools, then offers to post them.
---

# Make a carousel or an image

## Learn a style from samples

One image or one video is enough. Ask for full file or folder paths. Claude Desktop cannot pass chat attachments to tools, so ask them to put the files in a folder and share its path.

1. Call `analyze_samples`. Look at the JPEG contact sheet and read the numbers. Open the given file path if the picture is not shown. Say what you notice in two or three short sentences.
2. Ask one question at a time: "What do you like about this one?" Offer colors, fonts, overall feel, captions, cut speed, or opening. They can pick several or all. If there are too few cuts, also ask: "Is it fast and punchy, or calm?" Ask one short follow up only if needed.
3. Borrow only what they pick. Leave all other fields out so the defaults stay in place. Use the returned guides to choose the closest of the 8 bundled fonts, the page feel, captions and look for the chosen parts. Say what you picked and why. Sound effects and zoom strength are judged, not measured.
4. Ask: "What should I call this style?" Then ask: "Want me to use it from now on?" These are separate questions. Call `save_style` with only the chosen fields, `liked`, a short note and their default choice. Never save a full style without asking.
5. Show a sample carousel with `style`, or call `pick_look` with `style` on a video. Ask what to adjust, then save again if needed. On later work, `list_styles` shows saved choices. The default style is used for images, carousels and rough cut pacing. The look menu names the default video style; call with `style` to apply it.

Samples stay on this computer. The Kit measures, your AI looks, and the Kit saves. A short clip may not show enough cuts to measure its speed. Speech measurements can be unavailable, including on Intel Macs. Use the other measurements and ask the person.

Use `make_carousel` for several slides and `make_image` for one. Both render JPEG files (never PNG) and return the exact file paths.

## Start with the brand file

Call `list_styles` first. A saved default style is used unless you pass a brand or name another `style`. Look for `brand.json` in this folder, then in `~/.dandelion-kit/brand.json`. If no saved style or brand file exists, ask the person at most three short questions, then write the file:

1. Which colors? (background, text, one accent)
2. What handle goes on the slides?
3. What font mood: warm and editorial, clean and modern, or bold and loud?

```json
{
  "name": "Your Brand",
  "handle": "@yourhandle",
  "colors": { "bg": "#F5EFE3", "fg": "#1C1B18", "accent": "#D9441C", "muted": "#6B655A" },
  "fonts": { "heading": "Fraunces", "body": "Inter" }
}
```

If the person does not care, skip the questions and use the default brand. Colors are `#RRGGBB`. The brand file can be partial; missing parts come from the default.

## Layouts and their limits

Pick the layout that fits the idea, one idea per slide. Text over a limit is refused with the field name and the limit. Shorten it. Do not turn on `allow_overflow` unless the person asks.

- `cover`: kicker (30), title (60), subtitle (90)
- `list`: title (60), 1 to 6 items (48 each)
- `steps`: title (60), 1 to 5 steps (text 70, optional number)
- `stat`: number (8), label (60), note (120)
- `comparison`: title (60), left and right each with a heading (24) and 1 to 4 items (40)
- `quote`: quote (140), who (40)
- `checklist`: title (60), 1 to 7 items (44)
- `myth-fact`: myth (110), fact (130)
- `before-after`: title (50), before (100), after (100)
- `cta`: title (60), line (100), handle (30)
- `photo-hero`: image path, title (70), overlay (80)
- `framework`: title (60), 2 to 4 cells (heading 24, text 80)

Sizes: 1080 by 1350 is the default. Use 1080 by 1080 for a square and 1080 by 1920 for a story.

## Shape of a good carousel

Slide 1 is a cover that makes someone want slide 2. The middle slides each carry one point. The last slide is a `cta` that asks for one small thing (save, follow, reply with a word). Five to eight slides is usually right. Keep the same brand on every slide.

## Writing rules

- Plain words at about a third-grade reading level. Short sentences. Concrete numbers beat adjectives.
- No hype words ("game changer", "mind blowing", "revolutionary", "secret hack"). Say what it does.
- No em dashes or en dashes. Use a period, a comma, or a colon.
- Do not claim results you cannot back up.

## After you render

1. Tell the person the slide count and the folder. If they want edits, change the fields and call `update_slides` with the full slide list.
2. End with `offer_post` (`kind: carousel` or `image`, the `project_id`, and your own words per app in `copies`). The person sees a version for each app before they sign up for anything. See the `post-anything` skill.
3. Never post anything yourself. Posting waits for a clear yes.
