import type { DiffLine } from '@/core/types/diff';
import { renderDiffContent,splitIntoHunks } from '@/features/chat/rendering/DiffRenderer';

function equal(text: string): DiffLine { return { type: 'equal', text }; }
function insert(text: string): DiffLine { return { type: 'insert', text }; }
function del(text: string): DiffLine { return { type: 'delete', text }; }

describe('splitIntoHunks()', () => {
  it('returns empty array for empty input', () => {
    expect(splitIntoHunks([])).toEqual([]);
  });

  it('returns empty array when all lines are equal (no changes)', () => {
    const lines: DiffLine[] = [equal('a'), equal('b'), equal('c')];
    expect(splitIntoHunks(lines)).toEqual([]);
  });

  it('produces a single hunk for one changed line with default context', () => {
    // 10 equal lines, change on index 5, 10 equal lines
    const lines: DiffLine[] = [
      equal('0'), equal('1'), equal('2'), equal('3'), equal('4'),
      insert('CHANGED'),
      equal('6'), equal('7'), equal('8'), equal('9'), equal('10'),
    ];
    const hunks = splitIntoHunks(lines);
    expect(hunks).toHaveLength(1);
    // Should include 3 lines of context before and after index 5
    expect(hunks[0].lines).toHaveLength(7); // indices 2..8
    expect(hunks[0].lines.some(l => l.type === 'insert')).toBe(true);
  });

  it('includes correct context lines around a change', () => {
    const lines: DiffLine[] = [
      equal('A'), equal('B'), equal('C'), equal('D'), equal('E'),
      insert('NEW'),
      equal('F'), equal('G'), equal('H'), equal('I'), equal('J'),
    ];
    const hunks = splitIntoHunks(lines, 2);
    expect(hunks).toHaveLength(1);
    // 2 context lines: indices 3, 4 before + changed at 5 + indices 6, 7 after
    expect(hunks[0].lines).toHaveLength(5);
    expect(hunks[0].lines[2].type).toBe('insert');
  });

  it('groups two close changes into one hunk', () => {
    const lines: DiffLine[] = [
      equal('1'), equal('2'), equal('3'),
      insert('X'),           // index 3
      equal('4'),
      del('Y'),              // index 5 — within context=3 of index 3
      equal('6'), equal('7'), equal('8'),
    ];
    const hunks = splitIntoHunks(lines, 3);
    // Both changes are close enough that their context ranges overlap
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines.some(l => l.type === 'insert')).toBe(true);
    expect(hunks[0].lines.some(l => l.type === 'delete')).toBe(true);
  });

  it('produces two separate hunks for distant changes', () => {
    const lines: DiffLine[] = [
      equal('1'), equal('2'), equal('3'), equal('4'),
      insert('FIRST'),       // index 4
      equal('5'), equal('6'), equal('7'), equal('8'), equal('9'), equal('10'),
      equal('11'), equal('12'), equal('13'), equal('14'),
      del('SECOND'),         // index 19
      equal('20'), equal('21'), equal('22'),
    ];
    const hunks = splitIntoHunks(lines, 3);
    expect(hunks).toHaveLength(2);
    expect(hunks[0].lines.some(l => l.type === 'insert')).toBe(true);
    expect(hunks[1].lines.some(l => l.type === 'delete')).toBe(true);
  });

  it('merges adjacent hunks when context windows touch', () => {
    // Changes at index 3 and index 7 with context=3: windows [0..6] and [4..10] overlap
    const lines: DiffLine[] = [
      equal('0'), equal('1'), equal('2'),
      insert('A'),   // index 3
      equal('4'), equal('5'), equal('6'),
      del('B'),      // index 7
      equal('8'), equal('9'), equal('10'),
    ];
    const hunks = splitIntoHunks(lines, 3);
    // Windows [0..6] and [4..10] overlap → merged into one
    expect(hunks).toHaveLength(1);
  });

  it('computes correct oldStart line number', () => {
    // 5 equal lines, then an insert at index 5
    const lines: DiffLine[] = [
      equal('L1'), equal('L2'), equal('L3'), equal('L4'), equal('L5'),
      insert('new line'),
      equal('L6'),
    ];
    const hunks = splitIntoHunks(lines, 1); // context=1: range [4..6]
    // Before range.start=4: 4 equal lines → oldStart = 1 + 4 = 5
    expect(hunks[0].oldStart).toBe(5);
  });

  it('computes correct newStart line number', () => {
    // 3 equal lines then a delete at index 3
    const lines: DiffLine[] = [
      equal('A'), equal('B'), equal('C'),
      del('D'),
      equal('E'),
    ];
    const hunks = splitIntoHunks(lines, 1); // range [2..4]
    // Before range.start=2: 2 equal lines → newStart = 1 + 2 = 3
    expect(hunks[0].newStart).toBe(3);
  });

  it('handles a single changed line at the start of the file', () => {
    const lines: DiffLine[] = [
      insert('first line'),
      equal('second'),
      equal('third'),
    ];
    const hunks = splitIntoHunks(lines);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].oldStart).toBe(1);
    expect(hunks[0].newStart).toBe(1);
  });

  it('handles a single changed line at the end of the file', () => {
    const lines: DiffLine[] = [
      equal('a'), equal('b'), equal('c'), equal('d'), equal('e'),
      equal('f'), equal('g'),
      del('last'),
    ];
    const hunks = splitIntoHunks(lines, 2);
    expect(hunks).toHaveLength(1);
    const lastLine = hunks[0].lines[hunks[0].lines.length - 1];
    expect(lastLine.type).toBe('delete');
  });

  it('handles contextLines=0', () => {
    const lines: DiffLine[] = [
      equal('a'), equal('b'),
      insert('new'),
      equal('c'), equal('d'),
    ];
    const hunks = splitIntoHunks(lines, 0);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines).toHaveLength(1);
    expect(hunks[0].lines[0].type).toBe('insert');
  });
});

