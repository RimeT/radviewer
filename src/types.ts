export type Dims = [number, number, number];
export type Vec3 = [number, number, number];
export type Axis = 0 | 1 | 2;
export type Modality = 'CT' | 'MR' | 'OT';

/** Scalar volume in voxel order x + y * dx + z * dx * dy. Values are display units. */
export interface ScalarVolume {
  name: string;
  dims: Dims;
  spacing: Vec3;
  /** Unit direction of +i, +j, +k in LPS (x = patient left, y = posterior, z = superior). */
  axisLps: [Vec3, Vec3, Vec3];
  values: Int16Array | Float32Array;
  modality: Modality;
  windowCenter: number;
  windowWidth: number;
}

export interface LabelVolume {
  data: Uint8Array;
  classes: number[];
}

export interface ClassMesh {
  classId: number;
  positions: Float32Array;
  normals: Float32Array;
}

export interface DvrVolume {
  dims: Dims;
  spacing: Vec3;
  values: Float32Array;
}

export interface PreparedStudy {
  volume: ScalarVolume;
  labels: LabelVolume | null;
  meshes: ClassMesh[];
  dvr: DvrVolume;
}

export interface StudySource {
  id: string;
  title: string;
  kind: 'nifti' | 'nrrd' | 'dicom';
  imagePaths: string[];
  maskPath?: string;
}

export interface DirEntry {
  name: string;
  type: 'file' | 'directory' | 'other';
}

export interface PlaneMap {
  id: 'axial' | 'sagittal' | 'coronal';
  fixedAxis: Axis;
  uAxis: Axis;
  vAxis: Axis;
  uSign: 1 | -1;
  vSign: 1 | -1;
  left: string;
  right: string;
  top: string;
  bottom: string;
}
