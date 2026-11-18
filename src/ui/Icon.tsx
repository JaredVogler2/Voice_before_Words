/** A small set of line icons, drawn inline so nothing is fetched and they follow the text colour. */

const PATHS: Record<string, string> = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10M10 19.5v-5h4v5',
  grid: 'M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z',
  back: 'M15 5l-7 7 7 7',
  forward: 'M9 5l7 7-7 7',
  keyboard: 'M3 6.5h18v11H3zM6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M7.5 14h9',
  menu: 'M4 7h16M4 12h16M4 17h16',
  backspace: 'M21 5.5H9L3 12l6 6.5h12zM12 9.5l5 5M17 9.5l-5 5',
  clear: 'M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7M10.5 10.5v6M13.5 10.5v6',
  undo: 'M8 5 3.5 9.5 8 14M3.5 9.5H14a6 6 0 0 1 0 12h-3',
  speaker: 'M4 9.5v5h3.5L12 18.5v-13L7.5 9.5zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11',
  settings: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM19.4 13.5l1.6 1.2-1.8 3.1-1.9-.7a7.5 7.5 0 0 1-1.6.9l-.3 2h-3.6l-.3-2a7.5 7.5 0 0 1-1.6-.9l-1.9.7-1.8-3.1 1.6-1.2a7.6 7.6 0 0 1 0-1.9L4.2 10.4 6 7.3l1.9.7c.5-.4 1-.7 1.6-.9l.3-2h3.6l.3 2c.6.2 1.1.5 1.6.9l1.9-.7 1.8 3.1-1.6 1.2c.1.6.1 1.3 0 1.9z',
  eye: 'M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  head: 'M12 12.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM4 20.5c1-4 4-6 8-6s7 2 8 6',
  pointer: 'M5 3.5l13 7.5-5.5 1.5L15.5 19l-2.5 1.2-3-6.5-4 3.8z',
  touch: 'M9 11V5.5a1.75 1.75 0 0 1 3.5 0V10l4.6.9a2.5 2.5 0 0 1 2 2.9l-.7 4.2a3 3 0 0 1-3 2.5h-3.6a3 3 0 0 1-2.3-1.1L5.5 14.5a1.6 1.6 0 0 1 2.4-2.1z',
  scan: 'M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3M8 9h8v6H8z',
  check: 'M4.5 12.5l5 5 10-11',
  close: 'M6 6l12 12M18 6 6 18',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 4.5v15l12-7.5z',
  camera: 'M3 8h3.5l1.5-2.5h8L17.5 8H21v11H3zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 1.5V5M12 19v3.5M1.5 12H5M19 12h3.5',
  warning: 'M12 3.5 2.5 20h19zM12 10v4.5M12 17.2v.3',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.6v.4',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  star: 'M12 3.5l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6L3.4 9.8l6-.7z',
  history: 'M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4v4.5H8M12 7.5V12l3 2',
  palette: 'M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-.5-1.5-.5-2.5 1-2 2.5-2h1.5A3.5 3.5 0 0 0 21 11c0-4.4-4-8-9-8zM7.5 12h.01M9.5 8h.01M14 7h.01',
  book: 'M5 4.5h11a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11',
  shield: 'M12 3l8 3v6c0 4.5-3.2 8-8 9.5-4.8-1.5-8-5-8-9.5V6zM8.5 12l2.5 2.5 4.5-5',
  key: 'M14.5 13.5a5 5 0 1 0-4-4L3 17v4h4l1.5-1.5v-2h2l1.5-1.5zM16 8h.01',
  offline: 'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4-2.7M19 13a10 10 0 0 0-5.5-3M2 9.5a15 15 0 0 1 4.5-3M22 9.5A15 15 0 0 0 10 5.6M12 20h.01',
  question: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 16.8v.2',
  want: 'M12 20s-7-4.4-7-9.6A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7 2.4C19 15.6 12 20 12 20z',
  say: 'M4 5h16v11H9.5L5 20v-4H4z',
  tell: 'M4 10v4l3 .5V9.5zM7 9.5l11-4.5v14L7 14.5M10 15.5v3.5h3v-2.5',
  now: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  past: 'M11 6 5 12l6 6M5 12h14',
  future: 'M13 6l6 6-6 6M19 12H5',
  words: 'M5 8h14M5 12h14M5 16h8',
  user: 'M12 12.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM4 20.5c1-4 4-6 8-6s7 2 8 6',
  download: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14',
  upload: 'M12 16V5M7.5 9.5 12 5l4.5 4.5M5 19.5h14',
  mic: 'M12 14.5a3 3 0 0 0 3-3v-5a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zM6 11.5a6 6 0 0 0 12 0M12 17.5V21',
  heart: 'M12 20s-7-4.4-7-9.6A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7 2.4C19 15.6 12 20 12 20z',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, title }: { name: string; title?: string }) {
  const d = PATHS[name] ?? PATHS.info;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title ? <title>{title}</title> : null}
      <path d={d} />
    </svg>
  );
}

/** The app's mark: a symbol tile that is also a speech bubble, with a voice inside it. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 96 96" role="img" aria-label="Voice Before Words">
      <path d="M22 10h52a14 14 0 0 1 14 14v36a14 14 0 0 1-14 14H46L28 88V74h-6A14 14 0 0 1 8 60V24a14 14 0 0 1 14-14z" fill="#3a3ad0" />
      <g stroke="#fff" strokeWidth="7" strokeLinecap="round">
        <path d="M30 36v12M42 28v28M54 34v16M66 39v6" />
      </g>
    </svg>
  );
}
