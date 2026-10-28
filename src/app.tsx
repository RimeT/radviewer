import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { messages, translate } from './messages.ts';
import { Viewer, type OpenRequest, type RemoteBytes, type RemoteList, type RemoteResult } from './Viewer.tsx';
import './styles.css';
import './theme.css';

function language(): 'zh' | 'en' {
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

async function listDir(path: string, signal: AbortSignal): Promise<RemoteResult<RemoteList>> {
  const response = await fetch(`/api/list?path=${encodeURIComponent(path)}`, { signal });
  return response.json() as Promise<RemoteResult<RemoteList>>;
}

async function readBytes(path: string, signal: AbortSignal): Promise<RemoteResult<RemoteBytes>> {
  const response = await fetch(`/api/file?path=${encodeURIComponent(path)}`, { signal });
  if (!response.ok) {
    let message = `${response.status}`;
    try {
      const body = await response.json() as { error?: { message?: string } };
      message = body.error?.message || message;
    } catch {
      /* a failed file response may not be JSON */
    }
    return { ok: false, error: { message } };
  }
  return { ok: true, value: { data: new Uint8Array(await response.arrayBuffer()) } };
}

function App() {
  const dict = messages[language()];
  const t = useMemo(() => (key: string, params?: Record<string, string | number>) => translate(dict, key, params), [dict]);
  const [openRequest, setOpenRequest] = useState<OpenRequest | null>(() => {
    const initial = new URLSearchParams(window.location.search).get('path');
    return initial ? { id: 0, path: initial } : null;
  });

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      root.dataset.theme = media.matches ? 'light' : 'dark';
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.onmessage = (event) => {
      const data = JSON.parse(event.data) as { type?: string; id?: number; path?: string };
      if (data.type === 'open' && data.path && typeof data.id === 'number') {
        setOpenRequest({ id: data.id, path: data.path });
      }
    };
    return () => source.close();
  }, []);

  return (
    <Viewer
      t={t}
      listDir={listDir}
      readBytes={readBytes}
      openRequest={openRequest}
      initialPath=""
    />
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
