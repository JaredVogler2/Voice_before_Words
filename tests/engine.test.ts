import { describe, expect, test } from 'vitest';
import { literal, suggest } from '../src/language/engine';
import { t } from './helpers';

const OPTIONS = { contractions: true, max: 6 };

function texts(spec: string, options = OPTIONS): string[] {
  return suggest(t(spec), options).map((suggestion) => suggestion.text);
}

/** [symbols chosen, the first suggestion, other suggestions that must be offered] */
type Case = [string, string, ...string[]];

function check(cases: Case[]): void {
  for (const [spec, first, ...others] of cases) {
    test(spec, () => {
      const out = texts(spec);
      expect(out[0]).toBe(first);
      for (const other of others) expect(out).toContain(other);
    });
  }
}

describe('the example from the project brief', () => {
  test('I · GO · BATHROOM offers the need, the present, the past and the question', () => {
    expect(texts('i go bathroom')).toEqual([
      'I need to go to the bathroom.',
      "I'm going to the bathroom.",
      'I went to the bathroom.',
      'Can I go to the bathroom?',
    ]);
  });

  test('the exact words are always available and never changed', () => {
    expect(literal(t('i go bathroom'))).toBe('I go bathroom.');
    expect(literal(t('where mom'))).toBe('Where Mom?');
    expect(literal(t('you okay question-mark'))).toBe('You okay?');
  });

  test('suggestions never repeat the exact words', () => {
    expect(texts('i want that')).not.toContain('I want that.');
    expect(texts('thank-you')).toEqual([]);
  });
});

describe('wants and needs', () => {
  check([
    ['i want water', 'I want some water.', 'Can I have some water?'],
    ['want cookie', 'I want a cookie.', 'Can I have a cookie?'],
    ['cookie', 'I want a cookie.', 'Can I have a cookie?'],
    ['more juice', 'I want more juice.', 'Can I have more juice?'],
    ['more', 'I want more.'],
    ['i want two cookie', 'I want two cookies.'],
    ['i want cookie milk', 'I want a cookie and some milk.'],
    ['i want cookie and milk', 'I want a cookie and some milk.'],
    ['i want cookie please', 'I want a cookie, please.', 'Can I have a cookie, please?'],
    ['want go park', 'I want to go to the park.', 'Can I go to the park?'],
    ['i want eat pizza', 'I want to eat some pizza.'],
    ['i want play friend', 'I want to play with my friend.'],
    ['i want talk mom', 'I want to talk to Mom.'],
    ['i want big', 'I want the big one.'],
    ['i want red', 'I want the red one.'],
    ['i need break', 'I need a break.'],
    ['want hug', 'I want a hug.'],
    ['i need medicine', 'I need my medicine.'],
    ['want home', 'I want to go home.', 'Can I go home?'],
    ['need bathroom', 'I need to go to the bathroom.'],
    ['i need doctor', 'I need a doctor.', 'I need to go to the doctor.'],
    ['i want mom car', "I want Mom's car."],
    ['i want watch movie later', 'I want to watch a movie later.'],
    ['i want go park and play', 'I want to go to the park and play.'],
    ['i want "Rex"', 'Can I have Rex?'],
  ]);
});

describe('things I do', () => {
  check([
    ['go park', 'I want to go to the park.', "I'm going to the park.", 'I went to the park.', "Let's go to the park."],
    ['eat cookie', 'I want to eat a cookie.', 'I ate a cookie.'],
    ['i eat pizza', 'I want to eat some pizza.', "I'm eating some pizza.", 'I ate some pizza.'],
    ['play outside', 'I want to play outside.', "Let's play outside."],
    ['watch tv', 'I want to watch TV.'],
    ['listen music', 'I want to listen to music.'],
    ['i go home', 'I want to go home.', "I'm going home.", 'I went home.'],
    ['i go "Target"', 'I want to go to Target.'],
    ['i go grandmas-house', "I want to go to Grandma's house."],
    ['sleep', 'I want to sleep.'],
    ['go-to-bed', 'I want to go to bed.'],
    ['brush-teeth', 'I want to brush my teeth.', 'I brushed my teeth.'],
    ['pee', 'I need to pee.'],
    ['i find phone', 'I found my phone.'],
    ['i lose phone', 'I lost my phone.'],
    ['i forget', 'I forgot.'],
    ['i fall', 'I fell.'],
    ['i finish', 'I finished.'],
  ]);
});

