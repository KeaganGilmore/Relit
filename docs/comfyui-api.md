# ComfyUI HTTP / WebSocket API

Captured from a live ComfyUI **0.20.1** instance on 2026-05-02. Update this
file (and the types in `packages/core/src/comfy/`) when the API changes.

> **Captured against:** ComfyUI 0.20.1, embedded Python 3.12.11, listening on
> `127.0.0.1:8000`. Note the README references port 8188 — that's the OSS
> default; the desktop app uses 8000. The base URL is configurable on the
> client.

## Base URL

`http://localhost:<port>`. Same-origin from a ComfyUI extension; configurable
otherwise.

---

## `GET /system_stats`

Health-check. Returns version + device info.

```json
{
  "system": {
    "os": "win32",
    "ram_total": 66193219584,
    "ram_free": 34477174784,
    "comfyui_version": "0.20.1",
    "python_version": "3.12.11 (...)",
    "pytorch_version": "2.10.0+cu130",
    "embedded_python": false,
    "argv": ["..."]
  },
  "devices": [
    {
      "name": "cuda:0 NVIDIA GeForce RTX 5070 Ti : cudaMallocAsync",
      "type": "cuda",
      "index": 0,
      "vram_total": 17094475776,
      "vram_free": 15738077184
    }
  ]
}
```

Use this as the liveness probe before submitting prompts.

---

## `POST /upload/image`

Multipart form upload. Captures the file under
`<comfyui-input-dir>/<subfolder>/<name>`.

**Form fields**

- `image` — file (required)
- `type` — `"input" | "temp" | "output"` (default `input`)
- `subfolder` — string, optional. Created if missing.
- `overwrite` — `"true"` to replace an existing file with the same name.

**Response**

```json
{ "name": "tiny.png", "subfolder": "", "type": "input" }
```

The `name` field may differ from the uploaded filename if `overwrite=false`
and a collision occurred (ComfyUI appends `(1)`, `(2)`, …).

---

## `POST /prompt`

Submit a workflow JSON for queueing.

**Request**

```json
{
  "client_id": "relit-<uuid>",
  "prompt": {
    "<node_id>": {
      "class_type": "LoadImage",
      "inputs": { "image": "tiny.png" }
    },
    "...": {}
  },
  "extra_data": {}
}
```

`client_id` is the same id used to subscribe to the WebSocket — only
messages for prompts submitted with that id are delivered to that socket.

**Response (success)**

```json
{
  "prompt_id": "4f4988a2-92ad-4aca-886d-dda9273cddf9",
  "number": 3,
  "node_errors": {}
}
```

**Response (validation error)** — HTTP 400 with body:

```json
{
  "error": {
    "type": "prompt_outputs_failed_validation",
    "message": "Prompt outputs failed validation",
    "details": "",
    "extra_info": {}
  },
  "node_errors": {
    "1": {
      "errors": [
        {
          "type": "custom_validation_failed",
          "message": "Custom validation failed for node",
          "details": "image - Invalid image file: tiny.png",
          "extra_info": { "input_name": "image" }
        }
      ],
      "dependent_outputs": ["2"],
      "class_type": "LoadImage"
    }
  }
}
```

**Response (no prompt)**:

```json
{
  "error": {
    "type": "no_prompt",
    "message": "No prompt provided",
    "details": "No prompt provided",
    "extra_info": {}
  },
  "node_errors": {}
}
```

---

## `GET /history/{prompt_id}`

Poll completion + outputs. Empty `{}` until the prompt has either succeeded
or failed.

