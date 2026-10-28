import { useEffect, useMemo, useRef, useState } from 'react';
import { classCss } from './palette.ts';
import { planesFromAxes } from './planes.ts';
import { createVolumeWorker } from './createWorker.ts';
import { runWorker } from './runWorker.ts';
import { MedStage, type CellRect, type ViewId, type ViewState } from './stage.ts';
import { nrrdDataFiles, nrrdFileBytes } from './nrrd.ts';
import { joinPath, parentPath, pairSiblingMasks, studiesFromListing, studyForPath, baseName, type DirEntry } from './study.ts';
import { sampleValue } from './slice.ts';
import type { PreparedStudy, StudySource } from './types.ts';
import { CT_PRESETS } from './window.ts';

export interface RemoteList {
  entries: readonly { name: string; type: 'file' | 'directory' | 'other' }[];
  path: string;
}
export interface RemoteBytes { data: Uint8Array }
export interface RemoteResult<T> {
  ok: boolean;
  value?: T;
  error?: { message?: string; code?: string };
}

export interface ViewerProps {
  t?: (key: string, params?: Record<string, string | number>) => string;
  useTabInfo?: () => {
    tab: {
      visible: boolean;
      signal: AbortSignal;
      navigation: { address: string; revision: number };
    };
  };
  listDir?: (path: string, signal: AbortSignal) => Promise<RemoteResult<RemoteList>>;
  readBytes?: (path: string, signal: AbortSignal) => Promise<RemoteResult<RemoteBytes>>;
  discover?: (signal: AbortSignal) => Promise<StudySource[]>;
  readFile?: (path: string, signal: AbortSignal) => Promise<ArrayBuffer>;
  initialPath?: string;
  openRequest?: OpenRequest | null;
}

export interface OpenRequest {
  id: number;
  path: string;
}

const VIEWS: readonly ViewId[] = ['axial', 'sagittal', 'coronal', 'volume'];

function textOf(error: RemoteResult<unknown>['error']): string {
  return error?.message || error?.code || 'Request failed';
}

