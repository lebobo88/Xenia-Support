"""
Xenia voice-channel HTTP bridge.

A thin, least-privilege HTTP surface in front of the file-backed
`xenia-tickets` store, so a cloud voice agent (ElevenLabs) can open and
annotate tickets without being able to reach anything irreversible.

Design constraints, from the Xenia constitution and AGENTS.md:

* Intake privilege only. `create` and `comment`, nothing else. No `get`,
  `list`, `update_fields`, `recommend`, `send_response`, or
  `execute_approved`. Nothing reachable from the public internet can
  perform a monetary or irreversible action, and nothing here reads or
  enumerates the store.
* Article IV (identity discipline). Raw identity never reaches the ticket
  file: structured contact fields are hashed into an opaque
  `customer:<hash>` ref, and every free-text field is scrubbed of emails,
  phone numbers and card/SSN shapes before it is written. The raw contact
  appears only in the operator notification email.
* Fail-closed everywhere. A bad token, a corrupt counter, an unverified
  schema, or an unwritable store is an error, never a silent success.

SCHEMA. The ticket shape here was verified field-by-field against
`Hydra/mcp_servers/xenia_tickets/server.py` (create + comment + _save_ticket)
on 2026-09-07: six-digit zero-padded ids, history entries keyed
ts/actor/kind/body, the created entry's actor being the customer_ref,
and sla carrying both first_response_due and breached.

`channel` and `voice_handle` are additive keys this bridge writes and the
server ignores on load; nothing in the server rejects unknown ticket keys.

XENIA_SCHEMA_VERIFIED must still be set to 1 to run. Keep it that way: it
is the gate that forces a re-diff whenever the server's schema changes.
"""

from __future__ import annotations

import contextlib
import hashlib
import hmac
import html as _html
import json
import logging
import os
import re
import smtplib
import ssl
import unicodedata
import uuid
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Iterator, Literal

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

log = logging.getLogger("xenia.bridge")

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

XENIA_ROOT = Path(os.environ.get("HYDRA_XENIA_ROOT", ".")).resolve()
TASKS_DIR = XENIA_ROOT / "hearth" / "tasks"
COUNTER_FILE = TASKS_DIR / ".counter"
LOCK_FILE = TASKS_DIR / ".counter.lock"

BRIDGE_TOKEN = os.environ.get("XENIA_BRIDGE_TOKEN", "").strip()
_TOKEN_BYTES = BRIDGE_TOKEN.encode("utf-8")
IDENTITY_SALT = os.environ.get("XENIA_IDENTITY_SALT", "").strip()

# Set only after an operator has confirmed the written shape against the
# real xenia-tickets server. Fail-closed until then.
SCHEMA_VERIFIED = os.environ.get("XENIA_SCHEMA_VERIFIED", "") == "1"
TICKET_ID_WIDTH = int(os.environ.get("XENIA_TICKET_ID_WIDTH", "6"))

