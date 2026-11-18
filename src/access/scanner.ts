/**
 * Switch scanning: the app highlights choices one after another, and a single
 * action (a deliberate blink, a raised eyebrow, a tap anywhere, a key, a
 * Bluetooth switch) picks whatever is highlighted. It asks nothing of pointing
 * accuracy, so it works when gaze and head control do not.
 *
 * With "group" scanning the highlight first steps through groups (the
 * suggestions, each row of the grid, the controls); a press enters the
 * highlighted group and the highlight then steps through its items. That takes
 * two presses to reach anything, but far fewer steps than visiting every item.
 *
 * This file is the timing and stepping logic only.
 */

export interface ScanItem {
  id: string;
  group: string;
}

export interface ScanConfig {
  /** Time on each highlight, in milliseconds. */
  intervalMs: number;
  /** 'group' steps through groups then items; 'linear' steps through every item. */
  pattern: 'group' | 'linear';
  /** Extra time on the first highlight of a pass, as a multiple of the interval. */
  firstPause: number;
  /** Passes through a group's items before stepping back out to the groups. */
  passes: number;
}

export const DEFAULT_SCAN: ScanConfig = { intervalMs: 1200, pattern: 'group', firstPause: 1.6, passes: 2 };

export interface ScanState {
  /** What is highlighted now: every item of a group, or a single item. */
  highlighted: string[];
  level: 'group' | 'item';
  /** The group the highlight is in or on. */
  group: string | null;
}

interface Group {
  name: string;
  items: string[];
}

function groupItems(items: ScanItem[]): Group[] {
  const groups: Group[] = [];
  const byName = new Map<string, Group>();
  for (const item of items) {
    let group = byName.get(item.group);
    if (!group) {
      group = { name: item.group, items: [] };
      byName.set(item.group, group);
      groups.push(group);
    }
    group.items.push(item.id);
  }
  return groups;
}

export class Scanner {
  private groups: Group[] = [];
  private flat: string[] = [];
  private level: 'group' | 'item' = 'group';
  private groupIndex = 0;
  private itemIndex = 0;
  private pass = 0;
  private stepAt: number | null = null;
  private signature = '';

  constructor(private config: ScanConfig = DEFAULT_SCAN) {}

  configure(config: ScanConfig): void {
    if (config.pattern !== this.config.pattern) this.restart();
    this.config = config;
  }

  /** Tell the scanner what is on screen. The position is kept when nothing changed. */
  setItems(items: ScanItem[]): void {
    const signature = items.map((item) => `${item.group}/${item.id}`).join('|');
    if (signature === this.signature) return;
    this.signature = signature;
    this.groups = groupItems(items);
    this.flat = items.map((item) => item.id);
    this.restart();
  }

  /** Go back to the first highlight. */
  restart(): void {
    this.level = 'group';
    this.groupIndex = 0;
    this.itemIndex = 0;
    this.pass = 0;
    this.stepAt = null;
  }

  private get linear(): boolean {
    // With a single group there is nothing to choose between, so go straight to its items.
    return this.config.pattern === 'linear' || this.groups.length <= 1;
  }

  private wait(first: boolean): number {
    return this.config.intervalMs * (first ? this.config.firstPause : 1);
  }

  /** Advance the highlight if its time is up. Call often. */
  tick(now: number): ScanState {
    if (this.flat.length === 0) return { highlighted: [], level: 'group', group: null };
    if (this.stepAt === null) {
      this.stepAt = now + this.wait(true);
      return this.state();
    }
    if (now < this.stepAt) return this.state();

    if (this.linear) {
      this.itemIndex = (this.itemIndex + 1) % this.flat.length;
      this.stepAt = now + this.wait(this.itemIndex === 0);
    } else if (this.level === 'group') {
      this.groupIndex = (this.groupIndex + 1) % this.groups.length;
      this.stepAt = now + this.wait(this.groupIndex === 0);
    } else {
      const size = this.groups[this.groupIndex].items.length;
      this.itemIndex++;
      if (this.itemIndex >= size) {
        this.itemIndex = 0;
        this.pass++;
        if (this.pass >= this.config.passes) {
          // Nothing was chosen in this group: step back out and carry on with the groups.
          this.level = 'group';
          this.pass = 0;
          this.groupIndex = (this.groupIndex + 1) % this.groups.length;
          this.stepAt = now + this.wait(false);
          return this.state();
        }
      }
      this.stepAt = now + this.wait(this.itemIndex === 0);
    }
    return this.state();
  }

  /**
   * The switch was pressed.
   * @returns the id of the item to activate, or null when the press entered a group
   */
  press(now: number): string | null {
    if (this.flat.length === 0) return null;
    if (this.linear) {
      const id = this.flat[this.itemIndex];
      this.itemIndex = 0;
      this.stepAt = now + this.wait(true);
      return id;
    }
    if (this.level === 'group') {
      const group = this.groups[this.groupIndex];
      if (group.items.length === 1) {
        // A group of one: no need for a second press.
        this.stepAt = now + this.wait(true);
        return group.items[0];
      }
      this.level = 'item';
      this.itemIndex = 0;
      this.pass = 0;
      this.stepAt = now + this.wait(true);
      return null;
    }
    const id = this.groups[this.groupIndex].items[this.itemIndex];
    this.level = 'group';
    this.itemIndex = 0;
    this.pass = 0;
    this.groupIndex = 0;
    this.stepAt = now + this.wait(true);
    return id;
  }

  state(): ScanState {
    if (this.flat.length === 0) return { highlighted: [], level: 'group', group: null };
    if (this.linear) {
      const id = this.flat[this.itemIndex];
      const group = this.groups.find((candidate) => candidate.items.includes(id))?.name ?? null;
      return { highlighted: [id], level: 'item', group };
    }
    const group = this.groups[this.groupIndex];
    if (this.level === 'group') return { highlighted: group.items, level: 'group', group: group.name };
    return { highlighted: [group.items[this.itemIndex]], level: 'item', group: group.name };
  }
}
