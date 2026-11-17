"""Logic tests for app.py without FastAPI/pydantic installed.

The stubs below deliberately DO run field validators and DO enforce
Literal/length constraints, because the previous version's no-op stubs let
the PII and newline bugs through a green suite. This is still not a
substitute for TestClient against the real app: install the requirements
and add HTTP-level tests before launch. What it does cover is the store,
the identity discipline, the scrubber, the locking entry points and the
auth check.
"""
import sys, types, json, os, re, tempfile, typing
from pathlib import Path

# --- stub fastapi -----------------------------------------------------------
fa = types.ModuleType("fastapi")
class HTTPException(Exception):
    def __init__(self, status_code, detail=""): self.status_code, self.detail = status_code, detail
class _App:
    def __init__(self, **kw): pass
    def get(self, *a, **k): return lambda f: f
    def post(self, *a, **k): return lambda f: f
    def middleware(self, *a, **k): return lambda f: f
    def exception_handler(self, *a, **k): return lambda f: f
class BackgroundTasks:
    def __init__(self): self.tasks = []
    def add_task(self, fn, *a, **k): self.tasks.append((fn, a, k))
fa.FastAPI, fa.HTTPException, fa.BackgroundTasks = _App, HTTPException, BackgroundTasks
fa.Depends = lambda f: f
fa.Header = lambda **kw: kw.get("default", "")
fa.Request = object
sys.modules["fastapi"] = fa
exc_mod = types.ModuleType("fastapi.exceptions")
class RequestValidationError(Exception): pass
exc_mod.RequestValidationError = RequestValidationError
sys.modules["fastapi.exceptions"] = exc_mod
resp = types.ModuleType("fastapi.responses")
class JSONResponse:
    def __init__(self, status_code=200, content=None): self.status_code, self.content = status_code, content
resp.JSONResponse = JSONResponse
sys.modules["fastapi.responses"] = resp

# --- stub pydantic (validators and constraints ACTUALLY applied) ------------
pd = types.ModuleType("pydantic")
class _FieldInfo:
    def __init__(self, default=None, **kw): self.default, self.kw = default, kw
_REQUIRED = object()
def Field(default=..., **kw): return _FieldInfo(_REQUIRED if default is ... else default, **kw)
def field_validator(*fields, **_):
    def deco(fn):
        inner = fn.__func__ if isinstance(fn, classmethod) else fn
        inner.__validates__ = fields
        return classmethod(inner)
    return deco
class ValidationError(Exception): pass
class BaseModel:
    def __init__(self, **kw):
        cls = type(self)
        hints = typing.get_type_hints(cls)
        validators = []
        for attr in vars(cls).values():
            fn = getattr(attr, "__func__", None)
            if fn is not None and hasattr(fn, "__validates__"):
                validators.append(fn)
        for name, hint in hints.items():
            declared = name in vars(cls)
            spec = vars(cls).get(name)
            info = spec if isinstance(spec, _FieldInfo) else None
            if name in kw:
                value = kw[name]
            elif info is not None:
                if info.default is _REQUIRED:
                    raise ValidationError(f"missing required field {name}")
                value = info.default
            elif declared:
                value = spec
            else:
                raise ValidationError(f"missing required field {name}")
            if value is not None and info is not None:
                if isinstance(value, str):
                    if "min_length" in info.kw and len(value) < info.kw["min_length"]:
                        raise ValidationError(f"{name} too short")
                    if "max_length" in info.kw and len(value) > info.kw["max_length"]:
                        raise ValidationError(f"{name} too long")
                    if "pattern" in info.kw and not re.fullmatch(info.kw["pattern"], value):
                        raise ValidationError(f"{name} bad pattern")
            args = typing.get_args(hint)
            literals = [a for a in args if isinstance(a, str)] if args else []
            origin_literal = typing.get_origin(hint) is typing.Literal or any(
                typing.get_origin(a) is typing.Literal for a in args
            )
            if value is not None and origin_literal:
                allowed = set()
                if typing.get_origin(hint) is typing.Literal:
                    allowed = set(typing.get_args(hint))
                for a in args:
                    if typing.get_origin(a) is typing.Literal:
                        allowed |= set(typing.get_args(a))
                if allowed and value not in allowed:
                    raise ValidationError(f"{name}={value!r} not in {sorted(allowed)}")
            for fn in validators:
                if name in fn.__validates__:
                    try:
                        value = fn(cls, value)
                    except ValueError as e:
                        raise ValidationError(str(e))
            setattr(self, name, value)
