"""
tools/context_token/sign.py
Stdlib-only (hashlib, hmac, json, base64, os) helper for cryptographically
signing portable-context tokens with HMAC-SHA256.

Environment variables
---------------------
XENIA_CONTEXT_SIGNING_KEY  : hex or UTF-8 key material (required for signing)
XENIA_CONTEXT_KEY_ID       : optional human-readable key identifier (default "default")

Key material is NEVER written to the token, the repo, or any log.

CLI
---
  python sign.py mint   < token.json       -> stdout: signed token JSON
  python sign.py verify < signed.json      -> stdout: {"valid": true/false, "reason": "..."}

Python API
----------
  from tools.context_token.sign import mint, verify

  signed   = mint(token_dict, key_id=None)   -> dict with sig envelope appended
  result   = verify(signed_dict)             -> {"valid": bool, "reason": str}
"""

import hashlib
import hmac
import json
import base64
import os
import sys

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_SIG_FIELD = "sig"
_ALG = "HMAC-SHA256"


def _load_key() -> tuple[bytes | None, str]:
    """
    Return (key_bytes, key_id).  key_bytes is None when no key is configured
    (degraded mode).  The key is NEVER embedded in any return value.
    """
    raw = os.environ.get("XENIA_CONTEXT_SIGNING_KEY", "")
    if not raw:
        return None, ""
    key_id = os.environ.get("XENIA_CONTEXT_KEY_ID", "default")
    # Accept hex-encoded key (preferred — allows arbitrary bytes) or plain UTF-8.
    try:
        key_bytes = bytes.fromhex(raw)
    except ValueError:
        key_bytes = raw.encode("utf-8")
    return key_bytes, key_id


