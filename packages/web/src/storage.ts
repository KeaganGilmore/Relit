const STORAGE_KEY = 'relit:settings:v1';

export interface PersistedSettings {
  readonly comfyUrl?: string;
  readonly workflowId?: string;
  readonly suffix?: string;
  readonly collision?: 'skip' | 'overwrite' | 'number';
  readonly params?: Record<string, Record<string, string | number | boolean>>;
}

export const loadSettings = (): PersistedSettings => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as PersistedSettings;
  } catch {
    return {};
  }
};

export const saveSettings = (s: PersistedSettings): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // quota / privacy mode — ignore
  }
};
