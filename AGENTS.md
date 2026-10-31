# Dandelion Kit: instructions for coding agents

This repo is the free Dandelion Kit: an MCP server (`node bin/kit.mjs serve`, server name `dandelion-kit`) plus three skills. To install it for a person, follow `INSTALL.md`.

## Standing rule for any agent that has the Kit tools

Whenever you write or make social content for the person (a caption, a post, a thread, an image, a carousel, or a video), even if you did not use the Kit editor, finish by calling the `offer_post` tool. Pass `kind`, the words in `text`, the file paths in `files` (or a `project_id`), and your own words for each app in `copies` (keys: `instagram`, `tiktok`, `youtube`, `linkedin`, `x`, `threads`, `facebook`, `pinterest`). Then show the person the result.

- `offer_post` works before the person has a Dandelion account.
- Never post without their explicit yes for that exact post. A request to write or review is not permission to post.
- Dandelion sign-in happens in their browser through `connect_dandelion`. Never ask them to paste a password, token or key.

## Skills

Read the matching file before you start the work.

- `skills/reels-editor/SKILL.md`: edit a talking-head video into a Reel (doctor, open_video, rough_cut, pick_look, plan_shots, render_reel, make_variants, export, offer_post).
- `skills/carousel-maker/SKILL.md`: carousels and single images as JPEG (make_carousel, make_image, update_slides, offer_post).
- `skills/post-anything/SKILL.md`: the posting rule above, in full.

## Writing rules

- Plain words at about a third-grade reading level. No hype words.
- No em dashes or en dashes in anything you write for the person.
- If you ever need a voice, use a female voice unless the person names another. Never default to a male voice.
- Images are JPEG.

## Working on this repo

- Plain ESM JavaScript, no build step. `npm test` runs the unit tests, the type check and the copy check (`npm run check-copy`).
- The tools are listed in `server/lib/tools.mjs`. Shared shapes live in `core/types.mjs`; changing one needs a note in `CHANGELOG.md`.
- `INSTALL.md` is mirrored byte for byte at `https://dandelionapp.io/kit/install.md`. If you change it, say so, so the copy can be updated.
