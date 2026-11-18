import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { access, type AccessStatus } from '../access/controller';

/** The part of the address after "#", which is how this app moves between screens. */
function currentPath(): string {
  return window.location.hash.replace(/^#/, '') || '/';
}

function subscribeToHash(callback: () => void): () => void {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}

export function useRoute(): string {
  return useSyncExternalStore(subscribeToHash, currentPath, () => '/');
}

export function go(path: string): void {
  if (currentPath() !== path) window.location.hash = path;
}

/** The size of an element, kept up to date. */
export function useElementSize<T extends HTMLElement>(): [(node: T | null) => void, { width: number; height: number }] {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    if (!node) return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      setSize((previous) => (Math.abs(previous.width - rect.width) < 0.5 && Math.abs(previous.height - rect.height) < 0.5 ? previous : { width: rect.width, height: rect.height }));
    };
    update();
    observer.current = new ResizeObserver(update);
    observer.current.observe(node);
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return [ref, size];
}

function subscribeToResize(callback: () => void): () => void {
  window.addEventListener('resize', callback);
  window.addEventListener('orientationchange', callback);
  return () => {
    window.removeEventListener('resize', callback);
    window.removeEventListener('orientationchange', callback);
  };
}

let lastViewport = { width: 0, height: 0 };
function viewportSnapshot(): { width: number; height: number } {
  if (lastViewport.width !== window.innerWidth || lastViewport.height !== window.innerHeight) {
    lastViewport = { width: window.innerWidth, height: window.innerHeight };
  }
  return lastViewport;
}

export function useViewport(): { width: number; height: number } {
  return useSyncExternalStore(subscribeToResize, viewportSnapshot, () => ({ width: 390, height: 780 }));
}

export function useAccessStatus(): AccessStatus {
  const [status, setStatus] = useState<AccessStatus>(() => access.status());
  useEffect(() => access.subscribe(setStatus), []);
  return status;
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (callback: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', callback);
      return () => media.removeEventListener('change', callback);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}
