import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { access } from '../access/controller';
import { recommendedTargetSize } from '../access/gazeModel';
import { predictNext } from '../language/predict';
import type { Suggestion, SuggestionKind } from '../language/types';
import { PROVIDERS } from '../llm';
import { useSettings, type Settings } from '../state/settings';
import { phraseBoard } from '../state/phrases';
import { currentLiteral, quickPhrases, useTalk } from '../state/talk';
import { buildVocabulary, colorOf, type Vocabulary } from '../state/words';
import { Icon } from '../ui/Icon';
import { Tile } from '../ui/Tile';
import { go, useAccessStatus, useElementSize, useViewport } from '../ui/hooks';
import { CATEGORIES_BOARD, HOME_BOARD } from '../vocab/boards';
import { allWords } from '../vocab/lexicon';
import type { AccessStatus } from '../access/controller';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

const TOUCH_SIZE = { s: 62, m: 80, l: 106, xl: 140 } as const;
/** With eye or head pointing the chosen size is relative to what calibration found. */
const POINTING_SCALE = { s: 0.75, m: 1, l: 1.3, xl: 1.7 } as const;

/** The smallest a tile may be, which decides how many fit on the screen. */
function minTileSize(settings: Settings, status: AccessStatus, viewport: { width: number; height: number }): number {
  const chosen = settings.look.tileSize;
  const small = Math.min(viewport.width, viewport.height) < 520;
  const method = settings.access.method;
  // Pointing with the eyes or head is only as fine as the calibration says it is.
  if (method === 'gaze' || method === 'head') {
    const fitted = status.errorPx !== null ? recommendedTargetSize(status.errorPx, status.pxPerDegree ?? undefined) : method === 'head' ? 112 : 150;
    return chosen === 'auto' ? fitted : Math.round(fitted * POINTING_SCALE[chosen]);
  }
  if (chosen !== 'auto') return TOUCH_SIZE[chosen];
  if (method === 'dwell') return small ? 84 : 100;
  return small ? 64 : 92;
}

type NavId = 'home' | 'words' | 'toggle' | 'prev' | 'next' | 'keys' | 'delete' | 'menu' | 'unzoom';

/**
 * Controls for the large-target layout. There is only room for as many as there
 * are columns. Menu is always one of them, because the menu is where a person
 * changes their own settings; whatever does not fit here is inside it.
 */
function largeNav(cols: number): NavId[] {
  if (cols <= 2) return ['next', 'menu'];
  if (cols === 3) return ['toggle', 'next', 'menu'];
  if (cols === 4) return ['home', 'words', 'next', 'menu'];
  if (cols === 5) return ['home', 'words', 'next', 'delete', 'menu'];
  if (cols === 6) return ['home', 'words', 'prev', 'next', 'delete', 'menu'];
  return ['home', 'words', 'prev', 'next', 'keys', 'delete', 'menu'];
}

const KIND_LABEL: Record<SuggestionKind, string> = {
  words: 'mine',
  say: 'say',
  want: 'want',
  now: 'now',
  past: 'before',
  future: 'later',
  ask: 'ask',
  tell: 'tell',
};

function SuggestionButton({ slot, text, kind, ai, careful, onSelect }: { slot: number; text: string; kind: SuggestionKind; ai: boolean; careful: boolean; onSelect: () => void }) {
  return (
    // Something spoken aloud cannot be taken back, so when pointing is imprecise a sentence takes a little longer to choose than a word.
    <button type="button" className="suggestion" data-kind={kind} data-access={`say:${slot}:${text}`} data-access-group="sentences" data-dwell-scale={careful ? 1.3 : undefined} aria-label={`Say: ${text}`} onClick={onSelect}>
      <span className="tag" data-kind={kind}>
        <Icon name={kind} />
        {KIND_LABEL[kind]}
      </span>
      <span className="suggestion-text">{text}</span>
      <span className="suggestion-end">
        {ai ? <span className="spark"><Icon name="spark" title="Suggested by AI" /></span> : null}
        <Icon name="speaker" />
      </span>
    </button>
  );
}