describe('time words choose the tense', () => {
  check([
    ['i eat pizza yesterday', 'I ate some pizza yesterday.'],
    ['yesterday i see dog', 'I saw a dog yesterday.'],
    ['last night i sleep', 'I slept last night.'],
    ['i already eat', 'I already ate.'],
    ['i go school tomorrow', "I'll go to school tomorrow.", "I'm going to go to school tomorrow."],
    ['tomorrow we go zoo', "We'll go to the zoo tomorrow.", "We're going to the zoo tomorrow."],
    ['i watch tv now', "I'm watching TV now."],
    ['i go school monday', 'I want to go to school on Monday.'],
  ]);

  test('a past time word rules out wishes and questions', () => {
    expect(texts('i eat pizza yesterday')).toEqual(['I ate some pizza yesterday.']);
  });
});

describe('asking someone to do something', () => {
  check([
    ['help', 'I need help.', 'Help me, please.', 'Can you help me?'],
    ['help me', 'Help me, please.', 'Can you help me?'],
    ['stop', 'Stop!', 'Please stop.'],
    ['wait', 'Wait!'],
    ['look', 'Look!'],
    ['look this', 'Look at this.'],
    ['come', 'Come here!'],
    ['open door', 'Open the door.', 'Can you open the door?', 'I want to open the door.'],
    ['turn-on tv', 'Turn on the TV.'],
    ['turn-off light', 'Turn off the light.'],
    ['give me cookie', 'Give me a cookie.', 'Can you give me a cookie?'],
    ['give mom cookie', 'Give Mom a cookie.'],
    ['put here', 'Put it here.'],
    ['put on table', 'Put it on the table.'],
    ['find phone', 'Find my phone.', 'Can you find my phone?'],
    ['wait mom', 'Wait for Mom.'],
    ['tell mom', 'Tell Mom, please.'],
    ['say again', 'Say it again.', 'Can you say it again?'],
    ['mom look', 'Mom, look!'],
    ['mom come', 'Mom, come here!'],
    ['teacher help me', 'Teacher, help me.'],
    ['you help me', 'Can you help me?'],
    ['again', 'Do it again, please.'],
  ]);

  test('when the speaker is the object, "I" is never offered as the doer', () => {
    for (const text of texts('give me cookie')) expect(text).not.toMatch(/^I /);
  });
});

describe('describing', () => {
  check([
    ['i tired', "I'm tired.", 'I feel tired.', 'I was tired.'],
    ['tired', "I'm tired.", 'Are you tired?'],
    ['i very happy', "I'm very happy."],
    ['i always tired', "I'm always tired."],
    ['mom happy', 'Mom is happy.', 'Is Mom happy?'],
    ['she happy', "She's happy."],
    ['mom and dad happy', 'Mom and Dad are happy.'],
    ['my mom happy', 'My mom is happy.'],
    ['"Rex" happy', 'Rex is happy.'],
    ['it cold', "It's cold."],
    ['cold', "I'm cold."],
    ['sunny', "It's sunny."],
    ['rain', "It's raining."],
    ['too loud', "It's too loud."],
    ['that funny', "That's funny."],
    ['this mine', 'This is mine.'],
    ['mine', "It's mine."],
    ['tv broken', 'The TV is broken.'],
    ['it break', 'It broke.', "It's broken."],
    ['done', "I'm all done."],
    ['big dog', "It's a big dog."],
    ['dog', "It's a dog."],
    ['my turn', "It's my turn."],
    ['i scared dog', "I'm scared of the dog."],
    ['i mad you', "I'm mad at you."],
    ['i worried school', "I'm worried about school."],
    ['i happy but tired', "I'm happy but tired."],
    ['in box', "It's in the box.", 'Put it in the box, please.'],
  ]);

  test('nobody asks "Am I tired?" by choosing "I tired"', () => {
    expect(texts('i tired').join(' ')).not.toMatch(/Am I/);
  });
});

