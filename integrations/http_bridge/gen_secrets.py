"""Generate .env.local for the local test rig.

A separate file rather than an inline `python -c` in the .cmd, because a
batch file eats `%` before Python sees it — which silently produced an
empty .env.local and a bridge that 503'd every authenticated call.

Refuses to overwrite secrets that already look valid, so re-running the
launcher never rotates a token the ElevenLabs tool is already using.
"""

import secrets
import sys
from pathlib import Path

ENV = Path(__file__).with_name(".env.local")
MIN_LEN = 32


def existing() -> dict[str, str]:
    if not ENV.exists():
        return {}
    out = {}
    for line in ENV.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            out[key.strip()] = value.strip()
    return out


def main() -> int:
    current = existing()
    token = current.get("XENIA_BRIDGE_TOKEN", "")
    salt = current.get("XENIA_IDENTITY_SALT", "")

    regenerated = []
    if len(token) < MIN_LEN:
        token = secrets.token_urlsafe(48)
        regenerated.append("XENIA_BRIDGE_TOKEN")
    if len(salt) < MIN_LEN:
        salt = secrets.token_urlsafe(48)
        regenerated.append("XENIA_IDENTITY_SALT")

    if regenerated:
        ENV.write_text(
            f"XENIA_BRIDGE_TOKEN={token}\nXENIA_IDENTITY_SALT={salt}\n",
            encoding="utf-8",
        )
        print("Generated: " + ", ".join(regenerated))
    else:
        print("Existing secrets look valid; leaving them alone.")

    # Fail loudly rather than letting the bridge start and 503 silently.
    if len(token) < MIN_LEN or len(salt) < MIN_LEN:
        print("ERROR: secrets are still too short.", file=sys.stderr)
        return 1
    print(f"Token length: {len(token)} chars. Salt length: {len(salt)} chars.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