/**
 * Suggestions must never change under someone's gaze. If new ones arrive while
 * one is being looked at, the swap waits until they look away.
 */
function useSteady<T>(value: T): T {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    let timer = 0;
    const apply = () => {
      if (document.querySelector('.suggestions [data-hover="true"]')) {
        timer = window.setTimeout(apply, 150);
        return;
      }
      setShown(value);
    };
    apply();
    return () => window.clearTimeout(timer);
  }, [value]);
  return shown;
}

function wordCompletions(prefix: string, vocabulary: Vocabulary, usage: Record<string, number>, count: number): string[] {
  const start = prefix.toLowerCase();
  if (!start) return [];
  return allWords()
    .filter((word) => !word.speakNow && word.label.toLowerCase().startsWith(start) && vocabulary.isAvailable(word.id))
    .sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0) || a.label.length - b.label.length)
    .slice(0, count)
    .map((word) => word.id);
}

type Cell =
  | { type: 'word'; id: string }
  | { type: 'folder'; board: string }
  | { type: 'letter'; letter: string }
  | { type: 'phrase'; text: string; saved: boolean }
  | { type: 'action'; id: 'add-word' | 'space-word'; label: string };

export function TalkView({ onMenu }: { onMenu: () => void }) {
  const settings = useSettings();
  const talk = useTalk();
  const status = useAccessStatus();
  const viewport = useViewport();
  const vocabulary = useMemo(
    () => buildVocabulary({ hiddenWords: settings.hiddenWords, customWords: settings.customWords }),
    [settings.hiddenWords, settings.customWords],
  );
  const [boardRef, boardSize] = useElementSize<HTMLDivElement>();
  const stripRef = useRef<HTMLDivElement | null>(null);
  /** Two-step choosing: the group that has been opened, if any. */
  const [opened, setOpened] = useState<number | null>(null);

  const { tokens, typed, board, page } = talk;
  const minTile = minTileSize(settings, status, viewport);
  const low = viewport.height <= 480; // a phone on its side
  const GAP = low ? 6 : 8;
  const method = settings.access.method;
  /**
   * Pointing with the eyes or head gets a layout of its own: one grid in which
   * every choice (sentences, words, controls) is a full-size target, because a
   * camera cannot tell small things apart.
   */
  const large = method === 'gaze' || method === 'head';
  const pointer = large || method === 'dwell';

  // ── the board ────────────────────────────────────────────────────────────
  const cells: Cell[] = useMemo(() => {
    if (board === 'keyboard') {
      return [...LETTERS.map((letter): Cell => ({ type: 'letter', letter })), { type: 'action', id: 'add-word', label: 'add word' }];
    }
    if (board === 'recent') {
      return phraseBoard(talk.history, talk.saved).map((item): Cell => ({ type: 'phrase', text: item.text, saved: item.saved }));
    }
    const data = vocabulary.board(board) ?? vocabulary.board(HOME_BOARD)!;
    return data.items.map((item): Cell => (item.kind === 'word' ? { type: 'word', id: item.id } : { type: 'folder', board: item.board }));
  }, [board, vocabulary, talk.history, talk.saved]);

  // Letters can be smaller than pictures when a finger is choosing, so the whole
  // alphabet stays on one page; pointing by eye or head keeps its larger targets.
  const cellMin = board === 'keyboard' && !pointer ? Math.min(minTile, 46) : minTile;
  const maxCols = Math.max(2, Math.min(12, Math.floor((boardSize.width + GAP) / (cellMin + GAP)) || 2));
  // Large targets may be a fifth shorter than they are wide: that often buys a second row, which is what lets
  // a group of four open into four full targets on a phone.
  const maxRows = Math.max(1, Math.min(10, Math.floor((boardSize.height + GAP) / (cellMin * (large ? 0.8 : 0.94) + GAP)) || 1));
  const [cols, rows] = useMemo((): [number, number] => {
    if (board !== 'keyboard' || maxCols * maxRows < cells.length) return [maxCols, maxRows];
    // The grid that fits every letter with the largest keys.
    let best: [number, number] = [maxCols, maxRows];
    let bestSize = 0;
    for (let c = 2; c <= maxCols; c++) {
      const r = Math.ceil(cells.length / c);
      if (r > maxRows) continue;
      const size = Math.min((boardSize.width - GAP * (c - 1)) / c, (boardSize.height - GAP * (r - 1)) / r);
      if (size > bestSize + 0.5) {
        bestSize = size;
        best = [c, r];
      }
    }
    return best;
  }, [board, maxCols, maxRows, cells.length, boardSize.width, boardSize.height, GAP]);

  // ── suggestions ──────────────────────────────────────────────────────────
  // On a short screen the board needs the room more than a third suggestion does.
  const wanted = settings.sentences.count;
  const count = large ? Math.max(1, Math.min(wanted, cols - 1)) : viewport.height < 700 && !low ? Math.min(wanted, 2) : wanted;
  const suggestions = useSteady(talk.suggestions).slice(0, count);
  const exact = currentLiteral(tokens);
  const quick = useMemo(() => quickPhrases(talk.history, talk.saved, count + 1), [talk.history, talk.saved, count]);
  const slots = count + 1;
  const columns = low || large ? slots : viewport.width >= 720 ? 2 : 1;

  // ── two-step choosing ────────────────────────────────────────────────────
  // When targets must be so large that only a handful fit, each target holds a
  // group of four words instead of one. Looking at a group opens it into four
  // full-size targets; looking at one of those chooses the word. Two looks per
  // word, but four times as many words on a page.
  const targets = cols * rows;
  const twoStepSetting = settings.access.twoStep ?? 'auto';
  const twoStep = large && targets >= 2 && (twoStepSetting === 'on' || (twoStepSetting === 'auto' && targets < 12));
  const perGroup = twoStep ? Math.min(4, targets) : 1;

  const perPage = targets * perGroup;
  const pages = Math.max(1, Math.ceil(cells.length / perPage));
  const currentPage = Math.min(page, pages - 1);
  const visible = cells.slice(currentPage * perPage, (currentPage + 1) * perPage);
  const tileHeight = rows > 0 ? (boardSize.height - GAP * (rows - 1)) / rows : minTile;
  const tileWidth = cols > 0 ? (boardSize.width - GAP * (cols - 1)) / cols : minTile;
  const labelSize = Math.max(11, Math.min(20, Math.min(tileHeight * 0.17, tileWidth * 0.19)));
  // A group of four sits two by two; fewer sit side by side or stacked, whichever keeps them squarer.
  const groupCols = perGroup === 4 ? 2 : tileWidth >= tileHeight ? perGroup : 1;
  const openGroup = twoStep && opened !== null && opened * perGroup < visible.length ? opened : null;

  // A group closes again when the board, the page or the message changes. (The
  // message itself, not its length: a new one-word message can replace an old one.)
  useEffect(() => {
    setOpened(null);
  }, [board, currentPage, tokens, typed, twoStep]);

  const openGroupAt = (index: number | null) => {
    setOpened(index);
    access.layoutChanged();
  };

  // Keep the newest word in view as the message grows.
  useEffect(() => {
    const node = stripRef.current;
    if (node) node.scrollLeft = node.scrollWidth;
  }, [tokens.length, typed]);

  // ── next words ───────────────────────────────────────────────────────────
  // The next-word row is left out where rows are scarce: a phone on its side, and large targets.
  const showPredictions = settings.sentences.predictions && !low && !large;
  const predicted = useMemo(() => {
    if (!showPredictions) return [];
    if (board === 'keyboard') return wordCompletions(typed, vocabulary, talk.usage.unigram, cols);
    return predictNext(talk.spoken ? [] : tokens, talk.usage, cols, vocabulary.isAvailable);
  }, [showPredictions, board, typed, tokens, talk.spoken, talk.usage, cols, vocabulary]);

  const choose = (id: string) => {
    const word = vocabulary.word(id);
    if (word) talk.add(word);
  };

  // Large targets. The row of sentences gets the full size: speaking the wrong
  // sentence is the costliest mistake. The row of controls sits against the
  // bottom of the screen, where a pointer that overshoots still lands on it, so
  // it can be a little shorter.
  const sayRow = Math.round(Math.max(low ? 84 : 96, Math.min(minTile * 0.92, viewport.height * 0.3)));
  const edgeRow = Math.round(Math.max(low ? 76 : 96, Math.min(minTile * 0.7, viewport.height * 0.26)));
  const style = {
    '--cols': cols,
    '--rows': rows,
    '--label-size': `${labelSize.toFixed(1)}px`,
    '--suggestion-columns': columns,
    '--suggestion-height': `${large ? sayRow : Math.round(Math.max(low ? 44 : 54, pointer ? minTile * 0.5 : 0))}px`,
    '--prediction-height': `${Math.round(Math.max(66, Math.min(104, minTile * 0.8)))}px`,
    '--nav-height': `${large ? edgeRow : Math.round(Math.max(low ? 48 : 58, Math.min(96, pointer ? minTile * 0.66 : 0)))}px`,
    '--tap': `${Math.round(Math.max(low ? 46 : 52, pointer ? Math.min(96, minTile * 0.6) : 0))}px`,
  } as CSSProperties;

  const provider = PROVIDERS[settings.ai.provider];
  const usedAi = suggestions.some((item) => item.source === 'ai' || item.source === 'memory');
  const boardLabel = board === 'keyboard' ? 'Spell a word' : board === 'recent' ? 'My phrases' : (vocabulary.board(board)?.label ?? '');

  const empty = tokens.length === 0 && !typed;

  const chips = (
    <div className="strip-words" ref={stripRef} aria-live="polite">
      {empty ? <span className="strip-empty">Choose words to say something</span> : null}
      {tokens.map((token, index) => {
        const image = token.word ? vocabulary.image(token.word.id) : null;
        return (
          <span key={`${token.id}-${index}`} className={image ? 'chip' : 'chip text-only'} data-color={token.word ? colorOf(token.word) : 'little'}>
            {image ? <img src={image} alt="" draggable={false} /> : null}
            <span>{token.word?.label ?? token.text}</span>
          </span>
        );
      })}
      {typed ? <span className="chip typing">{typed}</span> : null}
    </div>
  );

  const sentences = (
    <div className="suggestions" role="group" aria-label={tokens.length > 0 ? 'Ways to say it' : 'Quick phrases'}>
      {tokens.length > 0 ? (
        <>
          <SuggestionButton slot={0} text={exact} kind="words" ai={false} careful={large} onSelect={() => talk.say(exact)} />
          {suggestions.map((item: Suggestion, index) => (
            <SuggestionButton key={item.text} slot={index + 1} text={item.text} kind={item.kind} ai={item.source === 'ai' || item.source === 'memory'} careful={large} onSelect={() => talk.say(item.text)} />
          ))}
          {Array.from({ length: Math.max(0, count - suggestions.length) }, (_, index) => (
            <div key={`empty-${index}`} className="suggestion" data-empty="true" aria-hidden="true" />
          ))}
        </>
      ) : (
        quick.map((text, index) => <SuggestionButton key={text} slot={index} text={text} kind="say" ai={false} careful={large} onSelect={() => talk.sayPhrase(text)} />)
      )}
    </div>
  );

  const renderCell = (cell: Cell, group: string, reachable: boolean) => {
    if (cell.type === 'word') {
      const word = vocabulary.word(cell.id);
      if (!word) return <div key={`missing-${cell.id}`} className="tile empty" aria-hidden="true" />;
      return (
        <Tile key={`${board}:${cell.id}`} accessId={`tile:${board}:${cell.id}`} group={group} reachable={reachable} label={word.label} image={vocabulary.image(cell.id)} color={colorOf(word)} showLabel={settings.look.showLabels} onSelect={() => choose(cell.id)} />
      );
    }
    if (cell.type === 'folder') {
      const folder = vocabulary.board(cell.board)!;
      return (
        <Tile key={`folder:${cell.board}`} accessId={`folder:${cell.board}`} group={group} reachable={reachable} label={folder.label} image={vocabulary.image(folder.icon)} folder hint={`Open ${folder.label}`} onSelect={() => talk.open(cell.board)} />
      );
    }
    if (cell.type === 'letter') {
      return <Tile key={`letter:${cell.letter}`} accessId={`letter:${cell.letter}`} group={group} reachable={reachable} label={cell.letter} image={null} color="little" onSelect={() => talk.type(cell.letter)} />;
    }
    if (cell.type === 'phrase') {
      // A star marks a favourite: kept on purpose, and never pushed off the board by newer sentences.
      return <Tile key={`phrase:${cell.text}`} accessId={`phrase:${cell.text}`} group={group} reachable={reachable} label={cell.saved ? `★ ${cell.text}` : cell.text} image={null} color={cell.saved ? 'social' : 'little'} hint={`Say: ${cell.text}${cell.saved ? ' (favourite)' : ''}`} onSelect={() => talk.sayPhrase(cell.text)} />;
    }
    return <Tile key={cell.id} accessId={`action:${cell.id}`} group={group} reachable={reachable} label={cell.label} image={null} color="verb" onSelect={() => talk.commitTyped()} />;
  };

  const cellName = (cell: Cell): string =>
    cell.type === 'word' ? (vocabulary.word(cell.id)?.label ?? '') : cell.type === 'folder' ? (vocabulary.board(cell.board)?.label ?? '') : cell.type === 'letter' ? cell.letter : cell.type === 'phrase' ? cell.text : cell.label;

  const rowOf = (index: number) => `row-${Math.floor(index / cols) + 1}`;

  const boardContent = () => {
    if (board === 'recent' && cells.length === 0) {
      return (
        <div className="board-empty">
          <Icon name="history" />
          <span>Nothing has been said yet. Your favourites and the sentences you say most are kept here, on this device, so one choice says them again.</span>
        </div>
      );
    }
    if (boardSize.width <= 0) return null;
    if (!twoStep) {
      return Array.from({ length: perPage }, (_, index) => {
        const cell = visible[index];
        return cell ? renderCell(cell, rowOf(index), true) : <div key={`empty-${index}`} className="tile empty" aria-hidden="true" />;
      });
    }
    if (openGroup !== null) {
      // The opened group: its words as full-size targets.
      const members = visible.slice(openGroup * perGroup, (openGroup + 1) * perGroup);
      return Array.from({ length: targets }, (_, index) => {
        const cell = members[index];
        return cell ? renderCell(cell, rowOf(index), true) : <div key={`empty-${index}`} className="tile empty" aria-hidden="true" />;
      });
    }
    return Array.from({ length: targets }, (_, index) => {
      const members = visible.slice(index * perGroup, (index + 1) * perGroup);
      if (members.length === 0) return <div key={`empty-${index}`} className="tile empty" aria-hidden="true" />;
      // A group with a single word in it is simply that word.
      if (members.length === 1) return renderCell(members[0], rowOf(index), true);
      const names = members.map(cellName).join(', ');
      return (
        <div
          key={`group-${board}-${currentPage}-${index}`}
          className="group"
          role="group"
          aria-label={`Group: ${names}`}
          data-access={`group:${board}:${currentPage}:${index}:${names}`}
          data-access-group={rowOf(index)}
          style={{ ['--group-cols' as string]: groupCols }}
          onClick={(event) => {
            // Pointing chooses the group. A finger (or the keyboard) on one of its small tiles chooses that word directly.
            if ((event.target as HTMLElement).closest('.tile')) return;
            openGroupAt(index);
          }}
        >
          {members.map((cell) => renderCell(cell, rowOf(index), false))}
        </div>
      );
    });
  };

  const tiles = (
    <div className="board" ref={boardRef} role="group" aria-label={boardLabel} data-opened={openGroup !== null ? 'true' : undefined}>
      {boardContent()}
    </div>
  );

  const onHome = board === HOME_BOARD;
  const pageLabel = pages > 1 ? `${currentPage + 1} of ${pages}` : null;
  const navButton = (id: NavId) => {
    switch (id) {
      case 'home':
        return (
          <button key={id} type="button" className="navbtn" aria-current={onHome} data-access="nav:home" onClick={() => talk.open(HOME_BOARD)}>
            <Icon name="home" />
            <span>Home</span>
          </button>
        );
      case 'words':
        return (
          <button key={id} type="button" className="navbtn" aria-current={board === CATEGORIES_BOARD} data-access="nav:words" onClick={() => talk.open(CATEGORIES_BOARD)}>
            <Icon name="grid" />
            <span>All words</span>
          </button>
        );
      case 'toggle':
        // One button doing two jobs where there is only room for one.
        return (
          <button key={id} type="button" className="navbtn" data-access={onHome ? 'nav:to-words' : 'nav:to-home'} onClick={() => talk.open(onHome ? CATEGORIES_BOARD : HOME_BOARD)}>
            <Icon name={onHome ? 'grid' : 'home'} />
            <span>{onHome ? 'All words' : 'Home'}</span>
          </button>
        );
      case 'prev':
        return (
          <button key={id} type="button" className="navbtn" aria-label="Previous page" disabled={currentPage === 0} data-access="nav:prev" onClick={() => talk.setPage(currentPage - 1)}>
            <Icon name="back" />
            <span>{large ? 'Back' : (pageLabel ?? 'Back')}</span>
          </button>
        );
      case 'next':
        // With large targets there are many pages and no room for a Back button
        // on small screens, so More goes round to the first page again.
        return (
          <button key={id} type="button" className="navbtn" aria-label="Next page" disabled={large ? pages <= 1 : currentPage >= pages - 1} data-access="nav:next" onClick={() => talk.setPage(large ? (currentPage + 1) % pages : currentPage + 1)}>
            <Icon name="forward" />
            <span>{large && pageLabel ? `More · ${pageLabel}` : 'More'}</span>
          </button>
        );
      case 'keys':
        return (
          <button key={id} type="button" className="navbtn" aria-current={board === 'keyboard'} data-access="nav:keys" onClick={() => talk.open(board === 'keyboard' ? HOME_BOARD : 'keyboard')}>
            <Icon name="keyboard" />
            <span>Spell</span>
          </button>
        );
      case 'delete':
        return (
          <button key={id} type="button" className="navbtn" aria-label="Remove the last word" disabled={empty} data-access="nav:delete" onClick={() => talk.backspace()}>
            <Icon name="backspace" />
            <span>Delete</span>
          </button>
        );
      case 'menu':
        return (
          <button key={id} type="button" className="navbtn" data-access="nav:menu" onClick={onMenu}>
            <Icon name="menu" />
            <span>Menu</span>
          </button>
        );
      case 'unzoom':
        // Out of an opened group without choosing anything from it.
        return (
          <button key={id} type="button" className="navbtn" aria-current="true" data-access="nav:unzoom" onClick={() => openGroupAt(null)}>
            <Icon name="back" />
            <span>Back</span>
          </button>
        );
    }
  };

  if (large) {
    return (
      <div className="talk large" style={style}>
        {/* The message is for reading only here; Delete and Clear are in the controls and the menu. */}
        <div className="strip" data-spoken={talk.spoken} aria-label="Your message" role="group">
          {chips}
        </div>
        {sentences}
        <div className="board-wrap">{tiles}</div>
        <nav className="nav" aria-label="Controls" data-access-group="nav">
          {(openGroup !== null ? (['unzoom', ...largeNav(cols).slice(1)] as NavId[]) : largeNav(cols)).map(navButton)}
        </nav>
      </div>
    );
  }

  return (
    <div className="talk" style={style}>
      <div className="talk-top">
        <div className="strip" data-spoken={talk.spoken} aria-label="Your message" role="group">
          {chips}
          <div className="strip-actions" data-access-group="edit">
            <button type="button" className="iconbtn" aria-label="Remove the last word" disabled={empty} data-access="edit:back" onClick={() => talk.backspace()}>
              <Icon name="backspace" />
            </button>
            {talk.cleared && tokens.length === 0 ? (
              <button type="button" className="iconbtn" aria-label="Put the message back" data-access="edit:undo" onClick={() => talk.undoClear()}>
                <Icon name="undo" />
              </button>
            ) : (
              <button type="button" className="iconbtn danger" aria-label="Clear the message" disabled={empty} data-access="edit:clear" data-dwell-scale="1.6" onClick={() => talk.clear()}>
                <Icon name="clear" />
              </button>
            )}
          </div>
        </div>

        {sentences}

        {settings.ai.enabled || talk.partnerSaid ? (
          <div className="ai-note" data-state={talk.ai} aria-live="polite">
            {talk.partnerSaid ? (
              <>
                <Icon name="say" />
                <span>Answering: “{talk.partnerSaid}”</span>
              </>
            ) : talk.ai === 'waiting' ? (
              <>
                <Icon name="spark" />
                <span className="dots">Asking {provider.label}</span>
              </>
            ) : talk.ai === 'failed' ? (
              <>
                <Icon name="warning" />
                <span>AI unavailable, using on-device suggestions. {talk.aiMessage}</span>
              </>
            ) : usedAi && tokens.length > 0 ? (
              <>
                <Icon name="spark" />
                <span>Suggested by {provider.label}. You choose what is said.</span>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="board-wrap">
        {showPredictions ? (
          <div className="predictions" role="group" aria-label={board === 'keyboard' ? 'Words that match' : 'Likely next words'}>
            {Array.from({ length: cols }, (_, index) => {
              const id = predicted[index];
              const word = id ? vocabulary.word(id) : undefined;
              if (!word) return <div key={`gap-${index}`} className="tile empty" aria-hidden="true" />;
              return <Tile key={id} accessId={`next:${id}`} group="next" label={word.label} image={vocabulary.image(id)} color={colorOf(word)} compact showLabel onSelect={() => choose(id)} />;
            })}
          </div>
        ) : null}
        {tiles}
      </div>

      <nav className="nav" aria-label="Boards" data-access-group="nav">
        {(['home', 'words', 'prev', 'next', 'keys', 'menu'] as NavId[]).map(navButton)}
      </nav>
    </div>
  );
}

/** Small banner about the camera, shown only when something needs attention. */
export function StatusPill({ status }: { status: AccessStatus }) {
  const camera = status.method === 'gaze' || status.method === 'head' || status.camera !== 'idle';
  if (!status.active || status.method === 'touch' || status.calibrating) return null;
  let text = '';
  let tone: 'info' | 'warn' = 'info';
  let icon = 'eye';
  if (status.paused) {
    text = 'Paused. Open the menu to carry on.';
    icon = 'pause';
  } else if (camera && status.camera === 'starting') {
    text = 'Starting the camera…';
    icon = 'camera';
  } else if (camera && status.camera === 'error') {
    text = status.cameraError?.message ?? 'The camera could not be started.';
    tone = 'warn';
    icon = 'warning';
  } else if ((status.method === 'gaze' || status.method === 'head') && !status.calibrated) {
    text = 'Calibration needed.';
    tone = 'warn';
    icon = 'target';
  } else if (camera && status.camera === 'running' && !status.face) {
    text = 'I can’t see your face.';
    tone = 'warn';
    icon = 'warning';
  }
  if (!text) return null;
  const calibrate = tone === 'warn' && icon === 'target';
  const cameraFailed = camera && status.camera === 'error';
  return (
    <div className="status" data-tone={tone} role="status">
      <Icon name={icon} />
      <span>{text}</span>
      {calibrate ? (
        <button type="button" data-direct style={{ fontWeight: 800, textDecoration: 'underline' }} onClick={() => go('/calibrate')}>
          Start
        </button>
      ) : null}
      {cameraFailed ? (
        <button type="button" data-direct style={{ fontWeight: 800, textDecoration: 'underline' }} onClick={() => void access.enable()}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

