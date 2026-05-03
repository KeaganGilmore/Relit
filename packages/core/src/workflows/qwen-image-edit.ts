import type { WorkflowDefinition } from '../workflow/definition.js';

/**
 * Qwen-Image-Edit-2509 relight via prompt edits.
 *
 * Uses ComfyUI's built-in `TextEncodeQwenImageEditPlus` (ships with recent
 * ComfyUI; no external custom node pack required). Subject preservation
 * comes from Qwen-Image-Edit's identity-preserving conditioning rather than
 * a separate DetailTransfer pass.
 *
 * **Required model files**:
 * - `qwen_image_edit_2509_fp8_e4m3fn.safetensors` in `models/diffusion_models/`.
 * - `qwen_2.5_vl_7b_fp8_scaled.safetensors` in `models/text_encoders/`.
 * - `qwen_image_vae.safetensors` in `models/vae/`.
 */
export const qwenImageEditWorkflow: WorkflowDefinition = {
  id: 'qwen-image-edit',
  displayName: 'Qwen-Image-Edit 2509 (relight via prompt)',
  description:
    'Edits the input via Qwen-Image-Edit 2509 with a relight-focused prompt. ' +
    'Subject preservation is intrinsic to Qwen-Image-Edit conditioning.',
  graph: {
    '1': {
      class_type: 'LoadImage',
      inputs: { image: '__INPUT__' },
      _meta: { title: 'Load input' },
    },
    '2': {
      class_type: 'UNETLoader',
      inputs: { unet_name: 'qwen_image_edit_2509_fp8_e4m3fn.safetensors', weight_dtype: 'default' },
      _meta: { title: 'Qwen-Image-Edit UNET' },
    },
    '3': {
      class_type: 'CLIPLoader',
      inputs: { clip_name: 'qwen_2.5_vl_7b_fp8_scaled.safetensors', type: 'qwen_image' },
      _meta: { title: 'Qwen 2.5 VL CLIP' },
    },
    '4': {
      class_type: 'VAELoader',
      inputs: { vae_name: 'qwen_image_vae.safetensors' },
      _meta: { title: 'Qwen Image VAE' },
    },
    '5': {
      class_type: 'TextEncodeQwenImageEditPlus',
      inputs: {
        clip: ['3', 0],
        prompt: 'Relight the photo with soft cinematic lighting from the upper left.',
        vae: ['4', 0],
        image1: ['1', 0],
      },
      _meta: { title: 'Positive prompt' },
    },
    '6': {
      class_type: 'TextEncodeQwenImageEditPlus',
      inputs: {
        clip: ['3', 0],
        prompt: '',
        vae: ['4', 0],
        image1: ['1', 0],
      },
      _meta: { title: 'Negative prompt (empty)' },
    },
    '7': {
      class_type: 'EmptyQwenImageLayeredLatentImage',
      inputs: { width: 1024, height: 1024, batch_size: 1, layers: 1 },
      _meta: { title: 'Latent canvas' },
    },
    '8': {
      class_type: 'KSampler',
      inputs: {
        model: ['2', 0],
        positive: ['5', 0],
        negative: ['6', 0],
        latent_image: ['7', 0],
        seed: 0,
        steps: 20,
        cfg: 4.0,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1.0,
      },
      _meta: { title: 'Sampler' },
    },
    '9': {
      class_type: 'VAEDecode',
      inputs: { samples: ['8', 0], vae: ['4', 0] },
      _meta: { title: 'Decode' },
    },
    '10': {
      class_type: 'SaveImage',
      inputs: { images: ['9', 0], filename_prefix: '__OUTPUT__' },
      _meta: { title: 'Save output' },
    },
  },
  input: { node: '1', input: 'image' },
  output: { node: '10', input: 'filename_prefix' },
  params: {
    prompt: {
      kind: 'string',
      default: 'Relight the photo with soft cinematic lighting from the upper left.',
      multiline: true,
      label: 'Relight prompt',
      target: { node: '5', input: 'prompt' },
    },
    negativePrompt: {
      kind: 'string',
      default: '',
      multiline: true,
      label: 'Negative prompt',
      target: { node: '6', input: 'prompt' },
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
      default: 20,
      min: 4,
      max: 60,
      label: 'Steps',
      target: { node: '8', input: 'steps' },
    },
    cfg: {
      kind: 'number',
      default: 4.0,
      min: 1.0,
      max: 10.0,
      step: 0.1,
      label: 'CFG',
      target: { node: '8', input: 'cfg' },
    },
    width: {
      kind: 'integer',
      default: 1024,
      min: 256,
      max: 2048,
      step: 64,
      label: 'Width',
      target: { node: '7', input: 'width' },
    },
    height: {
      kind: 'integer',
      default: 1024,
      min: 256,
      max: 2048,
      step: 64,
      label: 'Height',
      target: { node: '7', input: 'height' },
    },
  },
};
