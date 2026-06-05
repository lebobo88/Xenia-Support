/**
 * server/whitelist.ts — frozen read-tool allowlist + forbidden-verb denylist.
 *
 * UI-SPEC §3 (P1, HITL-approved): exactly 7 read tools; the write allowlist
 * is EMPTY BY CONSTRUCTION (support-constitution Art V). The denylist is
 * defense-in-depth: write-shaped verbs are rejected even if a future edit
 * mistakenly whitelists one.
 */

export const READ_TOOLS: readonly string[] = Object.freeze([
  'xenia-tickets.list',
  'xenia-tickets.get',
  'xenia-tickets.ping',
  'xenia-kb.list',
  'xenia-kb.search',
  'xenia-kb.get',
  'xenia-kb.ping',
]);

export const WRITE_TOOLS: readonly string[] = Object.freeze([]);

/** Write-shaped verbs — never callable through this bridge, whitelist or not. */
const FORBIDDEN_SUBSTRINGS: readonly string[] = Object.freeze([
  '.create',
  '.comment',
  '.update',
  '.send',
  '.recommend',
  '.execute',
  '.delete',
  '.write',
  '.ack',
  '.approve',
  '.purge',
]);

export function allowTool(name: string): boolean {
  if (!READ_TOOLS.includes(name)) return false;
  return !FORBIDDEN_SUBSTRINGS.some((verb) => name.includes(verb));
}