pd.BaseModel, pd.Field, pd.field_validator = BaseModel, Field, field_validator
pd.ValidationError = ValidationError
sys.modules["pydantic"] = pd

root = Path(tempfile.mkdtemp())
os.environ.update(
    HYDRA_XENIA_ROOT=str(root), XENIA_BRIDGE_TOKEN="t" * 40,
    XENIA_IDENTITY_SALT="s" * 40, XENIA_SCHEMA_VERIFIED="1",
)
import app

fails = []
def check(name, cond, extra=""):
    print(f"{'PASS' if cond else 'FAIL'}  {name}{'' if cond else '  -> ' + str(extra)}")
    if not cond: fails.append(name)

def raises(fn, status=None, exc=None):
    try:
        fn(); return False
    except HTTPException as e:
        return status is None or e.status_code == status
    except Exception as e:
        return exc is not None and isinstance(e, exc)

def load(tid):
    return json.loads((root / "hearth/tasks" / f"TICKET-{tid}.json").read_text())

# --- identity ---------------------------------------------------------------
ref = app.opaque_ref("Dana Whitfield", "313-555-0147")
check("customer_ref matches Article IV pattern", bool(app.CUSTOMER_REF_RE.match(ref)), ref)
check("customer_ref deterministic", ref == app.opaque_ref("dana whitfield", " 313-555-0147 "))
check("customer_ref unique per caller", ref != app.opaque_ref("Other Person", "313-555-0100"))
check("anonymous refs do not collide", app.opaque_ref("", "") != app.opaque_ref("", ""))

# --- scrubber ---------------------------------------------------------------
check("scrub removes email", "@" not in app.scrub("reach me at dana@lawfirm.com"))
check("scrub removes phone", "313" not in app.scrub("call 313-555-0147"))
check("scrub removes spaced phone", "555" not in app.scrub("call 3 1 3 5 5 5 0 1 4 7 now"))
check("scrub removes card", "4111" not in app.scrub("card 4111 1111 1111 1111"))
check("scrub handles html entities", "@" not in app.scrub("dana&#64;lawfirm.com"))
check("scrub keeps ordinary text", "headshots" in app.scrub("wants headshots"))

# --- id normalisation -------------------------------------------------------
check("normalize pads", app.normalize_id("123") == "000123")
check("normalize is idempotent", app.normalize_id("000123") == "000123")
check("unpadded and padded resolve to one file", app._ticket_path("123") == app._ticket_path("000123"))
check("traversal rejected", raises(lambda: app.normalize_id("../../etc/passwd"), 400))
check("empty id rejected", raises(lambda: app.normalize_id(""), 400))

# --- create -----------------------------------------------------------------
bg = fa.BackgroundTasks()
out = app.create_ticket(app.TicketCreate(
    subject="Headshots for a law firm", summary="Caller asked about headshots for twelve attorneys.",
    intent="new_inquiry", priority="P3", caller_name="Dana Whitfield", caller_contact="313-555-0147",
    shoot_type="headshots", shoot_date="mid-October", location="Southfield",
    scope="twelve attorneys on-site", sentiment="neutral", unconfirmed="Asked a per-head rate; deferred to Rob.",
), bg)
tid = out["reference"].split("-")[1]
t = load(tid)
check("create returns reference", out["reference"].startswith("TICKET-"), out)
check("create returns handle", len(out["handle"]) == 24)
check("status is open at create", t["status"] == "open", t["status"])
check("narrative lives in history[0].body like the server", t["history"][0]["body"].startswith("Caller asked"))
check("no top-level body key (server has none)", "body" not in t)
check("history keys match server (ts/actor/kind/body)", set(t["history"][0]) == {"ts","actor","kind","body"}, t["history"][0].keys())
check("created entry actor is the customer_ref", t["history"][0]["actor"] == t["customer_ref"])
check("sla carries breached flag", t["sla"]["breached"] is False)
check("sla present", "first_response_due" in t["sla"])
check("sla math correct", t["sla"]["first_response_due"] > t["created_at"])
blob = json.dumps(t).lower()
check("no raw name in ticket", "dana" not in blob)
check("no raw phone in ticket", "313-555-0147" not in blob)
check("captured details retained", "Southfield" in t["history"][0]["body"])
check("notify deferred to background", len(bg.tasks) == 1 and bg.tasks[0][0] is app.notify)

