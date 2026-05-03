import type { WorkflowDefinition } from '../workflow/definition.js';

/**
 * IC-Light relight + DetailTransfer to preserve the subject.
 *
 * **Required custom nodes** (install via ComfyUI Manager):
 * - `kijai/ComfyUI-IC-Light` — provides `LoadAndApplyICLightUnet` and
 *   `ICLightConditioning`.
 * - `Jonseed/ComfyUI-Detail-Daemon` (or any pack providing `DetailTransfer`).
 *
 * **Required model files**:
 * - `iclight_sd15_fc.safetensors` in `models/unet/`.
 * - An SD1.5 base checkpoint (default: realisticVisionV60B1_v51HyperVAE) —
 *   override via the `checkpoint` param.
 *
 * If those aren't present, ComfyUI will return a `validation` error from
 * `submitPrompt` listing the missing nodes/files — surface that to the user.
 */
export const iclightWorkflow: WorkflowDefinition = {
  id: 'iclight',
  displayName: 'IC-Light relight (SD1.5)',
  description:
    'Relights the input via IC-Light unet + a SD1.5 base, then DetailTransfer ' +
    'preserves the original subject. Requires kijai/ComfyUI-IC-Light + a ' +
    'DetailTransfer-providing custom node pack.',
  graph: {
    '1': {
      class_type: 'LoadImage',
      inputs: { image: '__INPUT__' },
      _meta: { title: 'Load input' },
    },
    '2': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: 'realisticVisionV60B1_v51HyperVAE.safetensors' },
      _meta: { title: 'Base SD1.5 checkpoint' },
    },
    '3': {
      class_type: 'LoadAndApplyICLightUnet',
      inputs: { model: ['2', 0], model_path: 'iclight_sd15_fc.safetensors' },
      _meta: { title: 'Apply IC-Light unet' },
    },
    '4': {
      class_type: 'ICLightConditioning',
      inputs: {
        positive: ['6', 0],
        negative: ['7', 0],
        vae: ['2', 2],
        foreground: ['1', 0],
        multiplier: 0.182,
      },
      _meta: { title: 'IC-Light conditioning' },
    },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { width: 768, height: 768, batch_size: 1 },
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
        positive: ['4', 0],
        negative: ['4', 1],
        latent_image: ['4', 2],
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
      target: { node: '4', input: 'multiplier' },
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
    width: {
      kind: 'integer',
      default: 768,
      min: 256,
      max: 2048,
      step: 64,
      label: 'Width',
      target: { node: '5', input: 'width' },
    },
    height: {
      kind: 'integer',
      default: 768,
      min: 256,
      max: 2048,
      step: 64,
      label: 'Height',
      target: { node: '5', input: 'height' },
    },
    checkpoint: {
      kind: 'string',
      default: 'realisticVisionV60B1_v51HyperVAE.safetensors',
      label: 'Base checkpoint',
      target: { node: '2', input: 'ckpt_name' },
    },
  },
};
