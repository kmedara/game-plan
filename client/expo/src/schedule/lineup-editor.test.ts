import { dropIndex, moveSlot } from './lineup-editor';

const rows = [
  { y: 0, height: 100 },
  { y: 112, height: 100 },
  { y: 224, height: 100 },
];

describe('moveSlot', () => {
  it('moves a slot down and up', () => {
    expect(moveSlot(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveSlot(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('leaves the lineup alone past either end', () => {
    expect(moveSlot(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveSlot(['a', 'b'], 1, 2)).toEqual(['a', 'b']);
  });
});

describe('dropIndex', () => {
  it('stays put until the middle of a neighbour is crossed', () => {
    expect(dropIndex(rows, 0, 50)).toBe(0);
    expect(dropIndex(rows, 0, 120)).toBe(1);
  });

  it('passes several rows in one drag', () => {
    expect(dropIndex(rows, 0, 300)).toBe(2);
    expect(dropIndex(rows, 2, -300)).toBe(0);
  });
});