# --- PII through free text (the bug the old suite missed) -------------------
bg2 = fa.BackgroundTasks()
out2 = app.create_ticket(app.TicketCreate(
    subject="Callback", summary="Reach her on 313-555-0147 or dana@lawfirm.com about headshots.",
    intent="new_inquiry"), bg2)
t2 = load(out2["reference"].split("-")[1])
check("phone in summary is scrubbed", "313-555-0147" not in json.dumps(t2))
check("email in summary is scrubbed", "lawfirm.com" not in json.dumps(t2))
check("name in summary is rejected", raises(lambda: app.create_ticket(app.TicketCreate(
    subject="Callback", summary="Dana Whitfield wants headshots.", caller_name="Dana Whitfield"),
    fa.BackgroundTasks()), 400))

# --- validation -------------------------------------------------------------
check("bad priority rejected", raises(lambda: app.TicketCreate(subject="x", summary="y", priority="P9"), exc=pd.ValidationError))
check("bad intent rejected", raises(lambda: app.TicketCreate(subject="x", summary="y", intent="nonsense"), exc=pd.ValidationError))
check("overlong summary rejected", raises(lambda: app.TicketCreate(subject="x", summary="z" * 6001), exc=pd.ValidationError))
check("missing summary rejected", raises(lambda: app.TicketCreate(subject="x"), exc=pd.ValidationError))
check("control-only summary rejected", raises(lambda: app.TicketCreate(subject="x", summary="\x01\x02"), exc=pd.ValidationError))
check("newline in subject collapsed", app.TicketCreate(subject="a\nb", summary="ok").subject == "a b")

# --- escalation -------------------------------------------------------------
for given, want in (("P4", "P2"), ("P3", "P2"), ("P2", "P1"), ("P1", "P1")):
    r = app.create_ticket(app.TicketCreate(subject="Refund ask", summary="Wants money back.",
        intent="billing_question", priority=given, escalate=True), fa.BackgroundTasks())
    tt = load(r["reference"].split("-")[1])
    check(f"escalate lifts {given} to {want}", tt["priority"] == want, tt["priority"])
    if given == "P4":
        check("escalation recorded in history", tt["history"][-1]["kind"] == "escalation_requested")
        check("escalated ticket still opens as open", tt["status"] == "open")

# --- auto-escalation (does not trust the model's escalate flag) -------------
for intent in ("billing_question", "licensing_question", "complaint", "do_not_contact"):
    r = app.create_ticket(app.TicketCreate(subject="Money", summary="Wants a refund.",
        intent=intent, priority="P3", escalate=False), fa.BackgroundTasks())
    tt = load(r["reference"].split("-")[1])
    check(f"intent {intent} auto-escalates", tt["priority"] == "P2", tt["priority"])
    check(f"intent {intent} logs reason", tt["history"][-1]["kind"] == "escalation_requested"
          and "Auto-escalated" in tt["history"][-1]["body"])
for mood in ("angry", "frustrated"):
    r = app.create_ticket(app.TicketCreate(subject="Upset", summary="Caller is upset.",
        intent="other", priority="P3", sentiment=mood, escalate=False), fa.BackgroundTasks())
    tt = load(r["reference"].split("-")[1])
    check(f"sentiment {mood} auto-escalates", tt["priority"] == "P2", tt["priority"])
