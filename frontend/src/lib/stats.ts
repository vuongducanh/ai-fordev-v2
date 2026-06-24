export interface Stats {
  tokens: number;
  prompt_tokens?: number;
  seconds: number;
  gen_seconds: number;
  tps: number;
  exact: boolean;
}

/**
 * Estimates token counts and generation speeds based on stream timestamps.
 * 
 * @param chunks Array of received text delta segments.
 * @param t0 Timestamp when the first token chunk arrived (ms).
 * @param tLast Timestamp when the last token chunk arrived (ms).
 * @param reqStart Timestamp when the HTTP request was sent (ms).
 * @param now Current timestamp (ms).
 */
export function estimateStats(
  chunks: string[],
  t0: number,
  tLast: number,
  reqStart: number,
  now: number
): Stats {
  const text = chunks.join("");
  
  // Basic heuristic: split by spaces for words, or fall back to character ratio
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const tokens = Math.max(wordCount, Math.ceil(text.length / 4.0));

  const totalDuration = (now - reqStart) / 1000.0;
  // Generation duration is the time elapsed between first and last tokens
  const genDuration = t0 > 0 ? (tLast - t0) / 1000.0 : totalDuration;
  
  const finalTotalDuration = Math.max(totalDuration, 0.05);
  const finalGenDuration = Math.max(genDuration, 0.05);
  
  const tps = tokens / finalGenDuration;

  return {
    tokens: Math.round(tokens),
    seconds: parseFloat(finalTotalDuration.toFixed(2)),
    gen_seconds: parseFloat(finalGenDuration.toFixed(2)),
    tps: parseFloat(tps.toFixed(2)),
    exact: false
  };
}
