# Media tooling

Standalone, build-time media generators. These are **not** part of any test,
CI, or deployment pipeline — run them by hand when you need to regenerate a
marketing asset. They live here (not in `scripts/`, which is the Node
capability/dashboard pipeline) because they are language-specific one-off tools.

## `create-explainer.swift`

Renders a short marketing explainer video from the public product images in
`apps/web/assets/images/` using AppKit + AVFoundation. macOS only.

```bash
# from the repository root, so the script's relative asset paths resolve
swift tools/media/create-explainer.swift
```