async function mapLimit<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<ArrayBuffer>, signal: AbortSignal): Promise<ArrayBuffer[]> {
  const results = new Array<ArrayBuffer>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export function Viewer(props: ViewerProps) {
  if (props.useTabInfo) return <TabViewer {...props} useTabInfo={props.useTabInfo} />;
  return <Studio {...props} />;
}

function TabViewer(props: ViewerProps & { useTabInfo: NonNullable<ViewerProps['useTabInfo']> }) {
  const info = props.useTabInfo();
  return (
    <Studio
      {...props}
      address={info.tab.navigation.address}
      revision={info.tab.navigation.revision}
      lifetime={info.tab.signal}
      visible={info.tab.visible}
    />
  );
}

function Studio(props: ViewerProps & { address?: string; revision?: number; lifetime?: AbortSignal; visible?: boolean }) {
  const t = props.t ?? ((key: string) => key);
  const [folder, setFolder] = useState(props.initialPath ?? '');
  const [studies, setStudies] = useState<StudySource[]>([]);
  const [prepared, setPrepared] = useState<PreparedStudy | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewState>({ cursor: [0, 0, 0], center: 0, width: 1 });
  const [opacity, setOpacity] = useState(0.45);
  const [hidden, setHidden] = useState<Set<number>>(() => new Set());
  const [scanning, setScanning] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<MedStage | null>(null);
  const cells = useRef(new Map<ViewId, HTMLDivElement>());
  const workerRef = useRef<Worker | null>(null);
  const drag = useRef<{ id: ViewId; x: number; y: number; button: number; moved: boolean } | null>(null);
  const loadAbort = useRef<AbortController | null>(null);
  const handledOpen = useRef<number | null>(null);
  const planes = useMemo(() => (prepared ? planesFromAxes(prepared.volume.axisLps) : []), [prepared]);
  const fileMode = (props.address ?? '').startsWith('dsh-resource://file/');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let stage: MedStage;
    try {
      stage = new MedStage(canvas);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return undefined;
    }
    stageRef.current = stage;
    stage.onChange = setView;
    const parent = canvas.parentElement;
    const observer = new ResizeObserver(() => measure());
    if (parent) observer.observe(parent);
    observer.observe(canvas);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      stage.dispose();
      stageRef.current = null;
    };
  }, []);

  useEffect(() => () => workerRef.current?.terminate(), []);

  useEffect(() => {
    if (!prepared) return undefined;
    const stage = stageRef.current;
    if (!stage) return undefined;
    stage.setStudy(prepared);
    stage.setMask(opacity, hidden);
    const volume = cells.current.get('volume');
    if (volume) stage.bindOrbit(volume);
    const frame = requestAnimationFrame(() => measure());
    return () => cancelAnimationFrame(frame);
  }, [prepared]);

  useEffect(() => {
    stageRef.current?.setMask(opacity, hidden);
  }, [opacity, hidden]);

  useEffect(() => {
    const nodes = [...cells.current.entries()];
    const stops = nodes.map(([id, element]) => {
      const onWheel = (event: WheelEvent) => {
        if (id === 'volume') return;
        event.preventDefault();
        stageRef.current?.step(id, event.deltaY > 0 ? 1 : -1);
      };
      element.addEventListener('wheel', onWheel, { passive: false });
      return () => element.removeEventListener('wheel', onWheel);
    });
    return () => stops.forEach((stop) => stop());
  }, [prepared]);

  useEffect(() => {
    if (fileMode) {
      const parsed = parseSessionFile(props.address ?? '');
      if (!parsed || !props.listDir || !props.readBytes) return undefined;
      const controller = new AbortController();
      const signal = anySignal([controller.signal, props.lifetime]);
      void loadPath(parsed.path, signal).catch((cause: unknown) => {
        if (!isAbort(cause)) setError(cause instanceof Error ? cause.message : String(cause));
      });
      return () => controller.abort();
    }
    return undefined;
  }, [fileMode, props.address, props.revision]);

  useEffect(() => {
    const request = props.openRequest;
    if (!request || handledOpen.current === request.id) return undefined;
    handledOpen.current = request.id;
    const path = request.path.replace(/\\/g, '/').replace(/\/+$/, '');
    const name = path.slice(path.lastIndexOf('/') + 1);
    const isFile = /\.(?:nii(?:\.gz)?|nrrd(?:\.gz)?|nhdr|dcm)$/i.test(name);
    const controller = new AbortController();
    if (!isFile) {
      setPrepared(null);
      setFolder(path);
      return () => {
        controller.abort();
        handledOpen.current = null;
      };
    }
    setFolder(parentPath(path));
    const signal = anySignal([controller.signal, props.lifetime]);
    void loadPath(path, signal).catch((cause: unknown) => {
      if (!isAbort(cause)) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      controller.abort();
      handledOpen.current = null;
    };
  }, [props.openRequest]);

  function measure() {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const bounds = canvas.getBoundingClientRect();
    const next: CellRect[] = [];
    for (const id of VIEWS) {
      const element = cells.current.get(id);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      next.push({ id, x: rect.left - bounds.left, y: rect.top - bounds.top, w: rect.width, h: rect.height });
    }
    stage.setCells(next);
  }

  async function readBuffer(path: string, signal: AbortSignal): Promise<ArrayBuffer> {
    if (props.readFile) return props.readFile(path, signal);
    if (!props.readBytes) throw new Error('No file reader');
    const result = await props.readBytes(path, signal);
    if (!result.ok || !result.value) throw new Error(textOf(result.error));
    const data = result.value.data;
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    return copy.buffer;
  }

  async function readNrrd(path: string, signal: AbortSignal): Promise<{ image: ArrayBuffer; parts: ArrayBuffer[] }> {
    const header = await nrrdFileBytes(new Uint8Array(await readBuffer(path, signal)));
    const dir = parentPath(path);
    const parts: ArrayBuffer[] = [];
    for (const file of nrrdDataFiles(header)) {
      const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '');
      const resolved = /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//') || normalized.startsWith('/')
        ? normalized.replace(/^\/(?![/])/, '')
        : joinPath(dir, normalized);
      parts.push(await readBuffer(resolved, signal));
    }
    return { image: header.buffer.slice(header.byteOffset, header.byteOffset + header.byteLength), parts };
  }

  async function scan(signal: AbortSignal) {
    setScanning(true);
    setError(null);
    try {
      if (props.discover) {
        setStudies(await props.discover(signal));
        return;
      }
      if (!props.listDir) return;
      const root = await props.listDir(folder, signal);
      if (!root.ok || !root.value) throw new Error(textOf(root.error));
      const found = studiesFromListing(root.value.path || folder, root.value.entries as DirEntry[]);
      for (const entry of root.value.entries) {
        if (entry.type !== 'directory') continue;
        if (signal.aborted) return;
        const child = joinPath(folder, entry.name);
        const listing = await props.listDir(child, signal);
        if (!listing.ok || !listing.value) continue;
        found.push(...studiesFromListing(listing.value.path || child, listing.value.entries as DirEntry[]));
      }
      setStudies(pairSiblingMasks(found));
    } catch (cause) {
      if (!isAbort(cause)) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setScanning(false);
    }
  }

  async function loadPath(path: string, signal: AbortSignal) {
    if (!props.listDir) return;
    const dir = parentPath(path);
    const listing = await props.listDir(dir, signal);
    if (!listing.ok || !listing.value) throw new Error(textOf(listing.error));
    const study = studyForPath(dir, listing.value.entries as DirEntry[], path);
    if (!study) throw new Error(path);
    const normalizedDir = dir.replace(/\\/g, '/');
    if (!study.maskPath && /\/data$/i.test(normalizedDir)) {
      const maskDir = normalizedDir.replace(/\/data$/i, '/mask');
      const maskList = await props.listDir(maskDir, signal);
      const name = baseName(path);
      const entries = maskList.ok ? maskList.value?.entries ?? [] : [];
      if (entries.some((entry) => entry.type === 'file' && entry.name === name)) {
        study.maskPath = joinPath(maskList.value?.path || maskDir, name);
      }
    }
    await openStudy(study, signal);
  }

  async function openStudy(study: StudySource, signal?: AbortSignal) {
    loadAbort.current?.abort();
    const controller = new AbortController();
    loadAbort.current = controller;
    const lifetime = anySignal([controller.signal, signal, props.lifetime]);
    setLoading(true);
    setProgress(0.04);
    setError(null);
    try {
      const images = study.kind === 'nrrd'
        ? []
        : await mapLimit(study.imagePaths, 6, (path) => readBuffer(path, lifetime), lifetime);
      const nrrdImage = study.kind === 'nrrd' ? await readNrrd(study.imagePaths[0]!, lifetime) : undefined;
      const nrrdMask = study.kind === 'nrrd' && study.maskPath ? await readNrrd(study.maskPath, lifetime) : undefined;
      setProgress(0.35);
      const mask = study.kind === 'nrrd' ? nrrdMask?.image : study.maskPath ? await readBuffer(study.maskPath, lifetime) : undefined;
      const worker = workerRef.current ?? createVolumeWorker();
      workerRef.current = worker;
      const next = await runWorker(worker, {
        op: study.kind,
        name: study.title,
        image: study.kind === 'dicom' ? undefined : nrrdImage?.image ?? images[0],
        mask,
        slices: study.kind === 'dicom' ? images : undefined,
        imageParts: nrrdImage?.parts,
        maskParts: nrrdMask?.parts,
      }, lifetime, setProgress);
      if (lifetime.aborted) return;
      setHidden(new Set());
      setOpacity(0.45);
      setPrepared(next);
    } catch (cause) {
      if (!isAbort(cause)) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!lifetime.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    if (fileMode) return undefined;
    if (!folder.trim()) {
      setStudies([]);
      return undefined;
    }
    const controller = new AbortController();
    void scan(anySignal([controller.signal, props.lifetime]));
    return () => controller.abort();
  }, [folder, fileMode]);

  const native = prepared ? { center: prepared.volume.windowCenter, width: prepared.volume.windowWidth } : null;
  const volumeCell = (
    <div className="mv-stage">
      <canvas ref={canvasRef} className="mv-canvas" />
      {prepared && (
        <div className="mv-grid">
          {VIEWS.map((id) => {
            const plane = planes.find((item) => item.id === id);
            const axis = plane?.fixedAxis ?? 2;
            const count = prepared.volume.dims[axis];
            return (
              <div
                key={id}
                className="mv-cell"
                data-view={id}
                role="application"
                tabIndex={0}
                aria-label={`${t(`views.${id}`)} pane`}
                ref={(node) => {
                  if (node) cells.current.set(id, node);
                  else cells.current.delete(id);
                }}
                onPointerDown={(event) => {
                  if (id === 'volume') return;
                  if (event.button === 1) event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  drag.current = { id, x: event.clientX, y: event.clientY, button: event.button, moved: false };
                }}
                onPointerMove={(event) => {
                  const active = drag.current;
                  if (!active || active.id !== id) return;
                  const dx = event.clientX - active.x;
                  const dy = event.clientY - active.y;
                  if (Math.hypot(dx, dy) > 3) active.moved = true;
                  if (active.button === 0 && active.moved) stageRef.current?.windowBy(dx, dy);
                  if (active.button === 1) stageRef.current?.pan(id, dx, dy);
                  if (active.button === 2) stageRef.current?.zoom(id, dy);
                  active.x = event.clientX;
                  active.y = event.clientY;
                }}
                onPointerUp={(event) => {
                  const active = drag.current;
                  if (active && !active.moved && active.button === 0) {
                    const rect = event.currentTarget.getBoundingClientRect();
                    stageRef.current?.pick(id, event.clientX - rect.left, event.clientY - rect.top);
                  }
                  drag.current = null;
                }}
                onContextMenu={(event) => event.preventDefault()}
              >
                <div className="mv-hud">
                  <div className="mv-tag">{t(`views.${id}`)}</div>
                  {plane && (
                    <>
                      <div className="mv-corner" data-edge="left">{plane.left}</div>
                      <div className="mv-corner" data-edge="right">{plane.right}</div>
                      <div className="mv-corner" data-edge="top">{plane.top}</div>
                      <div className="mv-corner" data-edge="bottom">{plane.bottom}</div>
                      <div className="mv-meta">{t('slice', { index: view.cursor[axis] + 1, count })}</div>
                      <input
                        className="mv-slider"
                        type="range"
                        min={0}
                        max={Math.max(0, count - 1)}
                        value={Math.min(count - 1, view.cursor[axis])}
                        aria-label={t(`views.${id}`)}
                        onPointerDown={(event) => event.stopPropagation()}
                        onChange={(event) => stageRef.current?.jump(id, Number(event.target.value))}
                      />
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {loading && (
        <div className="mv-veil">
          <div className="mv-panel">
            <strong>{t('loading')}</strong>
            <div className="mv-track"><span style={{ width: `${Math.round(progress * 100)}%`, animation: 'none' }} /></div>
          </div>
        </div>
      )}
      {error && (
        <div className="mv-veil">
          <div className="mv-panel">
            <strong>{t('error.title')}</strong>
            <div className="mv-error">{error}</div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="mv-root">
      <div className="mv-bar">
        <div className="mv-title">{prepared?.volume.name || t('tab.title')}</div>
        {prepared && native && (
          <>
            {prepared.volume.modality === 'CT' && (Object.keys(CT_PRESETS) as (keyof typeof CT_PRESETS)[]).map((preset) => (
              <button key={preset} type="button" className="mv-btn" onClick={() => stageRef.current?.setWindow(CT_PRESETS[preset].center, CT_PRESETS[preset].width)}>
                {t(`preset.${preset}`)}
              </button>
            ))}
            <button type="button" className="mv-btn" onClick={() => stageRef.current?.setWindow(native.center, native.width)}>{t('preset.native')}</button>
            <span className="mv-readout">{t('window', { width: Math.round(view.width), center: Math.round(view.center) })}</span>
            <span className="mv-readout">{t('value', { value: Math.round(sampleValue(prepared.volume, view.cursor[0], view.cursor[1], view.cursor[2])) })}</span>
          </>
        )}
        <span className="mv-spacer" />
        {prepared?.labels && (
          <>
            <span>{t('opacity')}</span>
            <input className="mv-opacity" type="range" min={0} max={1} step={0.01} value={opacity} aria-label={t('opacity')} onChange={(event) => setOpacity(Number(event.target.value))} />
            {prepared.labels.classes.map((classId) => (
              <button
                key={classId}
                type="button"
                className="mv-chip"
                data-on={hidden.has(classId) ? 'false' : 'true'}
                onClick={() => {
                  const next = new Set(hidden);
                  if (next.has(classId)) next.delete(classId);
                  else next.add(classId);
                  setHidden(next);
                }}
              >
                <i className="mv-swatch" style={{ background: classCss(classId), color: classCss(classId) }} />
                {t('class', { id: classId })}
              </button>
            ))}
          </>
        )}
        {prepared && <button type="button" className="mv-btn" onClick={() => stageRef.current?.reset()}>{t('reset')}</button>}
        {prepared && !fileMode && <button type="button" className="mv-btn" onClick={() => setPrepared(null)}>{t('library.title')}</button>}
      </div>
      {volumeCell}
      {!prepared && !fileMode && !loading && (
        <div className="mv-library">
          <div className="mv-bar">
            <label>
              {t('library.path')}
              {' '}
              <input className="mv-field mv-path" value={folder} placeholder={t('library.placeholder')} onChange={(event) => setFolder(event.target.value)} />
            </label>
            <button type="button" className="mv-btn" onClick={() => void scan(props.lifetime ?? new AbortController().signal)}>{scanning ? '…' : t('library.refresh')}</button>
          </div>
          {error && <div className="mv-error">{error}</div>}
          {!folder.trim() && <div className="mv-empty">{t('library.needPath')}</div>}
          {folder.trim() && studies.length === 0 && !error && !scanning && <div className="mv-empty">{t('library.empty')}</div>}
          <div className="mv-cards">
            {studies.map((study) => (
              <button key={study.id} type="button" className="mv-card" onClick={() => void openStudy(study)}>
                <strong>{study.title}</strong>
                <span>{t('library.slices', { count: study.imagePaths.length })}</span>
                {study.maskPath && <span>{t('library.mask')}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function parseSessionFile(address: string): { sessionId: string; path: string } | undefined {
  const prefix = 'dsh-resource://file/session/';
  if (!address.startsWith(prefix)) return undefined;
  const rest = address.slice(prefix.length).split(/[?#]/)[0] ?? '';
  const slash = rest.indexOf('/');
  if (slash < 0) return undefined;
  return {
    sessionId: decodeURIComponent(rest.slice(0, slash)),
    path: rest.slice(slash + 1).split('/').map((part) => decodeURIComponent(part)).join('/'),
  };
}

function anySignal(signals: (AbortSignal | undefined)[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