describe('where people are', () => {
  check([
    ['mom work-place', 'Mom is at work.', 'Mom went to work.', 'Is Mom at work?'],
    ['i home', 'I want to go home.', "I'm home."],
    ['mom car', 'Mom is in the car.'],
    ['mom not home', "Mom isn't home."],
    ['bathroom', 'I need to go to the bathroom.', 'Can I go to the bathroom?'],
    ['park', 'I want to go to the park.', 'Can we go to the park?'],
  ]);
});

describe('other people doing things', () => {
  check([
    ['mom go store', 'Mom is going to the store.', 'Mom went to the store.'],
    ['mom dad go store', 'Mom and Dad are going to the store.'],
    ['you and me go park', 'You and I are going to the park.'],
    ['he want juice', 'He wants some juice.', 'Does he want some juice?'],
    ['we go park', "We're going to the park.", 'Can we go to the park?', "Let's go to the park."],
    ['they play', "They're playing."],
    ['dog run', 'The dog is running.'],
    ['it fall', 'It fell.', "It's falling."],
  ]);
});

describe('feelings, body and health', () => {
  check([
    ['head hurt', 'My head hurts.'],
    ['my tummy hurt', 'My tummy hurts.'],
    ['hurt head', 'My head hurts.'],
    ['my head very hurt', 'My head hurts very much.'],
    ['stomach', 'My stomach hurts.'],
    ['hurt', 'It hurts.'],
    ['pain', "I'm in pain."],
    ['i have pain head', 'I have pain in my head.'],
    ['headache', 'I have a headache.'],
    ['doctor', 'I need a doctor.'],
    ['feel bad', 'I feel bad.'],
    ['i not feel good', "I don't feel good."],
    ['i sad need mom', "I'm sad. I need Mom."],
    ['i like dog', 'I like dogs.'],
    ['i like you', 'Do you like me?'],
    ['i so-much love mom', 'I love Mom so much.'],
    ['mom', 'I want Mom.', "Where's Mom?"],
  ]);
});

describe('saying no', () => {
  check([
    ['i not want', "I don't want it."],
    ['not want', "I don't want it."],
    ['no bath', "I don't want a bath."],
    ['no more', "I don't want more."],
    ['i not tired', "I'm not tired."],
    ['not go school', "I don't want to go to school.", "I'm not going to school.", "I didn't go to school."],
    ['dont touch', "Please don't touch."],
    ['dont stop', "Please don't stop."],
    ['he not like pizza', "He doesn't like pizza."],
    ['i not know', "I don't know."],
    ['i not understand', "I don't understand."],
    ['i can not see', "I can't see."],
    ['it not good', "It's not good."],
    ['that not mine', "That's not mine."],
    ['mom not go work-place', "Mom isn't going to work."],
  ]);
});

describe('questions', () => {
  check([
    ['where mom', "Where's Mom?"],
    ['where bathroom', "Where's the bathroom?"],
    ['where my shoes', 'Where are my shoes?'],
    ['what you want', 'What do you want?'],
    ['where you go', 'Where are you going?', 'Where did you go?'],
    ['what you do', 'What are you doing?'],
    ['what that', "What's that?"],
    ['who that', "Who's that?"],
    ['why you sad', 'Why are you sad?'],
    ['why sad', 'Why are you sad?'],
    ['how you', 'How are you?'],
    ['who want cookie', 'Who wants a cookie?'],
    ['what happen', 'What happened?', "What's happening?"],
    ['what wrong', "What's wrong?"],
    ['what time', 'What time is it?'],
    ['what name', "What's your name?"],
    ['what you name', "What's your name?"],
    ['where you mom', "Where's your mom?"],
    ['when lunch', 'When is lunch?'],
    ['when we go home', 'When are we going home?'],
    ['what eat', 'What are we eating?', 'What can I eat?'],
    ['how big', 'How big is it?'],
    ['how many cookie', 'How many cookies?'],
    ['how-many cookie', 'How many cookies?'],
    ['can i go bathroom', 'Can I go to the bathroom?'],
    ['can you help me', 'Can you help me?'],
    ['do you like pizza', 'Do you like pizza?'],
    ['will you come', 'Will you come?'],
    ['is mom home', 'Is Mom home?'],
    ['is it hot', 'Is it hot?'],
    ['you want cookie', 'Do you want a cookie?'],
    ['you like pizza', 'Do you like pizza?'],
    ['you okay question-mark', 'Are you okay?'],
    ['mom home question-mark', 'Is Mom home?'],
    ['it hot question-mark', 'Is it hot?'],
  ]);
});

