# Changelog

Changes to the shared shapes in `core/types.mjs` must be listed here, because every other module builds against them.

## Unreleased

- M8: three skills (`reels-editor`, `carousel-maker`, `post-anything`), Claude Code plugin and marketplace manifests, `.mcp.json`, SessionStart hook, Codex plugin files and marketplace, `AGENTS.md`, README, and the Claude Desktop bundle build (`scripts/build-mcpb.mjs`, `mcpb/manifest.json`). Planned as 1.0.0.
- Scaffold: folder layout, shape definitions in `core/types.mjs`, copy check, licenses, bundled fonts.
- Shapes (review pass): added closed lists `TOOL_NAMES`, `APP_ONLY_TOOLS`, `WIDGET_IDS`, `SFX_NAMES`, `TRANSCRIBE_ENGINES`; added `sample` to `ASSET_KINDS`; new shapes `DoctorReport`, `ExportResult`, `FaceSample`, `PlatformFormat`, `PlatformRule`, `PlatformRules`, `PostJob`, `SentBundle`; `Project.face_boxes` became `Project.face_samples` (each box carries its time); `Project.variants` added; `PostBundle` channel entries gained `limits`, and the bundle gained `rules_source` and `sent`; `DandelionState` gained `workspace`, `usage` and `brand_id` on channels; `Look` gained optional `density_per_10s`.
- License holder is Dandelion (dandelionapp.io).
- Shapes (Fable QA 1): `Hook` gained `source` ("given" or "auto"); `CaptionAnchor` (stored in `ShotPlan.caption_anchor`) gained optional `head_top_y`. Caption theme sizes in `core/render/ass.mjs` are now em pixels; the ASS Fontsize is derived from the font's OS/2 win ascent plus descent (`fontmetrics.mjs` `ass_fontsize`). New check id `hook-clear-of-face`.