r = app.create_ticket(app.TicketCreate(subject="Calm inquiry", summary="Wants headshots.",
    intent="new_inquiry", priority="P3", sentiment="neutral", escalate=False), fa.BackgroundTasks())
tt = load(r["reference"].split("-")[1])
check("ordinary inquiry is NOT auto-escalated", tt["priority"] == "P3" and
      all(h["kind"] != "escalation_requested" for h in tt["history"]), tt["priority"])
r = app.create_ticket(app.TicketCreate(subject="Flagged", summary="Agent flagged it.",
    intent="new_inquiry", priority="P3", escalate=True), fa.BackgroundTasks())
tt = load(r["reference"].split("-")[1])
check("explicit flag still says 'flagged', not 'auto'", "flagged this for a human" in tt["history"][-1]["body"])

# --- comment scoping --------------------------------------------------------
c = app.comment_ticket(app.TicketComment(ticket_id=tid, handle=out["handle"], body="Caller rang back."))
t3 = load(tid)
check("comment appends", t3["history"][-1]["kind"] == "comment")
check("comment entry keys match server", set(t3["history"][-1]) == {"ts","actor","kind","body"})
check("comment bumps updated_at", t3["updated_at"] >= t3["created_at"])
check("comment accepts unpadded id", app.comment_ticket(app.TicketComment(
    ticket_id=str(int(tid)), handle=out["handle"], body="second note"))["ok"])
check("wrong handle 404s", raises(lambda: app.comment_ticket(app.TicketComment(
    ticket_id=tid, handle="0" * 24, body="x")), 404))
check("other ticket's handle 404s", raises(lambda: app.comment_ticket(app.TicketComment(
    ticket_id=out2["reference"].split("-")[1], handle=out["handle"], body="x")), 404))
check("missing ticket 404s", raises(lambda: app.comment_ticket(app.TicketComment(
    ticket_id="999999", handle=out["handle"], body="x")), 404))
closed = load(tid); closed["status"] = "closed"
(root / "hearth/tasks" / f"TICKET-{tid}.json").write_text(json.dumps(closed))
check("closed ticket is terminal", raises(lambda: app.comment_ticket(app.TicketComment(
    ticket_id=tid, handle=out["handle"], body="x")), 404))
check("comment PII scrubbed", "@" not in app.TicketComment(
    ticket_id=tid, handle="h" * 24, body="mail dana@lawfirm.com").body)

# --- auth -------------------------------------------------------------------
check("bad token 401", raises(lambda: app.require_token("Bearer wrong"), 401))
check("no header 401", raises(lambda: app.require_token(""), 401))
check("wrong scheme 401", raises(lambda: app.require_token("Basic " + "t" * 40), 401))
check("non-ascii header does not crash", raises(lambda: app.require_token("Bearer é"), 401))
app.require_token("Bearer " + "t" * 40)
print("PASS  correct token accepted")
saved = app._TOKEN_BYTES
app._TOKEN_BYTES = b" "
check("whitespace token treated as unconfigured", raises(lambda: app.require_token("Bearer  "), 503))
app._TOKEN_BYTES = saved
app.SCHEMA_VERIFIED = False
check("unverified schema fails closed", raises(lambda: app.require_token("Bearer " + "t" * 40), 503))
app.SCHEMA_VERIFIED = True

# --- counter integrity ------------------------------------------------------
app.COUNTER_FILE.write_text("garbage")
check("corrupt counter fails closed (no reset to zero)",
      raises(lambda: [app._next_ticket_id() for _ in "x"], 503))

# --- notify never raises ----------------------------------------------------
app.NOTIFY_TO, app.SMTP_HOST, app.SMTP_FROM = "a@b.c", "127.0.0.1", "d@e.f"
try:
    app.notify("subject\nwith newline", "body"); print("PASS  notify swallows header error")
except Exception as e:
    check("notify swallows header error", False, e)

print()
print(f"{len(fails)} failure(s)" if fails else "all checks passed")
sys.exit(1 if fails else 0)