describe('renderDiffContent()', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
  });

  it('renders "No changes" when there are no diff hunks (all equal)', () => {
    const lines: DiffLine[] = [equal('x'), equal('y')];
    renderDiffContent(container, lines);
    expect(container.textContent).toContain('No changes');
  });

  it('caps new-file (all-inserts) diffs at 20 lines', () => {
    // 25 insert lines — should only render 20 + a "more lines" separator
    const lines: DiffLine[] = Array.from({ length: 25 }, (_, i) => insert(`line ${i}`));
    renderDiffContent(container, lines);

    const prefixEls = container.querySelectorAll('.cassandra-diff-prefix');
    expect(prefixEls.length).toBe(20);

    const separator = container.querySelector('.cassandra-diff-separator');
    expect(separator).not.toBeNull();
    expect(separator?.textContent).toContain('5 more lines');
  });

  it('does NOT cap all-inserts diff when <= 20 lines', () => {
    const lines: DiffLine[] = Array.from({ length: 10 }, (_, i) => insert(`line ${i}`));
    renderDiffContent(container, lines);
    // Under the cap: rendered as normal hunks (no separator for remaining)
    // All 10 inserts are in one hunk — no separator needed between hunks
    const lineEls = container.querySelectorAll('.cassandra-diff-insert');
    expect(lineEls.length).toBe(10);
  });

  it('renders insert lines with "+" prefix', () => {
    const lines: DiffLine[] = [equal('ctx'), insert('added'), equal('ctx2')];
    renderDiffContent(container, lines);
    const insertEls = container.querySelectorAll('.cassandra-diff-insert');
    expect(insertEls.length).toBeGreaterThan(0);
    const prefix = insertEls[0].querySelector('.cassandra-diff-prefix');
    expect(prefix?.textContent).toBe('+');
  });

  it('renders delete lines with "-" prefix', () => {
    const lines: DiffLine[] = [equal('ctx'), del('removed'), equal('ctx2')];
    renderDiffContent(container, lines);
    const deleteEls = container.querySelectorAll('.cassandra-diff-delete');
    expect(deleteEls.length).toBeGreaterThan(0);
    const prefix = deleteEls[0].querySelector('.cassandra-diff-prefix');
    expect(prefix?.textContent).toBe('-');
  });

  it('renders equal lines with " " prefix', () => {
    const lines: DiffLine[] = [equal('ctx'), insert('added'), equal('ctx2')];
    renderDiffContent(container, lines);
    const equalEls = container.querySelectorAll('.cassandra-diff-equal');
    expect(equalEls.length).toBeGreaterThan(0);
    const prefix = equalEls[0].querySelector('.cassandra-diff-prefix');
    expect(prefix?.textContent).toBe(' ');
  });

  it('clears existing content on each call', () => {
    container.textContent = 'old content';
    const lines: DiffLine[] = [insert('new')];
    renderDiffContent(container, lines);
    expect(container.textContent).not.toContain('old content');
  });

  it('renders separator between multiple hunks', () => {
    // Two distant changes to force two hunks
    const lines: DiffLine[] = [
      equal('1'), equal('2'), equal('3'), equal('4'),
      insert('A'),
      equal('5'), equal('6'), equal('7'), equal('8'), equal('9'), equal('10'),
      equal('11'), equal('12'), equal('13'), equal('14'),
      del('B'),
      equal('15'), equal('16'), equal('17'),
    ];
    renderDiffContent(container, lines, 1);
    const separators = container.querySelectorAll('.cassandra-diff-separator');
    expect(separators.length).toBeGreaterThan(0);
  });

  it('renders line text content correctly', () => {
    const lines: DiffLine[] = [insert('hello world')];
    renderDiffContent(container, lines);
    const textEls = container.querySelectorAll('.cassandra-diff-text');
    const texts = Array.from(textEls).map(el => el.textContent);
    expect(texts).toContain('hello world');
  });
});
