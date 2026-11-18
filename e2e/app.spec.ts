import { expect, test, type Page } from '@playwright/test';

/**
 * The whole app, driven the way people drive it: by touch, by a single switch,
 * by a pointer that rests, and with an AI key. Camera pointing is covered here
 * only as far as a browser without a face in front of it can go; the accuracy
 * work is described in docs/eye-tracking.md.
 */

const ACCESS = {
  method: 'touch',
  dwellMs: 800,
  smoothing: 6,
  showPointer: true,
  scanIntervalMs: 500,
  scanPattern: 'group',
  switchGesture: 'none',
  gestureThreshold: 0.55,
  gestureHoldMs: 350,
  switchKeys: true,
  switchTap: false,
  longCloseMenu: false,
  menuBy: 'switch',
  learnFromUse: false,
  twoStep: 'auto',
  cueVolume: 0,
  calibrationPoints: 9,
};

/** Start past the welcome screens, with settings saved the way the app saves them. */
async function seed(page: Page, state: Record<string, unknown> = {}) {
  await page.addInitScript((saved) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('voice-before-words:settings', JSON.stringify({ state: { onboarded: true, ...saved }, version: 1 }));
  }, state);
}

/** Fail on anything the browser complains about. */
function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    // The face-tracking engine announces itself on the error channel; that line is not a problem.
    if (message.type() === 'error' && !/XNNPACK|TensorFlow Lite/.test(message.text())) problems.push(`console: ${message.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && response.url().startsWith('http://127.0.0.1')) problems.push(`http ${response.status()}: ${response.url()}`);
  });
  return problems;
}

const tile = (page: Page, name: string) => page.locator('.board').getByRole('button', { name, exact: true });
const message = (page: Page) => page.locator('.strip .chip');
const sentences = (page: Page) => page.locator('.suggestion-text');

test('first run: welcome, choose how, choose a voice, start talking', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Voice Before Words' })).toBeVisible();
  await page.getByRole('button', { name: /Get started/ }).click();
  await expect(page.getByRole('radio', { name: /^Touch/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Start talking' }).click();
  await expect(page.getByText('Choose words to say something')).toBeVisible();
  await expect(tile(page, 'want')).toBeVisible();
  expect(problems).toEqual([]);
});

test('symbols become sentences, and the chosen one is spoken', async ({ page }) => {
  const problems = watch(page);
  await seed(page);
  await page.goto('/');
  await tile(page, 'I').click();
  await tile(page, 'go').click();
  await page.getByRole('button', { name: 'All words', exact: true }).click();
  await page.getByRole('button', { name: 'Open Places' }).click();
  await tile(page, 'bathroom').click();
  await expect(message(page)).toHaveText(['I', 'go', 'bathroom']);
  // The person's own words are always first; grammatical readings follow.
  await expect(sentences(page).first()).toHaveText('I go bathroom.');
  await expect(sentences(page)).toContainText(['I need to go to the bathroom.']);
  await page.getByRole('button', { name: 'Say: I need to go to the bathroom.' }).click();
  await expect(page.locator('.strip')).toHaveAttribute('data-spoken', 'true');
  // Choosing a word after speaking starts a new message.
  await tile(page, 'more').click();
  await expect(message(page)).toHaveText(['more']);
  expect(problems).toEqual([]);
});

test('every board keeps its place: paging, spelling, and what was said before', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Spell', exact: true }).click();
  // The whole alphabet is on one page, even on a phone.
  for (const letter of ['a', 'm', 'z']) await expect(tile(page, letter)).toBeVisible();
  for (const letter of ['d', 'o', 'g']) await tile(page, letter).click();
  await expect(page.locator('.predictions').getByRole('button', { name: 'dog', exact: true })).toBeVisible();
  await page.locator('.predictions').getByRole('button', { name: 'dog', exact: true }).click();
  await expect(message(page)).toHaveText(['dog']);
  await page.getByRole('button', { name: 'Clear the message' }).click();
  await expect(message(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Put the message back' }).click();
  await expect(message(page)).toHaveText(['dog']);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'My phrases' }).click();
  await expect(page.getByText('Nothing has been said yet.')).toBeVisible();

  // Say something, keep it as a favourite, and find it still there after the app is closed and opened again.
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Clear the message' }).click();
  await tile(page, 'I').click();
  await tile(page, 'want').click();
  await page.getByRole('button', { name: 'Say: I want it.' }).click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Save as a favourite' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Say: I want it.' })).toBeVisible(); // offered straight away, with nothing chosen
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'My phrases' }).click();
  await expect(tile(page, 'Say: I want it. (favourite)')).toHaveText('★ I want it.');
});

test('one switch: choices light up in turn and a key picks the lit one', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: false, serviceWorkers: 'block' });
  const page = await context.newPage();
  const problems = watch(page);
  await seed(page, { access: { ...ACCESS, method: 'scan' } });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Tap anywhere to start' })).toBeVisible();
  await page.keyboard.press('Space'); // the one real press that switches hands-free access on
  const lit = () => page.locator('[data-scan]').evaluateAll((elements) => elements.map((element) => `${element.getAttribute('data-access')}|${element.getAttribute('data-scan')}`));
  // Wait for the row that holds "want" to light up, enter it, then pick "want".
  await expect.poll(lit, { timeout: 20_000, intervals: [40] }).toContain('tile:home:want|group');
  await page.keyboard.press('Space');
  await expect.poll(lit, { timeout: 20_000, intervals: [40] }).toEqual(['tile:home:want|item']);
  await page.keyboard.press('Space');
  await expect(message(page)).toHaveText(['want']);
  expect(problems).toEqual([]);
  await context.close();
});

test('a resting pointer chooses, and never chooses what merely appeared under it', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: false, serviceWorkers: 'block' });
  const page = await context.newPage();
  await seed(page, { access: { ...ACCESS, method: 'dwell' } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Tap anywhere to start' }).click();
  // Rest on a word in the next-word row. Choosing it refills that row with different words.
  const first = page.locator('.predictions .tile:not(.empty)').first();
  const chosen = (await first.textContent())!.trim();
  const box = (await first.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
  await expect(message(page)).toHaveText([chosen], { timeout: 5000 });
  // The pointer has not moved, so whatever is under it now was not chosen by the person.
  await page.waitForTimeout(2500);
  await expect(message(page)).toHaveText([chosen]);
  // Moving to a sentence and resting there speaks it.
  const sentence = (await page.locator('.suggestion').first().boundingBox())!;
  await page.mouse.move(sentence.x + sentence.width / 2, sentence.y + sentence.height / 2, { steps: 6 });
  await expect(page.locator('.strip')).toHaveAttribute('data-spoken', 'true', { timeout: 5000 });
  await context.close();
});

test('settings without hands: the menu, speed and the way of choosing, with a way back', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: false, serviceWorkers: 'block' });
  const page = await context.newPage();
  const problems = watch(page);
  await seed(page, { access: { ...ACCESS, method: 'dwell', dwellMs: 600 }, ai: { apiKey: 'sk-ant-test-key', enabled: false } });
  await page.route('https://api.anthropic.com/**', (route) => route.abort());
  await page.goto('/');
  // Whoever is helping can reach settings from the start screen, before anything is switched on.
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Tap anywhere to start' }).click();

  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('voice-before-words:settings')!).state.access as { method: string; dwellMs: number });
  /** Rest the pointer on something until it is chosen, coming to it from somewhere else. */
  const rest = async (access: string) => {
    const target = page.locator(`[data-access="${access}"]`);
    await expect(target).toBeVisible();
    const box = (await target.boundingBox())!;
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // A resting pointer never chooses what appears under it, so first look somewhere else.
    await page.mouse.move(centre.x < 512 ? 1000 : 24, centre.y < 384 ? 740 : 80, { steps: 4 });
    await page.waitForTimeout(150);
    await page.mouse.move(centre.x, centre.y, { steps: 6 });
    // The target is on screen, under the pointer, and the app has noticed the pointer on it.
    const under = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-access]')?.getAttribute('data-access') ?? `nothing at ${x},${y} in ${innerWidth}x${innerHeight}`, [centre.x, centre.y]);
    expect(under, `what is under the pointer when resting on ${access}`).toBe(access);
    await expect(target, `the app should show the pointer resting on ${access}`).toHaveAttribute('data-hover', 'true', { timeout: 4000 });
  };

  // Everything from here on is done by resting a pointer: no clicks, no keys.
  await rest('nav:menu');
  await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible({ timeout: 8000 });
  await rest('menu:settings');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible({ timeout: 8000 });
  await rest('menu:slower');
  await expect.poll(async () => (await saved()).dwellMs, { timeout: 8000 }).toBe(800);
  await rest('menu:methods');
  await expect(page.getByRole('dialog', { name: 'How I choose' })).toBeVisible({ timeout: 8000 });

  // The voice and the AI model can be reached the same way: nothing set up at the start is locked in.
  await rest('menu:back:methods');
  await rest('menu:more');
  await expect(page.getByRole('dialog', { name: 'More settings' })).toBeVisible({ timeout: 8000 });
  await expect(page.locator('[data-access="menu:voice"]')).toBeVisible();
  await rest('menu:ai');
  await expect(page.getByRole('dialog', { name: 'Smart sentences' })).toBeVisible({ timeout: 8000 });
  await expect(page.locator('[data-access="menu:ai-key"]')).toContainText('Change or remove the key');
  await rest('menu:ai-toggle:off');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('voice-before-words:settings')!).state.ai.enabled), { timeout: 8000 }).toBe(true);
  await rest('menu:back:ai');
  await rest('menu:back:more');
  await rest('menu:methods');
  await expect(page.getByRole('dialog', { name: 'How I choose' })).toBeVisible({ timeout: 8000 });

  // Try scanning. The app asks whether it works, and the answer has to be given by scanning.
  await rest('menu:method:scan');
  await expect(page.getByRole('alertdialog')).toBeVisible({ timeout: 8000 });
  expect((await saved()).method).toBe('scan');
  const lit = () => page.locator('[data-scan]').evaluateAll((elements) => elements.map((element) => element.getAttribute('data-access')));
  await expect.poll(lit, { timeout: 20_000, intervals: [40] }).toEqual(['menu:trial:revert']);
  await page.keyboard.press('Space');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect((await saved()).method).toBe('dwell');

  // Try it again and keep it this time.
  await rest('nav:menu');
  await rest('menu:settings');
  await rest('menu:methods');
  await rest('menu:method:scan');
  await expect(page.getByRole('alertdialog')).toBeVisible({ timeout: 8000 });
  await expect.poll(lit, { timeout: 20_000, intervals: [40] }).toEqual(['menu:trial:keep']);
  await page.keyboard.press('Space');
  // Keeping takes a second choice, in a different place, so it cannot happen by accident.
  await expect(page.getByRole('heading', { name: 'One more, to be sure' })).toBeVisible();
  await expect.poll(lit, { timeout: 20_000, intervals: [40] }).toEqual(['menu:trial:confirm']);
  await page.keyboard.press('Space');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect((await saved()).method).toBe('scan');
  expect(problems).toEqual([]);
  await context.close();
});

test('an AI key: tested, used for suggestions, and never in the way when it fails', async ({ page }) => {
  const problems = watch(page);
  await seed(page);
  const calls: { headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  let fail = false;
  await page.route('https://api.anthropic.com/**', async (route) => {
    const request = route.request();
    calls.push({ headers: request.headers(), body: JSON.parse(request.postData() ?? '{}') });
    const cors = { 'access-control-allow-origin': '*' };
    if (fail) {
      await route.fulfill({ status: 401, contentType: 'application/json', headers: cors, body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }) });
      return;
    }
    const suggestions = [{ text: 'May I go to the bathroom, please?', kind: 'ask' }];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: cors,
      body: JSON.stringify({ id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: JSON.stringify({ suggestions }) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 300, output_tokens: 20 } }),
    });
  });

  await page.goto('/#/settings/ai');
  await page.getByLabel('API key').fill('sk-ant-test-key');
  await page.getByRole('button', { name: /Test and turn on/ }).click();
  await expect(page.getByText('It works.')).toBeVisible();
  // The request is the documented shape: the person's symbols, a response schema, no sampling parameters.
  const body = calls[0].body as { model: string; messages: { content: string }[]; output_config?: { format?: { type?: string } } };
  // The default is the fast, inexpensive model.
  expect(body.model).toBe('claude-haiku-5-5');
  expect(body.messages[0].content).toContain('I · go · bathroom');
  expect(body.output_config?.format?.type).toBe('json_schema');
  expect(body).not.toHaveProperty('temperature');

  await page.evaluate(() => {
    location.hash = '#/';
  });
  await tile(page, 'I').click();
  await tile(page, 'go').click();
  await expect(page.getByRole('button', { name: 'Say: May I go to the bathroom, please?' })).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.ai-note')).toContainText('You choose what is said');
  // The person's own words are still first, whatever the AI says.
  await expect(sentences(page).first()).toHaveText('I go.');

  fail = true;
  await page.getByRole('button', { name: 'Clear the message' }).click();
  await tile(page, 'I').click();
  await tile(page, 'want').click();
  await tile(page, 'more').click();
  await expect(page.locator('.ai-note')).toContainText('AI unavailable, using on-device suggestions', { timeout: 8000 });
  await expect(sentences(page)).toContainText(['I want more.']);
  expect(problems.filter((problem) => !problem.includes('401'))).toEqual([]);
});

test('settings: every page opens cleanly and fits a phone', async ({ page }) => {
  const problems = watch(page);
  await seed(page);
  for (const section of ['', 'access', 'voice', 'ai', 'look', 'words', 'data', 'about']) {
    await page.goto(`/#/settings/${section}`);
    await expect(page.locator('.page h1')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `sideways scrolling on ${section || 'the index'}`).toBeLessThanOrEqual(1);
  }
  // The touch menu goes straight to the things chosen during setup, and a key can always be taken out again.
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByRole('button', { name: 'How I choose' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Voice', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'AI key' }).click();
  await page.getByLabel('API key').fill('sk-ant-a-key-to-remove');
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByLabel('API key')).toHaveValue('');
  // A quick phrase added here is offered on the board.
  await page.goto('/#/settings/words');
  await page.getByLabel('A quick phrase').fill('My name is Sam.');
  await page.locator('.card', { hasText: 'Favourite phrases' }).getByRole('button', { name: 'Add', exact: true }).click();
  await page.goto('/#/');
  await expect(page.getByRole('button', { name: 'Say: My name is Sam.' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('after one visit it works with no connection, face tracking included', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'only Chromium can be given a made-up camera');
  const context = await browser.newContext({ viewport: { width: 820, height: 1180 }, serviceWorkers: 'allow' });
  const page = await context.newPage();
  const problems = watch(page);
  await seed(page, { access: { ...ACCESS, method: 'gaze', switchGesture: 'blink', longCloseMenu: true } });
  await page.goto('/');

  // The first visit, with a connection: the app saves itself, and using the camera saves the face-tracking engine.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.getByRole('button', { name: 'Tap anywhere to start' }).click();
  await expect(page.getByText(/whole face is inside the oval/)).toBeVisible({ timeout: 30_000 });
  const saved = (name: string) =>
    page.evaluate(async (part) => {
      let count = 0;
      for (const key of await caches.keys()) if (key.includes(part)) count += (await (await caches.open(key)).keys()).length;
      return count;
    }, name);
  await expect.poll(() => saved('face-tracking'), { timeout: 60_000 }).toBeGreaterThanOrEqual(3);
  await expect.poll(() => saved('precache'), { timeout: 60_000 }).toBeGreaterThan(600);

  await context.setOffline(true);
  await page.reload();
  // Eye pointing still starts: camera on, face tracker loaded from what was saved.
  await expect(page.getByText(/whole face is inside the oval/)).toBeVisible({ timeout: 30_000 });

  // And so does the board, with its pictures, its sentences and its settings.
  await page.evaluate(() => {
    const key = 'voice-before-words:settings';
    const value = JSON.parse(localStorage.getItem(key)!);
    value.state.access.method = 'touch';
    localStorage.setItem(key, JSON.stringify(value));
    location.hash = '#/';
  });
  await page.reload();
  await tile(page, 'I').click();
  await tile(page, 'want').click();
  await expect(sentences(page)).toContainText(['I want it.']);
  const pictures = await page.locator('.board .tile img').evaluateAll((images) => Promise.all(images.slice(0, 10).map((image) => (image as HTMLImageElement).decode().then(() => (image as HTMLImageElement).naturalWidth > 0, () => false))));
  expect(pictures.length).toBeGreaterThan(5);
  expect(pictures.every(Boolean)).toBe(true);
  await page.goto('/#/settings/about');
  await expect(page.getByText('Saved on this device. The board works without the internet.')).toBeVisible();
  expect(problems).toEqual([]);
  await context.close();
});

test('eye pointing: the camera and face tracker start on the device and ask for a face', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'only Chromium can be given a made-up camera');
  // A synthetic camera picture with no face in it. That is enough to prove the camera is opened, the
  // face-tracking engine is loaded from this app's own files, and the screen says what it needs.
  const context = await browser.newContext({ viewport: { width: 820, height: 1180 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const problems = watch(page);
  const elsewhere: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1') && !request.url().startsWith('data:') && !request.url().startsWith('blob:')) elsewhere.push(request.url());
  });
  await seed(page, { access: { ...ACCESS, method: 'gaze', switchGesture: 'blink', longCloseMenu: true } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Tap anywhere to start' }).click();
  await expect(page.getByRole('heading', { name: 'Set up eye pointing' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/whole face is inside the oval/)).toBeVisible({ timeout: 30_000 });
  // Nothing about the camera goes anywhere: no request left this origin.
  expect(elsewhere).toEqual([]);

  // Something takes the camera away (a call, another app). The app notices and gets it back by itself.
  const camera = () =>
    page.evaluate(() => {
      const video = document.querySelector<HTMLVideoElement>('body > video');
      const stream = video?.srcObject as MediaStream | null | undefined;
      const track = stream?.getVideoTracks()[0];
      return track ? { id: stream!.id, state: track.readyState } : null;
    });
  const before = await camera();
  expect(before?.state).toBe('live');
  await page.evaluate(() => (document.querySelector<HTMLVideoElement>('body > video')!.srcObject as MediaStream).getTracks().forEach((track) => track.stop()));
  await expect
    .poll(async () => {
      const now = await camera();
      return now !== null && now.state === 'live' && now.id !== before!.id;
    }, { timeout: 20_000 })
    .toBe(true);
  await expect(page.getByText(/whole face is inside the oval/)).toBeVisible({ timeout: 15_000 });
  expect(problems).toEqual([]);
  await context.close();
});