```json
{
  "<prompt_id>": {
    "prompt": [
      3,
      "<prompt_id>",
      { "...workflow...": {} },
      { "client_id": "...", "create_time": 1777755003296 },
      ["<output_node_ids>"]
    ],
    "outputs": {
      "2": {
        "images": [{ "filename": "relit-probe_00001_.png", "subfolder": "", "type": "output" }]
      }
    },
    "status": {
      "status_str": "success",
      "completed": true,
      "messages": [
        ["execution_start", { "prompt_id": "...", "timestamp": 0 }],
        ["execution_cached", { "nodes": [], "prompt_id": "...", "timestamp": 0 }],
        ["execution_success", { "prompt_id": "...", "timestamp": 0 }]
      ]
    },
    "meta": {
      "2": { "node_id": "2", "display_node": "2", "parent_node": null, "real_node_id": "2" }
    }
  }
}
```

`status.status_str` observed values: `"success"`, `"error"`. On error, the
`messages` array contains an `execution_error` entry with `node_id`,
`exception_type`, `exception_message`, and `traceback`. Always read the
`messages` array — `status_str` alone hides which node failed.

`outputs[<node_id>]` keys observed: `images`, `gifs`. Other node types add
their own keys.

---

## `GET /history?max_items=N`

Returns the last N prompts in the same shape (object keyed by prompt_id).

---

## `GET /view`

Fetch a generated file. Returns binary.

**Query**

- `filename` (required)
- `subfolder` (default `""`)
- `type` — `"input" | "temp" | "output"` (default `"output"`)

`200 OK` on success; check `Content-Type` for the actual mime.

---

## `GET /queue`

Current queue.

```json
{ "queue_running": [], "queue_pending": [] }
```

Each entry is a 5-tuple matching the `prompt` field in `/history`:
`[number, prompt_id, workflow, extra_data, output_node_ids]`.

---

## `GET /object_info` and `/object_info/{class_type}`

Node schemas. Sample for `LoadImage`:

```json
{
  "LoadImage": {
    "input": { "required": { "image": [[], { "image_upload": true }] } },
    "input_order": { "required": ["image"] },
    "output": ["IMAGE", "MASK"],
    "output_is_list": [false, false],
    "output_name": ["IMAGE", "MASK"],
    "name": "LoadImage",
    "display_name": "Load Image",
    "category": "image",
    "output_node": false
  }
}
```

Use this in Phase 2+ to validate that a `WorkflowDefinition`'s referenced
nodes exist on the running ComfyUI before submitting.

---

## `WS /ws?clientId=<id>`

Subscribed messages are delivered as JSON frames `{ type, data }`. Binary
frames carry preview images. Observed `type` values:

- `status` — `{ status: { exec_info: { queue_remaining: N } }, sid: "<id>" }`
- `execution_start` — `{ prompt_id, timestamp }`
- `execution_cached` — `{ nodes: string[], prompt_id, timestamp }`
- `executing` — `{ node: string | null, display_node: string | null, prompt_id }` — `node === null` means execution finished
- `progress` — `{ value: N, max: M, prompt_id, node }` — incremental progress for nodes that support it (samplers)
- `executed` — `{ node, display_node, output, prompt_id }` — per-node outputs, mirrors history `outputs` shape
- `execution_success` — `{ prompt_id, timestamp }`
- `execution_error` — `{ prompt_id, node_id, node_type, executed, exception_message, exception_type, traceback }`
- `execution_interrupted` — `{ prompt_id, node_id, node_type, executed }`

The server drops idle sockets after a few minutes — clients must reconnect.
On reconnect, **state is not replayed**: catch up via `/history/<prompt_id>`
if a job was in flight.

---

## Observed assumption notes

- `LoadImage.image` accepts `"<filename>"` for files at the input root, and
  `"<subfolder>/<filename>"` for files in subfolders. **Path separator is `/`
  always**, even on Windows. (PIL chokes on `\\` mixed with `/`.)
- The desktop app's input directory is configurable via `--input-directory`
  CLI flag — don't assume `~/ComfyUI/input/`.
- `meta.<node_id>.parent_node` is non-null for nodes inside group nodes.
  `real_node_id` is the inner node id; `display_node` is what the UI shows.
- The same `client_id` reused across prompts is fine — ComfyUI scopes
  routing by it, not uniqueness.
