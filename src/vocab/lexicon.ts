import type { NounKind, PlaceKind, Pos, TenseCue, VerbClass, Word } from './types';

/**
 * The built-in vocabulary, written in a compact line format so it stays readable
 * and reviewable by people who are not programmers (speech therapists, families):
 *
 *     id [= label] [~ sentence text] | flags
 *
 * - `id` uses hyphens for spaces (`ice-cream`). The label defaults to the id
 *   with hyphens turned into spaces.
 * - `~ text` overrides what goes into a sentence (e.g. label "mom", text "Mom").
 * - Flags are explained next to each parser below.
 *
 * Symbols are mapped separately in `symbols.json`, keyed by the same ids.
 */

const words = new Map<string, Word>();

function parseLine(line: string): { id: string; label: string; text: string; flags: string[] } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const [head = '', flagPart = ''] = trimmed.split('|').map((part) => part.trim());
  let rest = head;
  let text: string | undefined;
  const tilde = rest.indexOf('~');
  if (tilde >= 0) {
    text = rest.slice(tilde + 1).trim();
    rest = rest.slice(0, tilde).trim();
  }
  let label: string | undefined;
  const equals = rest.indexOf('=');
  if (equals >= 0) {
    label = rest.slice(equals + 1).trim();
    rest = rest.slice(0, equals).trim();
  }
  const id = rest;
  const shown = label ?? id.replace(/-/g, ' ');
  return {
    id,
    label: shown,
    text: text ?? shown,
    flags: flagPart ? flagPart.split(',').map((flag) => flag.trim()).filter(Boolean) : [],
  };
}

function define(
  pos: Pos,
  group: string,
  block: string,
  apply: (word: Word, flags: string[]) => void,
): void {
  for (const line of block.split('\n')) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    if (words.has(parsed.id)) throw new Error(`Duplicate vocabulary id: ${parsed.id}`);
    const word: Word = { id: parsed.id, label: parsed.label, text: parsed.text, pos, group };
    apply(word, parsed.flags);
    words.set(word.id, word);
  }
}

const NOUN_KINDS: Record<string, NounKind> = {
  c: 'count',
  m: 'mass',
  pl: 'plural',
  u: 'unique',
  bare: 'bare',
  pr: 'proper',
};

/**
 * Noun flags: c count · m mass · pl plural · u unique ("the") · bare (no article)
 * · pr proper · my (default "my") · per person · body · place:the|a|to|bare|my
 * · plural:<irregular form>
 */
function nouns(group: string, block: string): void {
  define('noun', group, block, (word, flags) => {
    word.noun = 'count';
    for (const flag of flags) {
      if (flag in NOUN_KINDS) word.noun = NOUN_KINDS[flag];
      else if (flag === 'my') word.mine = true;
      else if (flag === 'per') word.person = true;
      else if (flag === 'body') {
        word.body = true;
        word.mine = true;
      } else if (flag.startsWith('place:')) word.place = flag.slice(6) as PlaceKind;
      else if (flag.startsWith('plural:')) word.plural = flag.slice(7);
      else throw new Error(`Unknown noun flag "${flag}" on ${word.id}`);
    }
  });
}

/** Verb flags: one of want · self · other · state · motion · feel · say · think */
function verbs(block: string): void {
  define('verb', 'actions', block, (word, flags) => {
    word.verb = (flags[0] as VerbClass | undefined) ?? 'self';
  });
}

/** Adjective flags: feel · color */
function adjectives(group: string, block: string): void {
  define('adj', group, block, (word, flags) => {
    if (flags.includes('feel')) word.feeling = true;
    if (flags.includes('color')) word.color = true;
  });
}

/** Adverb flags: past · future · now (tense cues) · deg (degree) · time (lives on the Time board) */
function adverbs(block: string): void {
  define('adv', 'little', block, (word, flags) => {
    for (const flag of flags) {
      if (flag === 'past' || flag === 'future' || flag === 'now') {
        word.tense = flag as TenseCue;
        word.group = 'time';
      } else if (flag === 'deg') word.degree = true;
      else if (flag === 'time') word.group = 'time';
      else throw new Error(`Unknown adverb flag "${flag}" on ${word.id}`);
    }
  });
}

