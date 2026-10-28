import type { Dims, DvrVolume, Modality, PreparedStudy, ScalarVolume, Vec3 } from './types.ts';

export interface StudyWire {
  name: string;
  dims: Dims;
  spacing: Vec3;
  axisLps: number[];
  valueKind: 'i16' | 'f32';
  values: ArrayBuffer;
  modality: Modality;
  windowCenter: number;
  windowWidth: number;
  labels: ArrayBuffer | null;
  classes: number[];
  meshes: { classId: number; positions: ArrayBuffer; normals: ArrayBuffer }[];
  dvrDims: Dims;
  dvrSpacing: Vec3;
  dvrValues: ArrayBuffer;
}

function owned(view: ArrayBufferView): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength);
  copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  return copy.buffer;
}

export function toWire(study: PreparedStudy): { wire: StudyWire; transfers: ArrayBuffer[] } {
  const values = owned(study.volume.values);
  const labels = study.labels ? owned(study.labels.data) : null;
  const dvrValues = owned(study.dvr.values);
  const meshes = study.meshes.map((mesh) => ({
    classId: mesh.classId,
    positions: owned(mesh.positions),
    normals: owned(mesh.normals),
  }));
  const transfers = [values, dvrValues, ...meshes.flatMap((mesh) => [mesh.positions, mesh.normals])];
  if (labels) transfers.push(labels);
  const wire: StudyWire = {
    name: study.volume.name,
    dims: study.volume.dims,
    spacing: study.volume.spacing,
    axisLps: study.volume.axisLps.flat(),
    valueKind: study.volume.values instanceof Int16Array ? 'i16' : 'f32',
    values,
    modality: study.volume.modality,
    windowCenter: study.volume.windowCenter,
    windowWidth: study.volume.windowWidth,
    labels,
    classes: study.labels?.classes ?? [],
    meshes,
    dvrDims: study.dvr.dims,
    dvrSpacing: study.dvr.spacing,
    dvrValues,
  };
  return { wire, transfers };
}

export function fromWire(wire: StudyWire): PreparedStudy {
  const values = wire.valueKind === 'i16' ? new Int16Array(wire.values) : new Float32Array(wire.values);
  const axis = wire.axisLps;
  const volume: ScalarVolume = {
    name: wire.name,
    dims: wire.dims,
    spacing: wire.spacing,
    axisLps: [
      [axis[0] ?? 1, axis[1] ?? 0, axis[2] ?? 0],
      [axis[3] ?? 0, axis[4] ?? 1, axis[5] ?? 0],
      [axis[6] ?? 0, axis[7] ?? 0, axis[8] ?? 1],
    ],
    values,
    modality: wire.modality,
    windowCenter: wire.windowCenter,
    windowWidth: wire.windowWidth,
  };
  const dvr: DvrVolume = {
    dims: wire.dvrDims,
    spacing: wire.dvrSpacing,
    values: new Float32Array(wire.dvrValues),
  };
  return {
    volume,
    labels: wire.labels ? { data: new Uint8Array(wire.labels), classes: wire.classes } : null,
    meshes: wire.meshes.map((mesh) => ({
      classId: mesh.classId,
      positions: new Float32Array(mesh.positions),
      normals: new Float32Array(mesh.normals),
    })),
    dvr,
  };
}
