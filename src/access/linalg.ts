/**
 * Solve (AᵀA + diag(penalty)) W = AᵀY for W: ridge regression with a separate
 * penalty per column. Small systems only (a dozen unknowns), so plain Gaussian
 * elimination with partial pivoting is plenty.
 *
 * @param rows    one design row per sample
 * @param targets one target row per sample (any number of outputs)
 * @param penalty one non-negative penalty per design column
 * @returns weights as [column][output]
 */
export function ridgeSolve(rows: number[][], targets: number[][], penalty: number[]): number[][] {
  const n = penalty.length;
  const outputs = targets[0]?.length ?? 0;
  const lhs = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? penalty[i] : 0)));
  const rhs = Array.from({ length: n }, () => new Array<number>(outputs).fill(0));
  for (let s = 0; s < rows.length; s++) {
    const row = rows[s];
    const target = targets[s];
    for (let i = 0; i < n; i++) {
      const ri = row[i];
      if (ri === 0) continue;
      for (let j = 0; j < n; j++) lhs[i][j] += ri * row[j];
      for (let k = 0; k < outputs; k++) rhs[i][k] += ri * target[k];
    }
  }

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(lhs[r][col]) > Math.abs(lhs[pivot][col])) pivot = r;
    if (Math.abs(lhs[pivot][col]) < 1e-12) {
      // A column with no information and no penalty: leave its weight at zero.
      lhs[col][col] = 1;
      for (let k = 0; k < outputs; k++) rhs[col][k] = 0;
      continue;
    }
    if (pivot !== col) {
      [lhs[col], lhs[pivot]] = [lhs[pivot], lhs[col]];
      [rhs[col], rhs[pivot]] = [rhs[pivot], rhs[col]];
    }
    const diagonal = lhs[col][col];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = lhs[r][col] / diagonal;
      if (factor === 0) continue;
      for (let j = col; j < n; j++) lhs[r][j] -= factor * lhs[col][j];
      for (let k = 0; k < outputs; k++) rhs[r][k] -= factor * rhs[col][k];
    }
  }
  return rhs.map((row, i) => row.map((value) => value / lhs[i][i]));
}

export function dot(a: number[], weights: number[][], output: number): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * weights[i][output];
  return sum;
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
