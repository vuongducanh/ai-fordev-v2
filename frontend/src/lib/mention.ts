import type { Agent } from "./api";

/**
 * Checks if the cursor is currently inside a `@mention` word and returns the query.
 * E.g., returns "re" if user has typed "@re" and cursor is at the end.
 */
export function getMentionQuery(text: string, cursorIndex: number): string | null {
  const beforeCursor = text.slice(0, cursorIndex);
  const lastAt = beforeCursor.lastIndexOf("@");
  
  if (lastAt === -1) return null;

  // Verify that there are no spaces or newlines between the '@' symbol and the cursor
  const segment = beforeCursor.slice(lastAt + 1);
  if (/\s/.test(segment)) {
    return null;
  }

  // Also make sure it's the start of a word or follows whitespace
  if (lastAt > 0 && !/\s/.test(beforeCursor[lastAt - 1])) {
    return null;
  }

  return segment;
}

/**
 * Filters living (enabled and installed) agents that match the mention query.
 */
export function filterCandidates(query: string, agents: Agent[]): Agent[] {
  const q = query.toLowerCase();
  return agents.filter(
    (a) =>
      a.enabled &&
      a.installed &&
      (a.id.toLowerCase().includes(q) || a.card.name.toLowerCase().includes(q))
  );
}
