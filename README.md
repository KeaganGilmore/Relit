# Relit

Relit is a local-first web UI for batch-processing images through a ComfyUI workflow. The goal is simple: drop in a folder of photos, run them through a relighting or shadow-removal workflow, and get polished results back without leaving your local machine.

This repository is currently at the scaffold stage. The UI shell exists, but the workflow integration and batch-processing logic still need to be implemented.

## What’s in the repo now

- A static dark-themed layout in [index.html](index.html)
- Styling built with plain CSS variables in [styles.css](styles.css)
- Placeholder ES modules for the app entrypoint and future ComfyUI/workflow helpers

## What’s left to get this going

1. Implement the ComfyUI client in [comfy.js](comfy.js) for image upload, prompt submission, WebSocket progress updates, and output fetching.
2. Add workflow patching in [workflow.js](workflow.js) so uploaded images are swapped into the selected `LoadImage` node.
3. Build the batch runner in [app.js](app.js) to process files one at a time on the client while ComfyUI handles the server-side queue.
4. Render real queue status, progress, and results in the UI.
5. Add downloads, ZIP export, retry, abort, and toast/error handling.
6. Persist the server URL, workflow choice, and output preference in `localStorage`.

## Planned behavior

- Runs entirely as static files, with no build step.
- Lives inside `ComfyUI/web/extensions/relit/` and is served by ComfyUI at `http://localhost:8188/extensions/relit/`.
- Uses the local ComfyUI API and WebSocket endpoints only.
- Generates a single `client_id` for the session and reuses it for the whole run.

## Current UI layout

The scaffold is split into three panels:

- Settings: server URL, workflow upload, and output preference
- Input images: drag-and-drop or file selection
- Queue and results: live status and output grid, once implemented

## Development notes

- Plain HTML, CSS, and JavaScript only
- ES modules only, no bundler
- Single external dependency planned: JSZip, loaded lazily for bulk downloads
- All async work should fail visibly in the UI instead of only logging to the console

## Repository layout

- [index.html](index.html) - App shell and semantic structure
- [styles.css](styles.css) - Dark theme and responsive layout
- [app.js](app.js) - DOM orchestration entrypoint
- [comfy.js](comfy.js) - ComfyUI API client helpers
- [workflow.js](workflow.js) - Workflow patching helpers

## License

See [LICENSE](LICENSE) for licensing details.

## Status

Open source and in active development. The next milestone is wiring the ComfyUI API and making the batch flow real.