export function correctNum(num: number, min: number, max: number) {
  return Math.max(min, Math.min(max, num));
}
