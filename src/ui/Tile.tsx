import { memo } from 'react';
import type { ColorKey } from '../vocab/types';

interface TileProps {
  /** Identifier for hands-free access. Must change whenever what the tile says changes. */
  accessId: string;
  label: string;
  image: string | null;
  color?: ColorKey;
  /** Scanning group: usually the row. */
  group: string;
  onSelect: () => void;
  folder?: boolean;
  compact?: boolean;
  showLabel?: boolean;
  dimmed?: boolean;
  /** What a screen reader says, when it should differ from the label. */
  hint?: string;
  /** False for a tile shown inside a group: the group is what gets pointed at, not the tile. */
  reachable?: boolean;
}

/** One choice on the board: a picture and its word. */
export const Tile = memo(function Tile({ accessId, label, image, color, group, onSelect, folder, compact, showLabel = true, dimmed, hint, reachable = true }: TileProps) {
  const classes = ['tile'];
  if (folder) classes.push('folder');
  if (compact) classes.push('compact');
  if (!image) classes.push('text-only');
  if (dimmed) classes.push('hidden-word');
  // A tile with no picture must always show its word.
  const labelled = showLabel || !image;
  return (
    <button type="button" className={classes.join(' ')} data-color={folder ? undefined : color} data-access={reachable ? accessId : undefined} data-access-group={reachable ? group : undefined} aria-label={hint ?? label} onClick={onSelect}>
      {image ? (
        <span className="tile-art">
          <img src={image} alt="" loading="lazy" decoding="async" draggable={false} />
        </span>
      ) : null}
      {labelled ? <span className="tile-label">{label}</span> : null}
    </button>
  );
});