/** Pronoun flags: subj · obj · poss · 3s (third person singular) · pl (plural) */
function pronouns(block: string): void {
  define('pronoun', 'people', block, (word, flags) => {
    if (flags.includes('subj')) word.subject = true;
    if (flags.includes('obj')) word.object = true;
    if (flags.includes('poss')) word.possessive = true;
    if (flags.includes('3s')) word.third = true;
    if (flags.includes('pl')) word.many = true;
  });
}

function plain(pos: Pos, group: string, block: string): void {
  define(pos, group, block, () => undefined);
}

/** Whole utterances that speak the moment they are chosen. */
function phrases(group: string, block: string): void {
  define('phrase', group, block, (word) => {
    word.speakNow = true;
  });
}

// ─────────────────────────────────────────────────────────────── pronouns ──

pronouns(`
i = I ~ I            | subj
you                  | subj, obj, pl
it                   | subj, obj, 3s
he                   | subj, 3s
she                  | subj, 3s
we                   | subj, pl
they                 | subj, pl
me                   | obj
him                  | obj
her                  | obj, poss
us                   | obj
them                 | obj
my                   | poss
your                 | poss
his                  | poss
our                  | poss
their                | poss
mine
yours
this                 | subj, obj, 3s
that                 | subj, obj, 3s
these                | subj, obj, pl
those                | subj, obj, pl
everyone             | subj, obj, 3s
someone              | subj, obj, 3s
something            | subj, obj, 3s
everything           | subj, obj, 3s
nothing              | subj, obj, 3s
anything             | subj, obj, 3s
`);

// ────────────────────────────────────────────────────────────────── verbs ──

verbs(`
want                 | want
need                 | want
like                 | want
love                 | want
hate                 | want
go                   | motion
come                 | motion
walk                 | motion
run                  | motion
drive                | motion
ride                 | motion
move                 | motion
eat                  | self
drink                | self
play                 | self
sleep                | self
watch                | self
read                 | self
rest                 | self
listen               | self
sit                  | self
stand                | self
swim                 | self
dance                | self
sing                 | self
draw                 | self
paint                | self
write                | self
cook                 | self
wash                 | self
clean                | self
work                 | self
learn                | self
try                  | self
jump                 | self
climb                | self
hide                 | self
breathe              | self
cry                  | self
laugh                | self
smile                | self
choose               | self
share                | self
win                  | self
lose                 | self
buy                  | self
pay                  | self
leave                | self
stay                 | self
visit                | self
start                | self
finish               | self
change               | self
wear                 | self
build                | self
throw                | self
catch                | self
kick                 | self
cut                  | self
use                  | self
practice             | self
pray                 | self
celebrate            | self
type                 | self
wake-up              | self
get-up               | self
sit-down             | self
lie-down             | self
get-dressed          | self
take-a-bath          | self
take-a-shower        | self
brush-teeth = brush teeth ~ brush my teeth | self
go-to-bed            | self
throw-up             | self
pee                  | self
poop                 | self
help                 | other
stop                 | other
wait                 | other
look                 | other
give                 | other
take                 | other
get                  | other
make                 | other
put                  | other
open                 | other
close                | other
turn                 | other
turn-on              | other
turn-off             | other
show                 | other
tell                 | say
bring                | other
call                 | other
push                 | other
pull                 | other
hold                 | other
carry                | other
fix                  | other
find                 | other
pick-up              | other
put-on               | other
take-off             | other
hug                  | other
kiss                 | other
tickle               | other
touch                | other
let                  | other
keep                 | other
send                 | other
text                 | other
have                 | state
know                 | state
see                  | state
hear                 | state
understand           | state
remember             | state
forget               | state
hurt                 | state
miss                 | state
mean                 | state
believe              | state
smell                | state
taste                | state
fall                 | state
break                | state
happen               | state
live                 | state
feel                 | feel
think                | think
wonder               | think
hope                 | think
wish                 | think
say                  | say
talk                 | say
ask                  | say
answer               | say
`);

