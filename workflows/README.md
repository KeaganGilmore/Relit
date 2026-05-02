# Workflows

ComfyUI **API-format** workflow JSON, version-controlled.

To export from ComfyUI: open the workflow → enable Dev Mode in settings →
"Save (API Format)". Drop the file here.

Each workflow JSON pairs with a `WorkflowDefinition` in
`packages/core/src/workflows/` declaring which node IDs are the input image,
output image, and user-tunable fields (seed, prompt, light direction,
denoise, etc.). The definition is the contract `BatchRunner` consumes — the
JSON is opaque otherwise.

## Adding a new workflow

1. Export the API-format JSON from ComfyUI into this folder.
2. Add a `WorkflowDefinition` in `packages/core/src/workflows/<name>.ts`
   pointing at the JSON and declaring its inputs/outputs/params.
3. Add a unit test that loads the JSON and asserts the patcher produces the
   expected mutated graph for a sample input.
4. Add an integration test (gated by `RELIT_LIVE=1`) that round-trips a real
   image through a live ComfyUI.
