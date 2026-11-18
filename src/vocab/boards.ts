import { allWords, getWord } from './lexicon';
import type { Board, BoardItem } from './types';

/**
 * Board layout.
 *
 * The home board is *core vocabulary*: the small set of words that make up most
 * of what anyone says. It is ordered by usefulness, so that however few tiles a
 * screen can show (nine large eye-gaze targets on a phone, forty on a tablet),
 * the first page always holds the most valuable words. Word positions never
 * change between sessions, which lets people build motor memory.
 *
 * Everything else (*fringe vocabulary*) lives in category folders. Each folder
 * lists its most-used words first; any remaining words in that category follow
 * automatically, so a word added to the lexicon can never be unreachable.
 */

const HOME_ORDER = `
i want more help stop yes no go like not
you it need eat drink play look feel what where
that my do have get make put can come give
take see open turn-on turn-off done again now good bad
big little and the a to is in on up
down out off with for here there this he she
we they me your think know say tell who when
why how some all different same later because but or
will dont please thank-you
`;

interface CategorySpec {
  id: string;
  label: string;
  icon: string;
  /** Lexicon groups that feed this board. */
  groups: string[];
  /** Shown first, in this order. */
  first: string;
}

const CATEGORIES: CategorySpec[] = [
  {
    id: 'chat',
    label: 'Chat',
    icon: 'hello',
    groups: ['chat'],
    first: `yes no okay please thank-you hello goodbye sorry ph-how-are-you ph-im-fine ph-i-dont-know
      ph-i-dont-understand ph-say-that-again ph-wait ph-my-turn ph-your-turn ph-thats-funny ph-i-love-you
      excuse-me good-morning good-night`,
  },
  {
    id: 'help',
    label: 'Help',
    icon: 'ph-i-need-help',
    groups: ['help'],
    first: `ph-i-need-help ph-bathroom ph-i-need-a-break ph-something-hurts ph-i-feel-sick ph-stop-it
      ph-i-dont-like-that ph-im-scared ph-too-loud ph-leave-me-alone ph-not-what-i-meant ph-give-me-time`,
  },
  {
    id: 'people',
    label: 'People',
    icon: 'family',
    groups: ['people'],
    first: `i you he she we they it me my your mom dad brother sister grandma grandpa friend teacher
      helper doctor nurse family baby everyone someone`,
  },
  {
    id: 'actions',
    label: 'Actions',
    icon: 'run',
    groups: ['actions'],
    first: `want need like go come eat drink play sleep help stop wait look watch listen read get give
      take make put open close turn-on turn-off have see hear feel think know say tell talk walk
      sit stand wash get-dressed love hug`,
  },
  {
    id: 'feelings',
    label: 'Feelings',
    icon: 'happy',
    groups: ['feelings'],
    first: `happy sad angry scared tired sick hungry thirsty excited bored worried confused frustrated
      calm fine overwhelmed uncomfortable lonely proud silly`,
  },
  {
    id: 'food',
    label: 'Food',
    icon: 'apple',
    groups: ['food'],
    first: `food breakfast lunch dinner snack apple banana sandwich pizza pasta chicken cheese bread
      cereal egg yogurt fruit vegetables rice soup fries chips crackers cookie cake ice-cream chocolate candy`,
  },
  {
    id: 'drinks',
    label: 'Drinks',
    icon: 'water',
    groups: ['drinks'],
    first: `water milk juice apple-juice orange-juice chocolate-milk tea coffee soda`,
  },
  {
    id: 'places',
    label: 'Places',
    icon: 'home',
    groups: ['places'],
    first: `home school bathroom outside bedroom kitchen bed room car park store work-place hospital
      playground restaurant inside`,
  },
  {
    id: 'things',
    label: 'Things',
    icon: 'toy',
    groups: ['things'],
    first: `phone tablet tv talker book toy ball game music video movie blanket pillow bag cup
      chair door light medicine glasses wheelchair headphones toilet`,
  },
  {
    id: 'body',
    label: 'Body',
    icon: 'body',
    groups: ['body'],
    first: `head stomach tummy throat mouth teeth eyes ears nose hand arm leg foot back-body chest
      pain headache stomachache`,
  },
  {
    id: 'clothes',
    label: 'Clothes',
    icon: 'shirt',
    groups: ['clothes'],
    first: `clothes shirt pants shoes socks jacket coat hat pajamas`,
  },
  {
    id: 'describe',
    label: 'Describe',
    icon: 'big',
    groups: ['describe'],
    first: `good bad big little hot cold done finished same different new old fast slow loud quiet
      nice funny yummy yucky easy difficult ready broken wet dry clean-adj dirty favorite`,
  },
  {
    id: 'colors',
    label: 'Colors & numbers',
    icon: 'red',
    groups: ['colors', 'numbers'],
    first: `red blue green yellow orange-color purple pink black white brown gray one two three four five`,
  },
  {
    id: 'time',
    label: 'Time',
    icon: 'time',
    groups: ['time'],
    first: `now later again today tomorrow yesterday soon morning afternoon night tonight always never
      sometimes before after first next last already time day week weekend`,
  },
  {
    id: 'questions',
    label: 'Questions',
    icon: 'what',
    groups: ['questions'],
    first: `what where who when why how which how-many how-much question-mark`,
  },
  {
    id: 'little',
    label: 'Little words',
    icon: 'more',
    groups: ['little'],
    first: `not dont and the a to is can will do in on at with for of up down out off here there
      some all more because but or so if very really too also maybe`,
  },
  {
    id: 'animals',
    label: 'Animals',
    icon: 'dog',
    groups: ['animals'],
    first: `dog cat bird horse rabbit bear`,
  },
  {
    id: 'nature',
    label: 'Outside',
    icon: 'sun',
    groups: ['nature'],
    first: `sun rain snow wind tree flower sky weather`,
  },
  {
    id: 'school',
    label: 'School & fun',
    icon: 'homework',
    groups: ['school'],
    first: `class homework recess math reading art nap trip joke surprise idea question problem name word`,
  },
];