// ─────────────────────────────────────────────────────────── little words ──

plain('aux', 'little', `
can
will
do
is
could
should
would
`);

plain('neg', 'little', `
not
dont = don't
`);

plain('prep', 'little', `
to
in
on
at
with
for
of
from
about
up
down
out
off
over
under
by
next-to
behind
in-front-of
between
through
around
near
without
`);

plain('det', 'little', `
the
a
some
all
more
another
other
any
every
both
many
a-lot = a lot
a-little = a little
enough
`);

plain('conj', 'little', `
and
but
or
because
so
if
then
`);

adverbs(`
here
there
again                | time
now                  | now
later                | future
soon                 | future
today                | time
tomorrow             | future
yesterday            | past
tonight              | future
already              | past
always               | time
never                | time
sometimes            | time
maybe
very                 | deg
really               | deg
too                  | deg
so-much = so much    | deg
also
just
only
still                | time
away
back
together
alone
almost
first                | time
next                 | time
last                 | time
before               | time
after                | time
`);

plain('question', 'questions', `
what
where
who
when
why
how
which
how-many
how-much
question-mark = ?
`);

// ───────────────────────────────────────────────────────────────── social ──

plain('social', 'chat', `
yes
no
okay
please
hello
hi
goodbye
bye
thank-you
sorry
excuse-me
good-morning
good-night
youre-welcome = you're welcome
wow
uh-oh
oh-no
cool
haha
hmm
`);

// ─────────────────────────────────────────────────────────────── feelings ──

adjectives('feelings', `
happy                | feel
sad                  | feel
angry                | feel
mad                  | feel
scared               | feel
tired                | feel
sleepy               | feel
sick                 | feel
excited              | feel
bored                | feel
worried              | feel
nervous              | feel
calm                 | feel
confused             | feel
frustrated           | feel
lonely               | feel
proud                | feel
surprised            | feel
hungry               | feel
thirsty              | feel
fine                 | feel
great                | feel
silly                | feel
shy                  | feel
embarrassed          | feel
grumpy               | feel
uncomfortable        | feel
overwhelmed          | feel
dizzy                | feel
itchy                | feel
safe                 | feel
better               | feel
worse                | feel
comfortable          | feel
upset                | feel
`);

// ──────────────────────────────────────────────────────────── descriptors ──

adjectives('describe', `
good
bad
big
little
small
hot
cold
warm
fast
slow
loud
quiet
new
old
young
clean-adj = clean
dirty
wet
dry
hard
soft
easy
difficult
heavy
light-adj = light
full
empty
same
different
nice
mean-adj = mean
kind
funny
scary
pretty
beautiful
ugly
yucky
yummy
broken
ready
right
wrong
favorite
long
short
tall
high
low
open-adj = open
closed
bright
dark
sweet
sour
spicy
salty
smelly
sticky
sharp
fun
boring
important
true
real
weird
special
busy
late
early
free
done = all done ~ all done
finished
gone
lost
stuck
sore
sunny
rainy
snowy
windy
cloudy
`);

adjectives('colors', `
red                  | color
blue                 | color
green                | color
yellow               | color
orange-color = orange ~ orange | color
purple               | color
pink                 | color
black                | color
white                | color
brown                | color
gray                 | color
`);

// ──────────────────────────────────────────────────────────────── numbers ──

plain('num', 'numbers', `
zero
one
two
three
four
five
six
seven
eight
nine
ten
twenty
hundred
half
`);

// ───────────────────────────────────────────────────────────────── people ──

