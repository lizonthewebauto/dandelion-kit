# Changelog

Changes to the shared shapes in `core/types.mjs` must be listed here, because every other module builds against them.

## Unreleased

- Scaffold: folder layout, shape definitions in `core/types.mjs`, copy check, licenses, bundled fonts.
- Shapes (review pass): added closed lists `TOOL_NAMES`, `APP_ONLY_TOOLS`, `WIDGET_IDS`, `SFX_NAMES`, `TRANSCRIBE_ENGINES`; added `sample` to `ASSET_KINDS`; new shapes `DoctorReport`, `ExportResult`, `FaceSample`, `PlatformFormat`, `PlatformRule`, `PlatformRules`, `PostJob`, `SentBundle`; `Project.face_boxes` became `Project.face_samples` (each box carries its time); `Project.variants` added; `PostBundle` channel entries gained `limits`, and the bundle gained `rules_source` and `sent`; `DandelionState` gained `workspace`, `usage` and `brand_id` on channels; `Look` gained optional `density_per_10s`.
- License holder is Dandelion (dandelionapp.io).