function ids(list: string): string[] {
  return list.split(/\s+/).filter(Boolean);
}

function wordItems(list: string[]): BoardItem[] {
  return list.map((id) => {
    if (!getWord(id)) throw new Error(`Board refers to unknown word "${id}"`);
    return { kind: 'word', id } as const;
  });
}

function buildBoards(): Map<string, Board> {
  const boards = new Map<string, Board>();

  boards.set('home', {
    id: 'home',
    label: 'Home',
    icon: 'home',
    items: wordItems(ids(HOME_ORDER)),
    autoReturn: false,
  });

  boards.set('categories', {
    id: 'categories',
    label: 'All words',
    icon: 'thing',
    items: CATEGORIES.map((category) => ({ kind: 'folder', board: category.id }) as const),
    autoReturn: false,
  });

  const everything = allWords();
  for (const category of CATEGORIES) {
    const first = ids(category.first);
    const seen = new Set(first);
    const rest = everything
      .filter((word) => category.groups.includes(word.group) && !seen.has(word.id))
      .map((word) => word.id);
    boards.set(category.id, {
      id: category.id,
      label: category.label,
      icon: category.icon,
      items: wordItems([...first, ...rest]),
      autoReturn: true,
    });
  }
  return boards;
}

const BOARDS = buildBoards();

export const HOME_BOARD = 'home';
export const CATEGORIES_BOARD = 'categories';

export function getBoard(id: string): Board | undefined {
  return BOARDS.get(id);
}

export function allBoards(): Board[] {
  return Array.from(BOARDS.values());
}

/** Category folders in display order. */
export function categoryBoards(): Board[] {
  return CATEGORIES.map((category) => BOARDS.get(category.id)!);
}