nouns('people', `
mom ~ Mom            | pr, per
dad ~ Dad            | pr, per
grandma ~ Grandma    | pr, per
grandpa ~ Grandpa    | pr, per
brother              | my, per
sister               | my, per
baby                 | u, per, plural:babies
friend               | my, per
teacher              | my, per
doctor               | c, per, place:the
nurse                | c, per
helper               | my, per
therapist            | my, per
boy                  | c, per
girl                 | c, per
man                  | c, per, plural:men
woman                | c, per, plural:women
kid                  | c, per
family               | my, per, plural:families
people               | pl, per
aunt                 | my, per
uncle                | my, per
cousin               | my, per
neighbor             | my, per
parents              | pl, my, per
husband              | my, per
wife                 | my, per, plural:wives
partner              | my, per
son                  | my, per
daughter             | my, per
dentist              | c, per, place:the
police               | u, per
driver               | u, per
classmate            | my, per
boss                 | my, per
pet                  | my
`);

// ─────────────────────────────────────────────────────────── food & drink ──

nouns('food', `
food                 | m
breakfast            | bare
lunch                | bare
dinner               | bare
snack                | c
dessert              | m
apple                | c
banana               | c
orange               | c
grapes               | pl
strawberry           | c, plural:strawberries
blueberries          | pl
watermelon           | m
fruit                | m
vegetables           | pl
carrot               | c
potato               | c, plural:potatoes
tomato               | c, plural:tomatoes
corn                 | m
broccoli             | m
peas                 | pl
beans                | pl
salad                | m
bread                | m
toast                | m
sandwich             | c, plural:sandwiches
pizza                | m
pasta                | m
spaghetti            | m
noodles              | pl
rice                 | m
soup                 | m
cereal               | m
oatmeal              | m
pancakes             | pl
waffle               | c
egg                  | c
bacon                | m
sausage              | m
chicken              | m
chicken-nuggets      | pl
meat                 | m
fish                 | m
burger               | c
hot-dog              | c
fries                | pl
chips                | pl
crackers             | pl
popcorn              | m
cheese               | m
yogurt               | m
butter               | m
peanut-butter        | m
jelly                | m
ketchup              | m
cookie               | c
cake                 | m
cupcake              | c
donut                | c
ice-cream            | m
chocolate            | m
candy                | m
pie                  | m
pudding              | m
gum                  | m
salt                 | m
sugar                | m
`);

nouns('drinks', `
water                | m
milk                 | m
juice                | m
apple-juice          | m
orange-juice         | m
chocolate-milk       | m
tea                  | m
coffee               | m
soda                 | m
lemonade             | m
smoothie             | c
hot-chocolate        | m
milkshake            | c
`);

// ───────────────────────────────────────────────────────────────── places ──

nouns('places', `
home                 | bare, place:bare
school               | bare, place:to
work-place = work ~ work | bare, place:to
outside              | bare, place:bare
inside               | bare, place:bare
upstairs             | bare, place:bare
downstairs           | bare, place:bare
park                 | u, place:the
store                | u, place:the
bathroom             | u, place:the
bedroom              | my, place:my
kitchen              | u, place:the
living-room          | u, place:the
room                 | my, place:my
bed                  | my, place:to
car                  | u, place:the
bus                  | u, place:the
hospital             | u, place:the
restaurant           | c, place:a
playground           | u, place:the
pool                 | u, place:the
beach                | u, place:the
library              | u, place:the
church               | bare, place:to
gym                  | u, place:the
mall                 | u, place:the
zoo                  | u, place:the
farm                 | u, place:the
movies               | pl, place:the
party                | c, place:a, plural:parties
classroom            | u, place:the
office               | u, place:the
garden               | u, place:the
yard                 | u, place:the
airport              | u, place:the
house                | c, place:the
grandmas-house = Grandma's house ~ Grandma's house | pr, place:to
friends-house = friend's house ~ my friend's house | bare, place:to
town                 | bare, place:to
`);

// ───────────────────────────────────────────────────────────────── things ──

