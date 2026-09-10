// 2025-01-01_20-00-00
export function parseTime(text?: string): string {
  if (!text) {
    return '';
  }

  const ymd = text.slice(0, 10);
  const h = text.slice(11, 13);
  const i = text.slice(14, 16);
  const s = text.slice(17, 19);
  return `${ymd} ${h}:${i}:${s}`;
}
