/**
 * tests/server/scaffold.test.ts — P0 scaffold invariants.
 *
 * The campaign's foundational security claims, asserted from day zero:
 *   - the write allowlist is EMPTY BY CONSTRUCTION (read-only v1, Art V)
 *   - P2 will extend this suite with the full bridge-security bar
 *     (loopback/CSRF/whitelist/envelope-injection/redaction pen-check),
 *     mirroring AgentMesh web/tests/server/bridge-security.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { WRITE_TOOLS } from '../../server/index.js';

describe('P0 scaffold invariants', () => {
  it('write allowlist is empty by construction (read-only v1, support-constitution Art V)', () => {
    expect(WRITE_TOOLS).toHaveLength(0);
    expect(Object.isFrozen(WRITE_TOOLS)).toBe(true);
  });
});