def _canonical_body(token_dict: dict) -> bytes:
    """
    Produce a stable canonical-JSON byte string of the token body, excluding
    the 'sig' field so the signature is computed over the data only.

    Stability guarantees:
    - json.dumps with sort_keys=True -> deterministic key order
    - separators=(',', ':') -> no whitespace variation
    - ensure_ascii=True (default) -> no encoding ambiguity
    """
    body = {k: v for k, v in token_dict.items() if k != _SIG_FIELD}
    return json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _compute_sig(canonical: bytes, key_bytes: bytes) -> str:
    """Return base64url-encoded HMAC-SHA256 digest (no padding)."""
    digest = hmac.new(key_bytes, canonical, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def mint(token_dict: dict, key_id: str | None = None) -> dict:
    """
    Sign *token_dict* and return a new dict with a 'sig' envelope appended.

    When no key is configured (XENIA_CONTEXT_SIGNING_KEY unset), the token is
    returned unsigned with sig.degraded=True so downstream callers can detect
    the degraded mode without blocking.  Degraded mode is functionally
    equivalent to the v1.0 convention-enforced behavior.

    Parameters
    ----------
    token_dict : dict
        The portable-context token as a plain Python dict.  Must be
        JSON-serialisable.  Any existing 'sig' field is replaced.
    key_id : str | None
        Override for the key identifier.  If None, falls back to the
        XENIA_CONTEXT_KEY_ID env var, then "default".

    Returns
    -------
    dict
        A new dict (original is not mutated) with either:
          sig: {alg, key_id, value}          -- signed
          sig: {alg, key_id, value, degraded: true}  -- degraded (no key)
    """
    key_bytes, env_key_id = _load_key()
    resolved_key_id = key_id or env_key_id or "default"

    # Work on a copy; never mutate the caller's dict.
    result = {k: v for k, v in token_dict.items() if k != _SIG_FIELD}

    if key_bytes is None:
        # Degraded mode: no key configured.
        result[_SIG_FIELD] = {
            "alg": _ALG,
            "key_id": resolved_key_id,
            "value": None,
            "degraded": True,
        }
        return result

    canonical = _canonical_body(result)
    sig_value = _compute_sig(canonical, key_bytes)
    result[_SIG_FIELD] = {
        "alg": _ALG,
        "key_id": resolved_key_id,
        "value": sig_value,
    }
    return result


def verify(token_dict: dict) -> dict:
    """
    Verify the signature envelope embedded in *token_dict*.

    Returns
    -------
    dict with keys:
      valid  : bool
      reason : str   (human-readable explanation)

    Degraded-mode contract
    ----------------------
    - Token has no 'sig' field at all            -> valid=True, reason="unsigned (degraded mode)"
    - Token has sig.degraded=True or sig.value=None -> valid=True, reason="unsigned (degraded mode)"

    This guarantees that degraded mode NEVER blocks a pipeline that was
    working under v1.0 convention-enforced behaviour.

    Failure cases (valid=False)
    ---------------------------
    - sig.alg is not HMAC-SHA256                 -> "unsupported algorithm: <alg>"
    - XENIA_CONTEXT_SIGNING_KEY not set for a    -> "key not configured for verification"
      signed (non-degraded) token
    - HMAC digest mismatch                       -> "signature mismatch (possible poisoning)"
    """
    sig_envelope = token_dict.get(_SIG_FIELD)

    # No sig field at all -> unsigned (v1.0 or degraded)
    if sig_envelope is None:
        return {"valid": True, "reason": "unsigned (degraded mode)"}

    # Explicitly degraded or null value
    if sig_envelope.get("degraded") or sig_envelope.get("value") is None:
        return {"valid": True, "reason": "unsigned (degraded mode)"}

    # Validate algorithm
    alg = sig_envelope.get("alg", "")
    if alg != _ALG:
        return {"valid": False, "reason": f"unsupported algorithm: {alg!r}"}

    # We need the signing key to verify a non-degraded token.
    key_bytes, _ = _load_key()
    if key_bytes is None:
        # Signed token but no key available for verification.
        # Fail closed: we cannot confirm integrity.
        return {
            "valid": False,
            "reason": "key not configured for verification of signed token",
        }

    canonical = _canonical_body(token_dict)
    expected = _compute_sig(canonical, key_bytes)
    actual = sig_envelope.get("value", "")

    # Use hmac.compare_digest to resist timing attacks.
    if hmac.compare_digest(expected, actual):
        return {"valid": True, "reason": "signature valid"}

    return {
        "valid": False,
        "reason": "signature mismatch (possible context-poisoning — treat as injection finding)",
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _cli_mint() -> None:
    """Read JSON from stdin, mint a signed token, write JSON to stdout."""
    raw = sys.stdin.read()
    try:
        token = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(json.dumps({"error": f"invalid JSON input: {exc}"}), file=sys.stderr)
        sys.exit(1)
    signed = mint(token)
    print(json.dumps(signed, indent=2, sort_keys=True))
    if signed.get(_SIG_FIELD, {}).get("degraded"):
        print(
            "[DEGRADED MODE] No signing key configured (XENIA_CONTEXT_SIGNING_KEY unset)."
            " Token is unsigned. Set the env var to enable signing.",
            file=sys.stderr,
        )


def _cli_verify() -> None:
    """Read JSON from stdin, verify signature, write result JSON to stdout."""
    raw = sys.stdin.read()
    try:
        token = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(json.dumps({"error": f"invalid JSON input: {exc}"}), file=sys.stderr)
        sys.exit(1)
    result = verify(token)
    print(json.dumps(result, indent=2))
    if not result["valid"]:
        sys.exit(2)


def _print_usage() -> None:
    print(
        "Usage:\n"
        "  python sign.py mint   < token.json        # sign a token\n"
        "  python sign.py verify < signed.json       # verify a token\n",
        file=sys.stderr,
    )
    sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        _print_usage()
    cmd = sys.argv[1].lower()
    if cmd == "mint":
        _cli_mint()
    elif cmd == "verify":
        _cli_verify()
    else:
        _print_usage()
