/** アサーション失敗時のメッセージ用に、長い文字列を切り詰める。 */
export function excerpt(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 例外値から message を取り出す。 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 生のマーカーと、JSON 文字列に 1 回・2 回埋め込んだときのエスケープ形。 */
export function markerForms(marker: string): string[] {
  const once = JSON.stringify(marker).slice(1, -1);
  const twice = JSON.stringify(once).slice(1, -1);
  return [...new Set([marker, once, twice])];
}

/** `markerForms` のいずれかが `text` に含まれるか。 */
export function containsMarker(text: string, marker: string): boolean {
  return markerForms(marker).some((form) => text.includes(form));
}