describe('social words', () => {
  check([
    ['hello mom', 'Hello, Mom!'],
    ['goodbye mom', 'Goodbye, Mom!'],
    ['good-morning teacher', 'Good morning, teacher!'],
    ['thank-you mom', 'Thank you, Mom.'],
    ['sorry', "I'm sorry."],
    ['yes i want cookie', 'Yes, I want a cookie.'],
    ['no thank-you', 'No, thank you.'],
    ['yes please', 'Yes, please.'],
    ['i want cookie because hungry', "I want a cookie because I'm hungry."],
    ['i think good', "I think it's good."],
  ]);
});

describe('restraint', () => {
  test('nothing is suggested when the input is already complete or cannot be read', () => {
    for (const spec of ['yes', 'no', 'me too', 'the', 'and', 'i', 'you', 'why not', 'not now', 'i want no']) {
      expect(texts(spec), spec).toEqual([]);
    }
  });

  test('a ready-made phrase is passed through untouched', () => {
    expect(literal(t('ph-i-need-help'))).toBe('I need help.');
    expect(texts('ph-i-need-help')).toEqual([]);
  });

  test('no suggestion ever introduces a content word the person did not choose', () => {
    // Only grammar words, pronouns and forms of the chosen words may appear.
    const allowed = new Set(
      ('i you we it my me a an the some to of at in on for with and not no is am are was were be do does did ' +
        "don't doesn't didn't isn't aren't wasn't can can't will won't want need have go going feel let's please " +
        "i'm it's i'll we'll we're that's one there here very much").split(' '),
    );
    const cases: [string, string[]][] = [
      ['i go bathroom', ['go', 'went', 'bathroom']],
      ['eat cookie', ['eat', 'eating', 'ate', 'cookie']],
      ['mom happy', ['mom', 'happy']],
    ];
    for (const [spec, own] of cases) {
      for (const text of texts(spec)) {
        for (const word of text.toLowerCase().replace(/[.,!?]/g, '').split(/\s+/)) {
          expect(allowed.has(word) || own.includes(word), `"${word}" in "${text}"`).toBe(true);
        }
      }
    }
  });

  test('contractions can be turned off', () => {
    const formal = { contractions: false, max: 6 };
    expect(texts('i tired', formal)[0]).toBe('I am tired.');
    expect(texts('i not want', formal)[0]).toBe('I do not want it.');
    expect(texts('where mom', formal)[0]).toBe('Where is Mom?');
    expect(texts('i can not see', formal)[0]).toBe('I cannot see.');
  });

  test('the number of suggestions is capped', () => {
    expect(suggest(t('go park'), { contractions: true, max: 2 })).toHaveLength(2);
  });

  test('every vocabulary word alone, and every pair with "I" or "want", is handled without throwing', () => {
    // suggest() swallows rule failures by design, so reach past it to make sure there are none.
    return import('../src/vocab/lexicon').then(({ allWords }) => {
      for (const word of allWords()) {
        const token = { id: word.id, text: word.text, word };
        for (const prefix of ['', 'i ', 'want ', 'not ', 'where ', 'mom ']) {
          const tokens = [...t(prefix.trim()), token];
          expect(() => suggest(tokens, OPTIONS)).not.toThrow();
          for (const suggestion of suggest(tokens, OPTIONS)) {
            expect(suggestion.text, `${prefix}${word.id}`).toMatch(/^[A-Z"'0-9].*[.!?]$/);
            expect(suggestion.text, `${prefix}${word.id}`).not.toMatch(/\s{2,}|\bundefined\b|\s[.,!?]/);
          }
        }
      }
    });
  });
});
