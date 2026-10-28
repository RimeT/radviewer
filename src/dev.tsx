import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { messages, translate } from './messages.ts';
import type { StudySource } from './types.ts';
import { Viewer } from './Viewer.tsx';
import './styles.css';
import './dev.css';

const monoUrls = import.meta.glob('/samples/MonoE_40keV/*.dcm', { query: '?url', import: 'default', eager: true });

function monoStudy(): StudySource {
  const paths = Object.entries(monoUrls as Record<string, string>)
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .map(([, url]) => url);
  return { id: 'monoe', title: 'MonoE 40keV', kind: 'dicom', imagePaths: paths };
}

const catalog: StudySource[] = [
  {
    id: 'cas045',
    title: 'cas045',
    kind: 'nifti',
    imagePaths: ['/samples/cas045/image.nii.gz'],
    maskPath: '/samples/cas045/mask.nii.gz',
  },
  {
    id: 'p001-ed',
    title: 'P001-1 ED',
    kind: 'nifti',
    imagePaths: ['/samples/P001-1/P001-1-ED.nii.gz'],
    maskPath: '/samples/P001-1/P001-1-ED-label.nii.gz',
  },
  {
    id: 'p001-es',
    title: 'P001-1 ES',
    kind: 'nifti',
    imagePaths: ['/samples/P001-1/P001-1-ES.nii.gz'],
    maskPath: '/samples/P001-1/P001-1-ES-label.nii.gz',
  },
  monoStudy(),
];

function DevApp() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [language, setLanguage] = useState<'en' | 'zh'>('zh');
  const dict = messages[language];
  const t = useMemo(() => (key: string, params?: Record<string, string | number>) => translate(dict, key, params), [dict]);
  return (
    <div data-theme={theme} style={{ height: '100%' }}>
      <div className="mv-bar">
        <button type="button" className="mv-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? 'Light' : 'Dark'}</button>
        <button type="button" className="mv-btn" onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}>{language === 'zh' ? 'EN' : '中文'}</button>
      </div>
      <div style={{ height: 'calc(100% - 45px)' }}>
        <Viewer
          t={t}
          discover={async () => catalog}
          readFile={async (path, signal) => {
            const response = await fetch(path, { signal });
            if (!response.ok) throw new Error(`${path} (${response.status})`);
            return response.arrayBuffer();
          }}
        />
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<DevApp />);