NOTIFY_TO = os.environ.get("XENIA_NOTIFY_TO", "")
SMTP_HOST = os.environ.get("XENIA_SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("XENIA_SMTP_PORT", "587"))
SMTP_USER = os.environ.get("XENIA_SMTP_USER", "")
SMTP_PASS = os.environ.get("XENIA_SMTP_PASS", "")
SMTP_FROM = os.environ.get("XENIA_SMTP_FROM", SMTP_USER)

SLA_MINUTES = {"P1": 60, "P2": 240, "P3": 480, "P4": 960}
# Escalation lifts every priority, not just P3. A P4 the agent flagged for a
# human must not sit on a sixteen-hour first-response clock.
ESCALATION_LIFT = {"P4": "P2", "P3": "P2", "P2": "P1", "P1": "P1"}

# Intents and sentiments that escalate regardless of what the agent flagged.
# Observed in testing: the model recorded a refund demand from an angry caller
# as an ordinary P3 with escalate=false, which would have put an Article V
# money case on an eight-hour first-response clock. The prompt asks for the
# flag; this does not depend on it getting the flag right.
ALWAYS_ESCALATE_INTENTS = {
    "billing_question",
    "licensing_question",
    "complaint",
    "do_not_contact",
}
ALWAYS_ESCALATE_SENTIMENTS = {"angry", "frustrated"}

CUSTOMER_REF_RE = re.compile(r"^customer:[0-9a-f]{6,}$")
MAX_BODY_BYTES = 64 * 1024

ERROR_CODES = {
    400: "INVALID_FIELD",
    401: "UNAUTHORIZED",
    404: "NOT_FOUND",
    413: "REQUEST_TOO_LARGE",
    422: "MISSING_FIELD",
    500: "INTERNAL",
    503: "UNAVAILABLE",
}

app = FastAPI(
    title="Xenia voice bridge",
    version="2.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


def _err(status: int, message: str) -> JSONResponse:
    """The typed error shape the rest of Xenia uses."""
    return JSONResponse(
        status_code=status,
        content={"ok": False, "error": {"code": ERROR_CODES.get(status, "INTERNAL"), "message": message}},
    )


# --------------------------------------------------------------------------
# Request guards
# --------------------------------------------------------------------------


@app.middleware("http")
async def cap_body(request: Request, call_next):
    """Reject oversized bodies before the body is read into memory.

    Route dependencies run after the body is buffered, so the auth check
    cannot protect against this — it has to happen in middleware. Chunked
    requests carry no Content-Length; cap those at the reverse proxy
    (`client_max_body_size 64k`), which the README lists as required.
    """
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_BODY_BYTES:
        return _err(413, "request too large")
    return await call_next(request)


def require_token(authorization: str = Header(default="")) -> None:
    """Constant-time bearer check over bytes.

    Comparing str with compare_digest raises TypeError on non-ASCII input,
    which would surface as an unauthenticated 500; bytes avoid that. A
    token under 32 chars is treated as unconfigured rather than trusted,
    so a stray whitespace value cannot become the whole perimeter.
    """
    if len(_TOKEN_BYTES) < 32 or not IDENTITY_SALT or not SCHEMA_VERIFIED:
        raise HTTPException(status_code=503, detail="bridge not configured")
    scheme, _, presented = authorization.partition(" ")
    ok = scheme.lower() == "bearer" and hmac.compare_digest(
        presented.encode("utf-8", "ignore"), _TOKEN_BYTES
    )
    if not ok:
        raise HTTPException(status_code=401, detail="unauthorized")


# --------------------------------------------------------------------------
# Identity discipline (Article IV)
# --------------------------------------------------------------------------

_PII_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.]{2,}"), "[email removed]"),
    (re.compile(r"\b(?:\d[ -]?){13,19}\b"), "[card removed]"),
    (re.compile(r"\b\d{3}[-\s.]?\d{2}[-\s.]?\d{4}\b"), "[id removed]"),
    (re.compile(r"(?:\+?\d[\s().-]{0,2}){9,15}\d"), "[phone removed]"),
]


def scrub(value: str) -> str:
    """Strip direct identifiers from free text before it is written.

    Mirrors the server's own scan: HTML-unescape and NFKC-normalise first,
    so separator-stripped and entity-encoded variants are caught too. This
    is the Layer-1 redaction `ticket-system.md` requires of the consuming
    agent — this shim is the ingestion point.
    """
    text = unicodedata.normalize("NFKC", _html.unescape(value))
    for pattern, replacement in _PII_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def opaque_ref(*parts: str) -> str:
    """Derive `customer:<hash>` from the structured identity fields.

    Salted, because the phone-number space is small enough to enumerate
    against an unsalted digest. With no salt configured we refuse rather
    than emit a weak ref.
    """
    if not IDENTITY_SALT:
        raise HTTPException(status_code=503, detail="identity salt not configured")
    material = "|".join(p.strip().lower() for p in parts if p and p.strip())
    if not material:
        material = uuid.uuid4().hex  # anonymous caller: no cross-ticket correlation
    digest = hashlib.sha256((IDENTITY_SALT + "|" + material).encode("utf-8")).hexdigest()
    return f"customer:{digest[:16]}"


