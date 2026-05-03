import {
  BatchRunner,
  ComfyClient,
  ComfyWsClient,
  builtInWorkflows,
  defaultParams,
  findWorkflow,
  type BatchEvent,
  type BatchSummary,
  type CollisionStrategy,
  type Params,
} from '@relit/core';
import { createFsaFs } from './fs-fsa.js';
import { paramForm } from './ui/param-form.js';
import { h, clear } from './ui/dom.js';
import { formatFailure } from './format-error.js';
import { loadSettings, saveSettings } from './storage.js';

interface ItemRow {
  readonly tr: HTMLTableRowElement;
  readonly stateCell: HTMLTableCellElement;
  readonly progressBar: HTMLElement;
  readonly noteCell: HTMLTableCellElement;
  readonly thumbCell: HTMLTableCellElement;
}

const DEFAULT_COMFY_URL =
  typeof window !== 'undefined' && window.location.protocol.startsWith('http')
    ? `${window.location.protocol}//${window.location.host}`
    : 'http://localhost:8188';

export const start = (): void => {
  const settings = loadSettings();
  const stored: { current: Params } = { current: {} };

  const state = {
    inputDir: undefined as FileSystemDirectoryHandle | undefined,
    outputDir: undefined as FileSystemDirectoryHandle | undefined,
    workflow: findWorkflow(settings.workflowId ?? 'passthrough') ?? builtInWorkflows[0]!,
    comfyUrl: settings.comfyUrl ?? DEFAULT_COMFY_URL,
    suffix: settings.suffix ?? '_relit',
    collision: (settings.collision ?? 'number') as CollisionStrategy,
    running: false,
    abort: undefined as AbortController | undefined,
    lastSummary: undefined as BatchSummary | undefined,
  };
  const rows = new Map<string, ItemRow>();

  const root = document.getElementById('app');
  if (!root) return;
  clear(root);

  // ---- sidebar ----
  const comfyUrlInput = h('input', { type: 'url', value: state.comfyUrl }) as HTMLInputElement;
  comfyUrlInput.addEventListener('input', () => {
    state.comfyUrl = comfyUrlInput.value;
    persist();
  });

  const workflowSelect = h('select', {}) as HTMLSelectElement;
  for (const w of builtInWorkflows) {
    const opt = h('option', { value: w.id }, w.displayName);
    if (w.id === state.workflow.id) opt.setAttribute('selected', 'selected');
    workflowSelect.appendChild(opt);
  }

  const suffixInput = h('input', { type: 'text', value: state.suffix }) as HTMLInputElement;
  suffixInput.addEventListener('input', () => {
    state.suffix = suffixInput.value;
    persist();
  });

  const collisionSelect = h('select', {}) as HTMLSelectElement;
  for (const c of ['number', 'skip', 'overwrite'] as const) {
    const opt = h('option', { value: c }, c);
    if (c === state.collision) opt.setAttribute('selected', 'selected');
    collisionSelect.appendChild(opt);
  }
  collisionSelect.addEventListener('change', () => {
    state.collision = collisionSelect.value as CollisionStrategy;
    persist();
  });

  const inputDirBtn = h(
    'button',
    { class: 'secondary' },
    'Choose input folder…',
  ) as HTMLButtonElement;
  const outputDirBtn = h(
    'button',
    { class: 'secondary' },
    'Choose output folder…',
  ) as HTMLButtonElement;
  const inputDirLabel = h('div', { class: 'status' }, '(none)');
  const outputDirLabel = h('div', { class: 'status' }, '(none)');

  const runBtn = h('button', {}, 'Run') as HTMLButtonElement;
  const cancelBtn = h('button', { class: 'danger' }, 'Cancel') as HTMLButtonElement;
  cancelBtn.style.display = 'none';
  const exportBtn = h(
    'button',
    { class: 'secondary' },
    'Export failure report',
  ) as HTMLButtonElement;
  exportBtn.disabled = true;

  const paramHost = h('div', {});
  let paramCtl = renderParamForm();
  paramHost.appendChild(paramCtl.element);

  workflowSelect.addEventListener('change', () => {
    const next = findWorkflow(workflowSelect.value);
    if (!next) return;
    state.workflow = next;
    clear(paramHost);
    paramCtl = renderParamForm();
    paramHost.appendChild(paramCtl.element);
    persist();
  });

  const sidebar = h(
    'aside',
    { class: 'sidebar' },
    h('h1', {}, 'Relit'),
    h('h2', {}, 'ComfyUI'),
    h('label', { for: 'comfy-url' }, 'Base URL'),
    comfyUrlInput,
    h('h2', {}, 'Folders'),
    inputDirBtn,
    inputDirLabel,
    outputDirBtn,
    outputDirLabel,
    h('h2', {}, 'Workflow'),
    workflowSelect,
    h('h2', {}, 'Output'),
    h('label', {}, 'Filename suffix'),
    suffixInput,
    h('label', { style: 'margin-top:8px' }, 'On collision'),
    collisionSelect,
    h('h2', {}, 'Parameters'),
    paramHost,
    h('div', { class: 'row', style: 'margin-top:16px;gap:8px' }, runBtn, cancelBtn),
    h('div', { class: 'row', style: 'margin-top:8px' }, exportBtn),
  );

  // ---- main ----
  const itemsTbody = h('tbody', {});
  const itemsTable = h(
    'table',
    { class: 'items' },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', {}, ''),
        h('th', {}, 'Input'),
        h('th', {}, 'Progress'),
        h('th', {}, 'Output'),
        h('th', {}, ''),
      ),
    ),
    itemsTbody,
  );
  const summaryEl = h('div', { class: 'summary', style: 'display:none' });
  const main = h(
    'main',
    { class: 'main' },
    h('div', { class: 'status' }, 'Pick an input folder, an output folder, then Run.'),
    itemsTable,
    summaryEl,
  );

  root.appendChild(sidebar);
  root.appendChild(main);

  // ---- handlers ----
  inputDirBtn.addEventListener('click', async () => {
    const handle = await pickDirectory('read');
    if (!handle) return;
    state.inputDir = handle;
    inputDirLabel.textContent = handle.name;
    void refreshInputs();
  });

  outputDirBtn.addEventListener('click', async () => {
    const handle = await pickDirectory('readwrite');
    if (!handle) return;
    state.outputDir = handle;
    outputDirLabel.textContent = handle.name;
  });

  runBtn.addEventListener('click', () => {
    void run();
  });

  cancelBtn.addEventListener('click', () => {
    state.abort?.abort();
  });

  exportBtn.addEventListener('click', () => {
    if (!state.lastSummary) return;
    exportFailureReport(state.lastSummary);
  });

  function renderParamForm() {
    const initial = paramsForCurrent();
    return paramForm(state.workflow, initial, (next) => {
      stored.current = next;
      persist();
    });
  }

  function paramsForCurrent(): Params {
    const stored2 = settings.params?.[state.workflow.id];
    const defaults = defaultParams(state.workflow);
    if (!stored2) return defaults;
    return { ...defaults, ...(stored2 as Params) };
  }

  function persist(): void {
    const all = { ...(settings.params ?? {}), [state.workflow.id]: paramCtl.values() };
    saveSettings({
      comfyUrl: state.comfyUrl,
      workflowId: state.workflow.id,
      suffix: state.suffix,
      collision: state.collision,
      params: all as Record<string, Record<string, string | number | boolean>>,
    });
  }

  async function refreshInputs(): Promise<void> {
    rows.clear();
    clear(itemsTbody);
    if (!state.inputDir) return;
    const fs = createFsaFs({ inputDir: state.inputDir, outputDir: state.inputDir });
    const list = await fs.listInputs();
    if (!list.ok) return;
    for (const e of list.value) {
      const tr = makeRow(e.name);
      itemsTbody.appendChild(tr.tr);
      rows.set(e.name, tr);
    }
  }

  async function run(): Promise<void> {
    if (state.running) return;
    if (!state.inputDir || !state.outputDir) {
      alert('Pick both folders first.');
      return;
    }
    summaryEl.style.display = 'none';
    state.running = true;
    runBtn.disabled = true;
    cancelBtn.style.display = '';
    exportBtn.disabled = true;

    const fs = createFsaFs({ inputDir: state.inputDir, outputDir: state.outputDir });
    const list = await fs.listInputs();
    if (!list.ok) {
      state.running = false;
      runBtn.disabled = false;
      cancelBtn.style.display = 'none';
      alert(`Failed to list inputs: ${list.error.kind}`);
      return;
    }

    rows.clear();
    clear(itemsTbody);
    for (const e of list.value) {
      const tr = makeRow(e.name);
      itemsTbody.appendChild(tr.tr);
      rows.set(e.name, tr);
    }

    const comfy = new ComfyClient({ baseUrl: state.comfyUrl });
    const stats = await comfy.systemStats();
    if (!stats.ok) {
      alert(`Cannot reach ComfyUI at ${state.comfyUrl}.`);
      state.running = false;
      runBtn.disabled = false;
      cancelBtn.style.display = 'none';
      return;
    }

    const ws = new ComfyWsClient({ url: comfy.wsUrl() });
    ws.connect();
    const runner = new BatchRunner({ comfy, fs, ws });
    state.abort = new AbortController();

    runner.on((e: BatchEvent) => handleEvent(e, comfy));

    const summary = await runner.run({
      definition: state.workflow,
      params: paramCtl.values(),
      inputs: list.value.map((x) => x.name),
      outputSuffix: state.suffix,
      collision: state.collision,
      ...(state.abort ? { signal: state.abort.signal } : {}),
    });

    ws.close();
    state.lastSummary = summary;
    state.abort = undefined;
    state.running = false;
    runBtn.disabled = false;
    cancelBtn.style.display = 'none';
    exportBtn.disabled = summary.failures.length === 0;

    summaryEl.style.display = '';
    clear(summaryEl);
    summaryEl.appendChild(
      h(
        'div',
        {},
        `Done in ${(summary.elapsedMs / 1000).toFixed(1)}s — `,
        h('span', { style: 'color:var(--good)' }, `${summary.succeeded} ok`),
        ', ',
        h('span', { style: 'color:var(--warn)' }, `${summary.skipped} skipped`),
        ', ',
        h('span', { style: 'color:var(--bad)' }, `${summary.failed} failed`),
      ),
    );
  }

  function handleEvent(e: BatchEvent, comfy: ComfyClient): void {
    if (e.type === 'item_started') {
      const r = rows.get(e.item.input);
      if (!r) return;
      r.stateCell.textContent = '⋯';
      r.noteCell.textContent = e.promptId.slice(0, 8);
    } else if (e.type === 'item_progress') {
      const r = rows.get(e.item.input);
      if (!r) return;
      const pct = e.max > 0 ? (e.value / e.max) * 100 : 0;
      r.progressBar.style.width = `${pct}%`;
    } else if (e.type === 'item_completed') {
      const r = rows.get(e.item.input);
      if (!r) return;
      r.stateCell.textContent = '✓';
      r.stateCell.style.color = 'var(--good)';
      r.progressBar.style.width = '100%';
      r.noteCell.textContent = e.outputName;
      const img = h('img', {
        src: comfy.viewUrl(e.source),
        alt: e.outputName,
      });
      clear(r.thumbCell);
      r.thumbCell.appendChild(img);
    } else if (e.type === 'item_skipped') {
      const r = rows.get(e.item.input);
      if (!r) return;
      r.stateCell.textContent = '↷';
      r.stateCell.style.color = 'var(--warn)';
      r.noteCell.textContent = 'skipped (already exists)';
    } else if (e.type === 'item_failed') {
      const r = rows.get(e.item.input);
      if (!r) return;
      r.stateCell.textContent = '✗';
      r.stateCell.style.color = 'var(--bad)';
      r.noteCell.textContent = formatFailure(e.reason);
    }
  }

  function makeRow(name: string): ItemRow {
    const stateCell = h('td', { class: 'state' }, '·') as HTMLTableCellElement;
    const progressBar = h('span', {});
    const progressCell = h(
      'td',
      { class: 'progress' },
      h('div', { class: 'bar' }, progressBar),
    ) as HTMLTableCellElement;
    const noteCell = h('td', {}, '') as HTMLTableCellElement;
    const thumbCell = h('td', { class: 'thumb' }) as HTMLTableCellElement;
    const tr = h('tr', {}, stateCell, h('td', {}, name), progressCell, noteCell, thumbCell);
    return { tr, stateCell, progressBar, noteCell, thumbCell };
  }
};

const pickDirectory = async (
  mode: 'read' | 'readwrite',
): Promise<FileSystemDirectoryHandle | undefined> => {
  type Picker = (opts: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  const w = window as unknown as { showDirectoryPicker?: Picker };
  if (!w.showDirectoryPicker) {
    alert('Your browser does not support the File System Access API. Use Chrome / Edge.');
    return undefined;
  }
  try {
    return await w.showDirectoryPicker({ mode });
  } catch {
    return undefined;
  }
};

const exportFailureReport = (summary: BatchSummary): void => {
  const lines = [
    `# Relit failure report`,
    `Correlation: ${summary.correlationId}`,
    `Total: ${summary.total}, ok: ${summary.succeeded}, skipped: ${summary.skipped}, failed: ${summary.failed}`,
    `Elapsed: ${(summary.elapsedMs / 1000).toFixed(1)}s`,
    ``,
    ...summary.failures.map((f) => `## ${f.item.input}\n${formatFailure(f.reason)}\n`),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `relit-failures-${summary.correlationId}.md`;
  a.click();
  URL.revokeObjectURL(url);
};
