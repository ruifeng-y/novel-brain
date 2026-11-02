export type DiffLine = {
  kind: 'same' | 'added' | 'removed';
  text: string;
};

export function diffLines(before: string, after: string): DiffLine[] {
  const left = before.split(/\r?\n/);
  const right = after.split(/\r?\n/);
  const table = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0),
  );

  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      table[leftIndex][rightIndex] =
        left[leftIndex] === right[rightIndex]
          ? table[leftIndex + 1][rightIndex + 1] + 1
          : Math.max(table[leftIndex + 1][rightIndex], table[leftIndex][rightIndex + 1]);
    }
  }

  const result: DiffLine[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      result.push({ kind: 'same', text: left[leftIndex] });
      leftIndex += 1;
      rightIndex += 1;
    } else if (table[leftIndex + 1][rightIndex] >= table[leftIndex][rightIndex + 1]) {
      result.push({ kind: 'removed', text: left[leftIndex] });
      leftIndex += 1;
    } else {
      result.push({ kind: 'added', text: right[rightIndex] });
      rightIndex += 1;
    }
  }
  while (leftIndex < left.length) {
    result.push({ kind: 'removed', text: left[leftIndex] });
    leftIndex += 1;
  }
  while (rightIndex < right.length) {
    result.push({ kind: 'added', text: right[rightIndex] });
    rightIndex += 1;
  }
  return result;
}