# --------------------------------------------------------------------------
# Ticket store
# --------------------------------------------------------------------------


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextlib.contextmanager
def _store_lock() -> Iterator[None]:
    """Cross-process advisory lock around counter allocation.

    A threading.Lock is per-interpreter: with multiple uvicorn workers, or
    alongside the real xenia-tickets server writing the same directory,
    two creates can allocate the same id and one ticket disappears. An
    OS-level lock is the only thing both processes can see.
    """
    TASKS_DIR.mkdir(parents=True, exist_ok=True)
    with open(LOCK_FILE, "a+b") as handle:
        if os.name == "nt":
            import msvcrt

            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
            try:
                yield
            finally:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def normalize_id(raw: str) -> str:
    """One canonical id string.

    An LLM echoing "000123" back on a follow-up call will often send
    "123"; without normalisation those resolve to different filenames and
    the second call 404s.
    """
    if not re.fullmatch(r"[0-9]{1,12}", raw or ""):
        raise HTTPException(status_code=400, detail="invalid ticket_id")
    return f"{int(raw):0{TICKET_ID_WIDTH}d}"


def _ticket_path(ticket_id: str) -> Path:
    return TASKS_DIR / f"TICKET-{normalize_id(ticket_id)}.json"


def _next_ticket_id() -> str:
    """Allocate the next id. Caller must hold the store lock."""
    raw = COUNTER_FILE.read_text(encoding="utf-8").strip() if COUNTER_FILE.exists() else "0"
    try:
        current = int(raw or "0")
    except ValueError:
        # Never reset to zero: that would overwrite the oldest ticket.
        raise HTTPException(status_code=503, detail="ticket counter unreadable") from None
    nxt = current + 1
    tmp = COUNTER_FILE.with_name(".counter.tmp")
    with open(tmp, "w", encoding="utf-8") as handle:
        handle.write(str(nxt))
        handle.flush()
        os.fsync(handle.fileno())
    tmp.replace(COUNTER_FILE)
    return f"{nxt:0{TICKET_ID_WIDTH}d}"


def _write_ticket(ticket: dict[str, Any], *, create: bool) -> None:
    path = _ticket_path(ticket["ticket_id"])
    payload = json.dumps(ticket, indent=2, ensure_ascii=False)
    tmp = path.with_suffix(".json.tmp")
    try:
        if create and path.exists():
            # Id collision: another writer got there first. Never overwrite.
            raise HTTPException(status_code=503, detail="ticket id collision; retry")
        with open(tmp, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        tmp.replace(path)
    except HTTPException:
        raise
    except OSError as exc:
        log.exception("ticket write failed")
        raise HTTPException(status_code=503, detail="ticket store unavailable") from exc


def _read_ticket(ticket_id: str) -> dict[str, Any]:
    path = _ticket_path(ticket_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="ticket not found")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        log.exception("ticket read failed")
        raise HTTPException(status_code=503, detail="ticket unreadable") from exc


def _voice_handle(ticket_id: str, created: str) -> str:
    """Unguessable handle binding a comment to the call that opened it."""
    return hmac.new(_TOKEN_BYTES, f"{ticket_id}|{created}".encode("utf-8"), hashlib.sha256).hexdigest()[:24]


# --------------------------------------------------------------------------
# Operator notification
# --------------------------------------------------------------------------


def notify(subject: str, body: str) -> None:
    """Best-effort email. Runs off the request path; never raises.

    This is the only place raw caller contact appears — deliberately kept
    out of the ticket file and the audit trail.
    """
    if not (NOTIFY_TO and SMTP_HOST and SMTP_FROM):
        return
    try:
        message = EmailMessage()
        message["Subject"] = " ".join(subject.split())  # header injection / ValueError guard
        message["From"] = SMTP_FROM
        message["To"] = NOTIFY_TO
        message.set_content(body)
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=5) as smtp:
            smtp.starttls(context=ssl.create_default_context())
            if SMTP_USER:
                smtp.login(SMTP_USER, SMTP_PASS)
            smtp.send_message(message)
    except Exception:  # noqa: BLE001 - notification must never break intake
        log.warning("operator notification failed", exc_info=True)


# --------------------------------------------------------------------------
# Schemas
# --------------------------------------------------------------------------

Intent = Literal[
    "new_inquiry",
    "project_status",
    "scheduling",
    "billing_question",
    "licensing_question",
    "do_not_contact",
    "complaint",
    "other",
]

