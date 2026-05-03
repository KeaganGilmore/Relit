import type { WorkflowDefinition } from '../workflow/definition.js';

/**
 * IC-Light relight + DetailTransfer to preserve the subject.
 *
 * **Required custom nodes** (install via ComfyUI Manager or git clone):
 * - `kijai/ComfyUI-IC-Light` — provides `LoadAndApplyICLightUnet` and
 *   `ICLightConditioning`.
 * - `Jonseed/ComfyUI-Detail-Daemon` — provides `DetailTransfer`.
 *
 * **Required model files**:
 * - `iclight_sd15_fc.safetensors` in `models/unet/`.
 * - An SD1.5 base checkpoint in `models/checkpoints/`.
 *
 * Output size matches the input image (IC-Light derives the latent size
 * from the encoded foreground).
 */
export const iclightWorkflow: WorkflowDefinition = {
  id: 'iclight',
  displayName: 'IC-Light relight (SD1.5)',
  description:
    'Relights the input via IC-Light unet + an SD1.5 base, then DetailTransfer ' +
    'preserves the original subject.',
  graph: {
    '1': {
      class_type: 'LoadImage',
      inputs: { image: '__INPUT__' },
      _meta: { title: 'Load input' },
    },
    '2': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: 'v1-5-pruned-emaonly-fp16.safetensors' },
      _meta: { title: 'Base SD1.5 checkpoint' },
    },
    '3': {
      class_type: 'LoadAndApplyICLightUnet',
      inputs: { model: ['2', 0], model_path: 'iclight_sd15_fc.safetensors' },
      _meta: { title: 'Apply IC-Light unet' },
    },
    '4': {
      class_type: 'VAEEncode',
      inputs: { pixels: ['1', 0], vae: ['2', 2] },
      _meta: { title: 'Encode foreground' },
    },
    '5': {
      class_type: 'ICLightConditioning',
      inputs: {
        positive: ['6', 0],
        negative: ['7', 0],
        vae: ['2', 2],
        foreground: ['4', 0],
        multiplier: 0.182,
      },
      _meta: { title: 'IC-Light conditioning' },
    },
    '6': {
      class_type: 'CLIPTextEncode',
      inputs: { clip: ['2', 1], text: 'soft cinematic lighting, photo, high detail' },
      _meta: { title: 'Positive prompt' },
    },
    '7': {
      class_type: 'CLIPTextEncode',
      inputs: { clip: ['2', 1], text: 'lowres, blurry, watermark, jpeg artifacts' },
      _meta: { title: 'Negative prompt' },
    },
    '8': {
      class_type: 'KSampler',
      inputs: {
        model: ['3', 0],
        positive: ['5', 0],
        negative: ['5', 1],
        latent_image: ['5', 2],
        seed: 0,
        steps: 25,
        cfg: 2.0,
        sampler_name: 'dpmpp_2m_sde_gpu',
        scheduler: 'karras',
        denoise: 1.0,
      },
      _meta: { title: 'Sampler' },
    },
    '9': {
      class_type: 'VAEDecode',
      inputs: { samples: ['8', 0], vae: ['2', 2] },
      _meta: { title: 'Decode' },
    },
    '10': {
      class_type: 'DetailTransfer',
      inputs: {
        target: ['9', 0],
        source: ['1', 0],
        mode: 'add',
        blur_sigma: 1.0,
        blend_factor: 1.0,
      },
      _meta: { title: 'Detail transfer (preserve subject)' },
    },
    '11': {
      class_type: 'SaveImage',
      inputs: { images: ['10', 0], filename_prefix: '__OUTPUT__' },
      _meta: { title: 'Save output' },
    },
  },
  input: { node: '1', input: 'image' },
  output: { node: '11', input: 'filename_prefix' },
  params: {
    prompt: {
      kind: 'string',
      default: 'soft cinematic lighting, photo, high detail',
      multiline: true,
      label: 'Lighting prompt',
      target: { node: '6', input: 'text' },
    },
    negativePrompt: {
      kind: 'string',
      default: 'lowres, blurry, watermark, jpeg artifacts',
      multiline: true,
      label: 'Negative prompt',
      target: { node: '7', input: 'text' },
    },
    seed: {
      kind: 'seed',
      default: 0,
      randomize: true,
      label: 'Seed',
      target: { node: '8', input: 'seed' },
    },
    steps: {
      kind: 'integer',
      default: 25,
      min: 4,
      max: 80,
      label: 'Steps',
      target: { node: '8', input: 'steps' },
    },
    cfg: {
      kind: 'number',
      default: 2.0,
      min: 1.0,
      max: 8.0,
      step: 0.1,
      label: 'CFG',
      target: { node: '8', input: 'cfg' },
    },
    multiplier: {
      kind: 'number',
      default: 0.182,
      min: 0.05,
      max: 0.5,
      step: 0.01,
      label: 'IC-Light multiplier',
      target: { node: '5', input: 'multiplier' },
    },
    detailBlend: {
      kind: 'number',
      default: 1.0,
      min: 0.0,
      max: 1.0,
      step: 0.05,
      label: 'Detail blend',
      target: { node: '10', input: 'blend_factor' },
    },
    checkpoint: {
      kind: 'string',
      default: 'v1-5-pruned-emaonly-fp16.safetensors',
      label: 'Base checkpoint',
      target: { node: '2', input: 'ckpt_name' },
    },
  },
};
