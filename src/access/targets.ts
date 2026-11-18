import type { Target } from './pointer';

/**
 * Finding what can be chosen on the page.
 *
 * Anything the app wants reachable without hands carries a `data-access`
 * attribute. Pointing and scanning both work from this list and both finish by
 * clicking the element, so a choice made by eye, head or switch runs exactly
 * the same code as a tap. There is no second, parallel interface to keep in
 * step with the first.
 *
 *   data-access="some-id"      reachable; the id must change when the content does
 *   data-access-group="row-2"  which scanning group it belongs to
 *   data-dwell-scale="2"       takes twice as long to choose by dwell
 *   data-access-scope          on a dialog: while it is open only its contents are reachable
 */

export interface DomTarget extends Target {
  element: HTMLElement;
  group: string;
}

let nextAutoId = 1;
const autoIds = new WeakMap<Element, string>();

function idOf(element: HTMLElement): string {
  const given = element.dataset.access;
  if (given) return given;
  let id = autoIds.get(element);
  if (!id) {
    id = `auto-${nextAutoId++}`;
    autoIds.set(element, id);
  }
  return id;
}

function isUsable(element: HTMLElement): boolean {
  if ((element as HTMLButtonElement).disabled) return false;
  if (element.getAttribute('aria-disabled') === 'true') return false;
  if (element.hidden) return false;
  return true;
}

/** Everything that can be chosen right now, with where it is on screen. */
export function collectTargets(doc: Document = document): DomTarget[] {
  // An open dialog takes over: only what is inside the last one counts.
  const scopes = doc.querySelectorAll<HTMLElement>('[data-access-scope]');
  const root: ParentNode = scopes.length > 0 ? scopes[scopes.length - 1] : doc;
  const width = doc.documentElement.clientWidth;
  const height = doc.documentElement.clientHeight;
  const targets: DomTarget[] = [];
  for (const element of root.querySelectorAll<HTMLElement>('[data-access]')) {
    if (!isUsable(element)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;
    // Skip anything scrolled or clipped out of view.
    if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= width || rect.top >= height) continue;
    const scale = Number(element.dataset.dwellScale);
    targets.push({
      id: idOf(element),
      element,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      dwellScale: Number.isFinite(scale) && scale > 0 ? scale : undefined,
      group: element.dataset.accessGroup ?? element.closest<HTMLElement>('[data-access-group]')?.dataset.accessGroup ?? 'main',
    });
  }
  return targets;
}
