import { Command, Option } from 'commander';
import { builtInWorkflows, VERSION } from '@relit/core';
import { runCommand, type RunCommandOptions } from './run-command.js';

const program = new Command();

program
  .name('relit')
  .description('Local-first batch image relighting through ComfyUI')
  .version(VERSION);

program
  .command('run')
  .description('Relight every image in a folder using a workflow')
  .requiredOption('-i, --in <dir>', 'input directory')
  .requiredOption('-o, --out <dir>', 'output directory')
  .addOption(
    new Option('-w, --workflow <id>', 'workflow id')
      .choices(builtInWorkflows.map((w) => w.id))
      .default('passthrough'),
  )
  .option('--comfy-url <url>', 'ComfyUI base URL', 'http://localhost:8188')
  .option('-s, --suffix <s>', 'output filename suffix', '_relit')
  .option('--ext <ext>', 'force output extension (e.g. .png)')
  .addOption(
    new Option('--collision <strategy>', 'collision handling')
      .choices(['skip', 'overwrite', 'number'])
      .default('number'),
  )
  .option('-p, --param <key=value...>', 'override workflow params (repeatable)', collect, [])
  .option(
    '--item-timeout <ms>',
    'per-image timeout in ms',
    (v) => Number.parseInt(v, 10),
    5 * 60 * 1000,
  )
  .option('-c, --concurrency <n>', 'max items in flight at once', (v) => Number.parseInt(v, 10), 1)
  .option('--fail-on-error', 'exit non-zero if any image fails', false)
  .option('--log-level <level>', 'pino log level', 'info')
  .option('--no-ws', 'disable WebSocket progress (poll history only)', false)
  .action(async (raw: Record<string, unknown>) => {
    const opts: RunCommandOptions = {
      in: raw['in'] as string,
      out: raw['out'] as string,
      workflow: raw['workflow'] as string,
      comfyUrl: raw['comfyUrl'] as string,
      suffix: raw['suffix'] as string,
      ...(raw['ext'] !== undefined ? { extension: raw['ext'] as string } : {}),
      collision: raw['collision'] as RunCommandOptions['collision'],
      param: (raw['param'] as string[]) ?? [],
      itemTimeout: raw['itemTimeout'] as number,
      concurrency: raw['concurrency'] as number,
      failOnError: raw['failOnError'] as boolean,
      logLevel: raw['logLevel'] as string,
      noWs: raw['ws'] === false,
    };
    const code = await runCommand(opts);
    process.exit(code);
  });

program
  .command('workflows')
  .description('List built-in workflows and their parameters')
  .action(() => {
    for (const w of builtInWorkflows) {
      process.stdout.write(`${w.id}\t${w.displayName}\n`);
      if (w.description) process.stdout.write(`  ${w.description}\n`);
      const paramKeys = Object.keys(w.params);
      if (paramKeys.length > 0) {
        process.stdout.write(`  Params: ${paramKeys.join(', ')}\n`);
      }
      process.stdout.write('\n');
    }
  });

program.parseAsync(process.argv).catch((e: unknown) => {
  process.stderr.write(`Unhandled error: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});

function collect(value: string, previous: readonly string[]): readonly string[] {
  return [...previous, value];
}
