import { installVolumeWorker, type VolumeWorkerScope } from './volume.worker.ts';

installVolumeWorker(self as unknown as VolumeWorkerScope);