_FREE_TEXT = ("summary", "scope", "unconfirmed", "location", "shoot_type", "shoot_date")


class TicketCreate(BaseModel):
    subject: str = Field(min_length=1, max_length=200)
    summary: str = Field(min_length=1, max_length=6000)
    intent: Intent = "other"
    priority: Literal["P1", "P2", "P3", "P4"] = "P3"
    caller_name: str | None = Field(default=None, max_length=120)
    caller_contact: str | None = Field(default=None, max_length=200)
    shoot_type: str | None = Field(default=None, max_length=120)
    shoot_date: str | None = Field(default=None, max_length=120)
    location: str | None = Field(default=None, max_length=200)
    scope: str | None = Field(default=None, max_length=2000)
    sentiment: Literal["positive", "neutral", "frustrated", "angry"] | None = None
    escalate: bool = False
    unconfirmed: str | None = Field(default=None, max_length=2000)

    @field_validator("subject")
    @classmethod
    def _single_line(cls, v: str) -> str:
        collapsed = " ".join(scrub(v).split())
        if not collapsed:
            raise ValueError("subject is empty after normalisation")
        return collapsed

    @field_validator(*_FREE_TEXT)
    @classmethod
    def _clean(cls, v: str | None) -> str | None:
        if v is None:
            return None
        text = scrub("".join(ch for ch in v if ch in "\n\t" or ord(ch) >= 32)).strip()
        if not text:
            raise ValueError("field is empty after normalisation")
        return text


class TicketComment(BaseModel):
    ticket_id: str = Field(pattern=r"^[0-9]{1,12}$")
    handle: str = Field(min_length=24, max_length=24)
    body: str = Field(min_length=1, max_length=6000)

    @field_validator("body")
    @classmethod
    def _clean_body(cls, v: str) -> str:
        text = scrub(v).strip()
        if not text:
            raise ValueError("body is empty after normalisation")
        return text


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    """Unauthenticated liveness only. Configuration state is not public."""
    return {"ok": True}


@app.get("/v1/voice/status", dependencies=[Depends(require_token)])
def status() -> dict[str, Any]:
    """Authenticated readiness: actually try to write, don't ask os.access.

    os.access(W_OK) does not consult ACLs for directories on Windows,
    where this store lives, so it reports writable almost unconditionally.
    """
    writable = True
    try:
        TASKS_DIR.mkdir(parents=True, exist_ok=True)
        probe = TASKS_DIR / f".healthz-{uuid.uuid4().hex}"
        probe.write_text("", encoding="utf-8")
        probe.unlink()
    except OSError:
        writable = False
    return {"ok": True, "store_writable": writable, "schema_verified": SCHEMA_VERIFIED}