nouns('things', `
thing                | c
phone                | my
tablet               | my
tv = TV ~ TV         | u
computer             | u
talker               | my
book                 | c
toy                  | c
ball                 | u
game                 | c
music                | m
video                | c
movie                | c
cartoon              | c
video-game           | c
tv-show = show       | c
song                 | c
story                | c, plural:stories
picture              | c
blanket              | my
pillow               | my
bag                  | my
backpack             | my
cup                  | c
plate                | c
bowl                 | c
spoon                | c
fork                 | c
knife                | c, plural:knives
bottle               | c
straw                | c
napkin               | c
chair                | c
table                | u
door                 | u
window               | u
light                | u
fan                  | u
couch                | u
floor                | u
stairs               | pl
money                | m
keys                 | pl, my
glasses              | pl, my
medicine             | my, m
wheelchair           | my
headphones           | pl, my
charger              | my
battery              | u, plural:batteries
remote               | u
doll                 | c
blocks               | pl
puzzle               | c
bubbles              | pl
crayons              | pl
paper                | m
pen                  | c
pencil               | c
scissors             | pl
stickers             | pl
train                | c
bike                 | my
swing                | u
slide                | u
tissue               | c
towel                | c
soap                 | m
toothbrush           | my, plural:toothbrushes
toothpaste           | m
brush                | c, plural:brushes
box                  | c, plural:boxes
trash                | u
present              | c
card                 | c
clock                | u
camera               | c
umbrella             | c
toilet               | u, place:the
shower               | c
bath                 | c
diaper               | c
`);

// ────────────────────────────────────────────────────────── body & health ──

nouns('body', `
head                 | body
face                 | body
eyes                 | body, pl
ears                 | body, pl
nose                 | body
mouth                | body
teeth                | body, pl
tongue               | body
throat               | body
neck                 | body
shoulder             | body
arm                  | body
elbow                | body
hand                 | body
finger               | body
back-body = back ~ back | body
chest                | body
stomach              | body
tummy                | body, plural:tummies
leg                  | body
knee                 | body
foot                 | body, plural:feet
toe                  | body
skin                 | body, m
hair                 | body, m
heart                | body
body                 | body, plural:bodies
bottom               | body
private-parts        | body, pl
pain                 | bare
headache             | c
stomachache          | c
fever                | c
cough                | c
allergy              | c, plural:allergies
band-aid             | c
blood                | m
`);

// ──────────────────────────────────────────────────────────────── clothes ──

nouns('clothes', `
clothes              | pl, my
shirt                | my
pants                | pl, my
shorts               | pl, my
dress                | my, plural:dresses
skirt                | my
sweater              | my
jacket               | my
coat                 | my
shoes                | pl, my
socks                | pl, my
boots                | pl, my
hat                  | my
gloves               | pl, my
pajamas              | pl, my
underwear            | m, my
swimsuit             | my
scarf                | my, plural:scarves
`);

// ───────────────────────────────────────────────────────────────── animals ──

nouns('animals', `
animal               | c
dog                  | c
cat                  | c
bird                 | c
horse                | c
cow                  | c
pig                  | c
sheep                | c, plural:sheep
duck                 | c
rabbit               | c
mouse                | c, plural:mice
bear                 | c
lion                 | c
tiger                | c
monkey               | c
elephant             | c
giraffe              | c
snake                | c
frog                 | c
turtle               | c
bug                  | c
bee                  | c
butterfly            | c, plural:butterflies
spider               | c
dinosaur             | c
shark                | c
whale                | c
`);

// ───────────────────────────────────────────────────────── time & nature ──

nouns('time', `
time                 | m
day                  | c
morning              | u
afternoon            | u
evening              | u
night                | bare
week                 | c
weekend              | u
month                | c
year                 | c
minute               | c
hour                 | c
birthday             | my
holiday              | c
monday = Monday ~ Monday       | pr
tuesday = Tuesday ~ Tuesday    | pr
wednesday = Wednesday ~ Wednesday | pr
thursday = Thursday ~ Thursday | pr
friday = Friday ~ Friday       | pr
saturday = Saturday ~ Saturday | pr
sunday = Sunday ~ Sunday       | pr
`);

