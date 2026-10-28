declare const __MEDVIEW_WORKER_SOURCE__: string;

export function createVolumeWorker(): Worker {
  const source = __MEDVIEW_WORKER_SOURCE__;
  if (!source) throw new Error('MedView worker was not built. Run npm run build:worker.');
  return new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
}
