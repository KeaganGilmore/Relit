import { resolve, isAbsolute } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import {
  BatchRunner,
  ComfyClient,
  ComfyWsClient,
  defaultParams,
  findWorkflow,
  type BatchEvent,
  type CollisionStrategy,
  type Params,
  type ParamValue,
} from '@relit/core';
import kleur from 'kleur';
import { createNodeFs } from './fs-node.js';
import { createLogger } from './log.js';
import { formatFailure } from './format-error.js';

export interface RunCommandOptions {
  readonly in: string;
  readonly out: string;
  readonly workflow: string;
  readonly comfyUrl: string;
  readonly suffix: string;
  readonly extension?: string;
  readonly collision: CollisionStrategy;
  readonly param: readonly string[];
  readonly itemTimeout: number;
  readonly concurrency: number;
  readonly failOnError: boolean;
  readonly logLevel: string;
  readonly noWs: boolean;
}

export const runCommand = async (options: RunCommandOptions): Promise<number> => {
  const inputDir = isAbsolute(options.in) ? options.in : resolve(process.cwd(), options.in);
  const outputDir = isAbsolute(options.out) ? options.out : resolve(process.cwd(), options.out);

  if (!existsSync(inputDir)) {
    process.stderr.write(kleur.red(`Input directory does not exist: ${inputDir}\n`));
    return 2;
  }
  mkdirSync(outputDir, { recursive: true });

  const def = findWorkflow(options.workflow);
  if (!def) {
    process.stderr.write(
      kleur.red(
        `Unknown workflow "${options.workflow}". Try one of: passthrough, iclight, qwen-image-edit\n`,
      ),
    );
    return 2;
  }

  const params = mergeParams(defaultParams(def), options.param, def);
  if (typeof params === 'string') {
    process.stderr.write(kleur.red(params + '\n'));
    return 2;
  }

  const fs = createNodeFs({ inputDir, outputDir });
  const list = await fs.listInputs();
  if (!list.ok) {
    process.stderr.write(kleur.red(`Failed to list inputs: ${list.error.kind}\n`));
    return 1;
  }
  if (list.value.length === 0) {
    process.stderr.write(kleur.yellow(`No images found in ${inputDir}\n`));
    return 0;
  }

  const correlationId = `relit-${Date.now().toString(36)}`;
  const log = createLogger(correlationId, options.logLevel);
  log.info({ inputDir, outputDir, workflow: def.id, total: list.value.length }, 'starting batch');

  const comfy = new ComfyClient({ baseUrl: options.comfyUrl });
  const stats = await comfy.systemStats();
  if (!stats.ok) {
    log.error({ error: stats.error }, 'comfyui unreachable');
    process.stderr.write(
      kleur.red(
        `Cannot reach ComfyUI at ${options.comfyUrl}. Start it or pass --comfy-url <url>.\n`,
      ),
    );
    return 1;
  }
  log.info({ version: stats.value.system.comfyui_version }, 'comfyui ok');

  const ws = options.noWs ? undefined : new ComfyWsClient({ url: comfy.wsUrl() });
  ws?.connect();

  const runner = new BatchRunner({ comfy, fs, ...(ws ? { ws } : {}) });

  const ctl = new AbortController();
  const onSig = () => ctl.abort();
  process.on('SIGINT', onSig);
  process.on('SIGTERM', onSig);

  let lastProgressKey = '';
  runner.on((e: BatchEvent) => {
    switch (e.type) {
      case 'batch_started':
        process.stdout.write(
          `Processing ${e.total} image${e.total === 1 ? '' : 's'} → ${outputDir}\n`,
        );
        break;
      case 'item_started':
        process.stdout.write(kleur.gray(`  · ${e.item.input}\n`));
        break;
      case 'item_progress': {
        const key = `${e.item.id}:${e.value}/${e.max}`;
        if (key === lastProgressKey) break;
        lastProgressKey = key;
        const pct = e.max > 0 ? Math.round((e.value / e.max) * 100) : 0;
        process.stdout.write(`\r    ${pct.toString().padStart(3, ' ')}% (${e.value}/${e.max})   `);
        if (e.value >= e.max) process.stdout.write('\n');
        break;
      }
      case 'item_completed':
        process.stdout.write(
          `\r${kleur.green('✓')} ${e.item.input} → ${e.outputName} (${(e.outputBytes / 1024).toFixed(1)} KB, ${e.elapsedMs}ms)   \n`,
        );
        break;
      case 'item_skipped':
        process.stdout.write(`${kleur.yellow('↷')} ${e.item.input} skipped (${e.reason})\n`);
        break;
      case 'item_failed':
        process.stdout.write(`\r${kleur.red('✗')} ${e.item.input}: ${formatFailure(e.reason)}\n`);
        break;
      case 'batch_completed':
        process.stdout.write(
          `\nDone in ${(e.summary.elapsedMs / 1000).toFixed(1)}s — ` +
            `${kleur.green(`${e.summary.succeeded} ok`)}, ` +
            `${kleur.yellow(`${e.summary.skipped} skipped`)}, ` +
            `${kleur.red(`${e.summary.failed} failed`)}\n`,
        );
        break;
      default:
        break;
    }
  });

  const summary = await runner.run({
    definition: def,
    params,
    inputs: list.value.map((e) => e.name),
    outputSuffix: options.suffix,
    ...(options.extension !== undefined ? { outputExtension: options.extension } : {}),
    collision: options.collision,
    itemTimeoutMs: options.itemTimeout,
    concurrency: options.concurrency,
    correlationId,
    signal: ctl.signal,
  });

  ws?.close();
  process.off('SIGINT', onSig);
  process.off('SIGTERM', onSig);

  if (options.failOnError && summary.failed > 0) return 1;
  return 0;
};

const parseValue = (raw: string): ParamValue => {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+$/.test(raw)) return Number.parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return Number.parseFloat(raw);
  return raw;
};

const mergeParams = (
  base: Params,
  overrides: readonly string[],
  def: { params: Record<string, unknown> },
): Params | string => {
  const out: Record<string, ParamValue> = { ...base };
  for (const o of overrides) {
    const eq = o.indexOf('=');
    if (eq === -1) return `Bad --param "${o}". Expected key=value.`;
    const key = o.slice(0, eq);
    const value = o.slice(eq + 1);
    if (!(key in def.params)) {
      return `Unknown param "${key}". Valid: ${Object.keys(def.params).join(', ')}`;
    }
    out[key] = parseValue(value);
  }
  return out;
};