nouns('nature', `
sun                  | u
rain                 | u, m
snow                 | u, m
wind                 | u
cloud                | c
sky                  | u
tree                 | c
flower               | c
grass                | u, m
weather              | u, m
moon                 | u
star                 | c
fire                 | c
`);

// ───────────────────────────────────────────────────── school & activities ──

nouns('school', `
class                | bare, place:to, plural:classes
homework             | my, m
test                 | c
recess               | bare, place:to
math                 | m
reading              | m
science              | m
art                  | m
nap                  | c
trip                 | c
joke                 | c
surprise             | c
idea                 | c
question             | c
problem              | c
name                 | my
word                 | c
`);

// ─────────────────────────────────────────────────────────────── phrases ──

phrases('chat', `
ph-hi = Hi! ~ Hi!
ph-how-are-you = How are you? ~ How are you?
ph-im-fine = I'm fine. ~ I'm fine.
ph-whats-your-name = What's your name? ~ What's your name?
ph-my-name-is = My name is… ~ My name is
ph-nice-to-meet-you = Nice to meet you. ~ Nice to meet you.
ph-see-you-later = See you later! ~ See you later!
ph-i-dont-know = I don't know. ~ I don't know.
ph-i-dont-understand = I don't understand. ~ I don't understand.
ph-say-that-again = Please say that again. ~ Please say that again.
ph-wait = Wait a minute. ~ Wait a minute, please.
ph-my-turn = It's my turn. ~ It's my turn.
ph-your-turn = It's your turn. ~ It's your turn.
ph-thats-funny = That's funny! ~ That's funny!
ph-i-love-you = I love you. ~ I love you.
ph-guess-what = Guess what! ~ Guess what!
ph-what-about-you = What about you? ~ What about you?
ph-i-agree = I agree. ~ I agree.
ph-i-disagree = I don't agree. ~ I don't agree.
ph-good-job = Good job! ~ Good job!
`);

phrases('help', `
ph-i-need-help = I need help. ~ I need help.
ph-i-need-a-break = I need a break. ~ I need a break.
ph-bathroom = I need the bathroom. ~ I need to go to the bathroom.
ph-something-hurts = Something hurts. ~ Something hurts.
ph-i-feel-sick = I feel sick. ~ I feel sick.
ph-im-scared = I'm scared. ~ I'm scared.
ph-stop-it = Stop it! ~ Stop it!
ph-i-dont-like-that = I don't like that. ~ I don't like that.
ph-leave-me-alone = Leave me alone. ~ Please leave me alone.
ph-too-loud = It's too loud. ~ It's too loud.
ph-im-not-okay = I'm not okay. ~ I'm not okay.
ph-stay-with-me = Please stay with me. ~ Please stay with me.
ph-need-medicine = I need my medicine. ~ I need my medicine.
ph-cant-breathe = I can't breathe. ~ I can't breathe!
ph-emergency = This is an emergency! ~ This is an emergency. Please get help now!
ph-someone-hurt-me = Someone hurt me. ~ Someone hurt me.
ph-tell-you-something = I need to tell you something. ~ I need to tell you something.
ph-not-what-i-meant = That's not what I meant. ~ That's not what I meant.
ph-give-me-time = Please give me time. ~ Please give me time. I'm using my talker.
ph-talk-to-me = Please talk to me, not about me. ~ Please talk to me, not about me.
`);

// ──────────────────────────────────────────────────────────────── exports ──

/** Every built-in word, keyed by id. */
export const LEXICON: ReadonlyMap<string, Word> = words;

export function getWord(id: string): Word | undefined {
  return words.get(id);
}

export function allWords(): Word[] {
  return Array.from(words.values());
}