@app.post("/v1/voice/ticket", dependencies=[Depends(require_token)])
def create_ticket(payload: TicketCreate, background: BackgroundTasks) -> dict[str, Any]:
    """Open a ticket from a voice call. Intake privilege only."""
    forced = (
        payload.intent in ALWAYS_ESCALATE_INTENTS
        or payload.sentiment in ALWAYS_ESCALATE_SENTIMENTS
    )
    escalate = payload.escalate or forced
    priority = ESCALATION_LIFT[payload.priority] if escalate else payload.priority
    customer_ref = opaque_ref(payload.caller_name or "", payload.caller_contact or "")
    if not CUSTOMER_REF_RE.match(customer_ref):
        raise HTTPException(status_code=500, detail="identity derivation failed")

    body_lines = [payload.summary]
    captured = {
        "Shoot type": payload.shoot_type,
        "Date or window": payload.shoot_date,
        "Location": payload.location,
        "Scope": payload.scope,
        "Could not confirm": payload.unconfirmed,
        "Sentiment": payload.sentiment,
    }
    extras = [f"- {label}: {value}" for label, value in captured.items() if value]
    if extras:
        body_lines += ["", "## Captured on the call", *extras]
    narrative = "\n".join(body_lines)

    # The scrubber catches emails and numbers; a spoken name is not
    # pattern-matchable, so check the structured values directly. The agent
    # is told to keep identity out of the narrative — this enforces it.
    for raw in filter(None, (payload.caller_name, payload.caller_contact)):
        if raw.strip() and raw.strip().lower() in narrative.lower():
            raise HTTPException(status_code=400, detail="identity must stay in the caller fields")

    with _store_lock():
        ticket_id = _next_ticket_id()
        created = _now()
        ticket = {
            "ticket_id": ticket_id,
            "status": "open",  # Hermes moves it; create never writes a non-initial status
            "priority": priority,
            "intent": payload.intent,
            "subject": payload.subject,
            "customer_ref": customer_ref,
            "channel": "voice",
            "created_at": created,
            "updated_at": created,
            "sla": {
                "first_response_due": (
                    datetime.fromisoformat(created) + timedelta(minutes=SLA_MINUTES[priority])
                ).isoformat(),
                "breached": False,
            },
            # History entries use the server's key names: ts / actor / kind / body.
            # The created entry's actor is the customer_ref, as the server writes it.
            "history": [{"ts": created, "actor": customer_ref, "kind": "created", "body": narrative}],
            "recommendations": [],
            "voice_handle": _voice_handle(ticket_id, created),
        }
        if escalate:
            reason = (
                "Voice intake flagged this for a human."
                if payload.escalate
                else f"Auto-escalated: intent={payload.intent}, sentiment={payload.sentiment}."
            )
            ticket["history"].append(
                {
                    "ts": created,
                    "actor": "intake-router",
                    "kind": "escalation_requested",
                    "body": reason,
                }
            )
        _write_ticket(ticket, create=True)

    contact_block = (
        "\n".join(
            f"{label}: {value}"
            for label, value in (("Name", payload.caller_name), ("Contact", payload.caller_contact))
            if value
        )
        or "No contact captured."
    )
    background.add_task(
        notify,
        f"[Xenia {priority}] {'ESCALATION' if escalate else 'New'} - {payload.subject}",
        f"Ticket TICKET-{ticket_id} ({payload.intent}, {priority})\n"
        f"Opened {created} from the voice line.\n\n"
        f"{contact_block}\n\n{narrative}\n\n"
        f"Ticket file: hearth/tasks/TICKET-{ticket_id}.json\n"
        f"(Caller contact is in this email only - it is not written to the ticket.)\n",
    )

    return {
        "ok": True,
        "reference": f"TICKET-{ticket_id}",
        "handle": ticket["voice_handle"],
        "priority": priority,
        "message": "Ticket opened and routed to Rob.",
    }


@app.post("/v1/voice/comment", dependencies=[Depends(require_token)])
def comment_ticket(payload: TicketComment) -> dict[str, Any]:
    """Append a note to a ticket THIS call opened.

    The handle scopes the write. Without it a token holder could append to
    any ticket in the store and use 404-vs-200 to enumerate it, so every
    rejection returns the same 404 shape as a miss.
    """
    with _store_lock():
        ticket = _read_ticket(payload.ticket_id)
        expected = ticket.get("voice_handle", "")
        if (
            not expected
            or not hmac.compare_digest(payload.handle, expected)
            or ticket.get("channel") != "voice"
            or ticket.get("status") == "closed"  # closed is terminal: no resurrect
        ):
            raise HTTPException(status_code=404, detail="ticket not found")
        at = _now()
        ticket.setdefault("history", []).append(
            {"ts": at, "actor": "intake-router", "kind": "comment", "body": payload.body}
        )
        ticket["updated_at"] = at
        _write_ticket(ticket, create=False)
    return {"ok": True, "reference": f"TICKET-{normalize_id(payload.ticket_id)}", "message": "Note added."}


# --------------------------------------------------------------------------
# Error handling — one shape for every failure the agent can see
# --------------------------------------------------------------------------


@app.exception_handler(HTTPException)
def http_error(_: Request, exc: HTTPException) -> JSONResponse:
    return _err(exc.status_code, str(exc.detail))


@app.exception_handler(RequestValidationError)
def validation_error(_: Request, __: RequestValidationError) -> JSONResponse:
    return _err(422, "the request did not match the tool schema; shorten long fields and retry")


@app.exception_handler(Exception)
def unhandled(_: Request, __: Exception) -> JSONResponse:
    log.exception("unhandled bridge failure")
    return _err(500, "the ticket system is unavailable; tell the caller a human will follow up")
