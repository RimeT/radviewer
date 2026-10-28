import type { PreparedStudy } from './types.ts';
import { fromWire, type StudyWire } from './wire.ts';

interface DoneMessage {
  id: number;
  op: 'done';
  wire: StudyWire;
}
interface ProgressMessage {
  id: number;
  op: 'progress';
  ratio: number;
}
interface ErrorMessage {
  id: number;
  op: 'error';
  message: string;
}

type WorkerMessage = DoneMessage | ProgressMessage | ErrorMessage;

let nextId = 1;

export function runWorker(
  worker: Worker,
  request: { op: 'nifti' | 'nrrd' | 'dicom'; name: string; image?: ArrayBuffer; mask?: ArrayBuffer; slices?: ArrayBuffer[]; imageParts?: ArrayBuffer[]; maskParts?: ArrayBuffer[] },
  signal: AbortSignal,
  onProgress: (ratio: number) => void,
): Promise<PreparedStudy> {
  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    const finish = (error?: Error, study?: PreparedStudy) => {
      worker.removeEventListener('message', onMessage);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(study!);
    };
    const onAbort = () => finish(new DOMException('Aborted', 'AbortError'));
    const onMessage = (event: MessageEvent<WorkerMessage>) => {
      if (event.data.id !== id) return;
      if (event.data.op === 'progress') onProgress(event.data.ratio);
      else if (event.data.op === 'error') finish(new Error(event.data.message));
      else finish(undefined, fromWire(event.data.wire));
    };
    worker.addEventListener('message', onMessage);
    signal.addEventListener('abort', onAbort);
    if (signal.aborted) {
      onAbort();
      return;
    }
    const transfers = [request.image, request.mask, ...(request.slices ?? []), ...(request.imageParts ?? []), ...(request.maskParts ?? [])].filter((item): item is ArrayBuffer => item !== undefined);
    worker.postMessage({ id, ...request }, transfers);
  });
}
