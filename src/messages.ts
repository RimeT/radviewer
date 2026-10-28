import en from '../locale/en.json';
import zh from '../locale/zh.json';

export type MessageKey = Exclude<keyof typeof en, 'meta'>;

function catalog(source: typeof en): Record<MessageKey, string> {
  const copy = { ...source };
  delete (copy as { meta?: unknown }).meta;
  return copy as Record<MessageKey, string>;
}

export const messages = { en: catalog(en), zh: catalog(zh) };

export function translate(dict: Record<string, string>, key: string, params?: Record<string, string | number>): string {
  let text = dict[key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}
