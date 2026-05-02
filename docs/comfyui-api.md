# ComfyUI HTTP / WebSocket API

Captured from a real local ComfyUI instance. Update as endpoints change or
new fields appear. Do not infer shapes — paste actual responses.

> **Status:** stub. Phase 1 will hit a live ComfyUI from a scratch script and
> capture real responses here. Until then, treat everything below as a
> placeholder list of endpoints we know we need.

## Base URL

`http://localhost:8188` by default. Same-origin once the web app is copied
into `~/ComfyUI/web/extensions/relit/`.

## Endpoints (to be filled in during Phase 1)

- `POST /upload/image` — multipart form upload. Captures filename for use in
  workflow `LoadImage` nodes.
- `POST /prompt` — submit a workflow JSON for queueing. Returns
  `{ prompt_id, number, node_errors }`.
- `GET /history/{prompt_id}` — poll for completion + outputs.
- `GET /view?filename=&subfolder=&type=` — fetch a generated image.
- `GET /queue` — current queue state.
- `GET /object_info` — node schemas (used to validate `WorkflowDefinition`s
  against the running ComfyUI version).
- `WS /ws?clientId=<uuid>` — progress + execution events. Reconnecting client
  required (server drops idle sockets).

## WebSocket message types observed

(To be captured in Phase 1.)

## Notes

- ComfyUI versions diverge in subtle ways. Pin the version we test against in
  `docs/decisions.md` once Phase 1 lands.
- Outputs of a prompt may live across multiple subfolders depending on the
  `SaveImage` / `PreviewImage` node config — always read paths from the
  history payload, never guess.
