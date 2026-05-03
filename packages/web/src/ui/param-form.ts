import type { ParamSpec, ParamValue, Params, WorkflowDefinition } from '@relit/core';
import { h } from './dom.js';

export interface ParamFormController {
  readonly element: HTMLElement;
  readonly values: () => Params;
  readonly setValues: (next: Params) => void;
}

export const paramForm = (
  def: WorkflowDefinition,
  initial: Params,
  onChange: (next: Params) => void,
): ParamFormController => {
  const state: Record<string, ParamValue> = { ...initial };
  const inputs: Record<string, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> = {};

  const root = h('div', { class: 'params' });

  for (const [key, spec] of Object.entries(def.params)) {
    const id = `p-${key}`;
    const label = h('label', { for: id }, spec.label ?? key);
    const control = renderControl(id, key, spec, state[key] ?? defaultFor(spec), (next) => {
      state[key] = next;
      onChange({ ...state });
    });
    inputs[key] = control;
    const wrapper = h('div', { class: 'param-row' }, label, control);
    if (
      'description' in spec &&
      typeof (spec as { description?: unknown }).description === 'string'
    ) {
      wrapper.appendChild(
        h('div', { class: 'param-desc' }, (spec as { description: string }).description),
      );
    }
    root.appendChild(wrapper);
  }

  return {
    element: root,
    values: () => ({ ...state }),
    setValues: (next) => {
      for (const [key, value] of Object.entries(next)) {
        state[key] = value;
        const input = inputs[key];
        if (input) {
          if (input instanceof HTMLInputElement && input.type === 'checkbox') {
            input.checked = Boolean(value);
          } else {
            input.value = String(value);
          }
        }
      }
    },
  };
};

const defaultFor = (spec: ParamSpec): ParamValue => {
  if (spec.kind === 'seed') return spec.default;
  return spec.default;
};

const renderControl = (
  id: string,
  _key: string,
  spec: ParamSpec,
  initial: ParamValue,
  onChange: (next: ParamValue) => void,
): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement => {
  switch (spec.kind) {
    case 'string': {
      if (spec.multiline) {
        const ta = h('textarea', { id, rows: 3 }) as HTMLTextAreaElement;
        ta.value = String(initial);
        ta.addEventListener('input', () => onChange(ta.value));
        return ta;
      }
      const input = h('input', { id, type: 'text' }) as HTMLInputElement;
      input.value = String(initial);
      input.addEventListener('input', () => onChange(input.value));
      return input;
    }
    case 'number':
    case 'integer': {
      const input = h('input', {
        id,
        type: 'number',
        ...(spec.min !== undefined ? { min: spec.min } : {}),
        ...(spec.max !== undefined ? { max: spec.max } : {}),
        ...(spec.step !== undefined
          ? { step: spec.step }
          : { step: spec.kind === 'integer' ? 1 : 'any' }),
      }) as HTMLInputElement;
      input.value = String(initial);
      input.addEventListener('input', () => {
        const n =
          spec.kind === 'integer'
            ? Number.parseInt(input.value, 10)
            : Number.parseFloat(input.value);
        if (!Number.isNaN(n)) onChange(n);
      });
      return input;
    }
    case 'seed': {
      const input = h('input', { id, type: 'number', step: 1, min: 0 }) as HTMLInputElement;
      input.value = String(initial);
      input.addEventListener('input', () => {
        const n = Number.parseInt(input.value, 10);
        if (!Number.isNaN(n)) onChange(n);
      });
      return input;
    }
    case 'boolean': {
      const input = h('input', { id, type: 'checkbox' }) as HTMLInputElement;
      input.checked = Boolean(initial);
      input.addEventListener('change', () => onChange(input.checked));
      return input;
    }
    case 'enum': {
      const select = h('select', { id }) as HTMLSelectElement;
      for (const opt of spec.options) {
        const option = h('option', { value: opt }, opt);
        if (opt === String(initial)) option.setAttribute('selected', 'selected');
        select.appendChild(option);
      }
      select.addEventListener('change', () => onChange(select.value));
      return select;
    }
  }
};
