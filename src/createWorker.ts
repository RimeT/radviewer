declare const __MEDVIEW_WORKER_SOURCE__: string;

type InlineScope = {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (data: unknown) => void;
};

function inlineWorker(source: string): Worker {
  const listeners = new Set<(event: MessageEvent) => void>();
  const scope: InlineScope = {
    onmessage: null,
    postMessage(data) {
      const event = { data } as MessageEvent;
      for (const listener of listeners) listener(event);
    },
  };
  const worker = {
    postMessage(data: unknown) {
      scope.onmessage?.({ data } as MessageEvent);
    },
    addEventListener(type: string, listener: EventListener) {
      if (type === 'message') listeners.add(listener as (event: MessageEvent) => void);
    },
    removeEventListener(type: string, listener: EventListener) {
      if (type === 'message') listeners.delete(listener as (event: MessageEvent) => void);
    },
    terminate() {},
  };
  const run = new Function('self', `${source}\n//# sourceURL=radviewer-volume-worker.js`) as (self: InlineScope) => void;
  run(scope);
  return worker as unknown as Worker;
}

export function createVolumeWorker(): Worker {
  const source = __MEDVIEW_WORKER_SOURCE__;
  if (!source) throw new Error('RadViewer worker was not built. Run npm run build:worker.');
  const forced = (globalThis as { __radviewerInlineWorker?: boolean }).__radviewerInlineWorker;
  if (forced) return inlineWorker(source);
  try {
    return new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
  } catch {
    return inlineWorker(source);
  }
}
