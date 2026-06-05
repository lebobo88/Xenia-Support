import type { JSX } from 'react';
import { api, type TicketResponse } from '../api.ts';
import { usePolling } from '../usePolling.ts';
import { StateGate, Badge, priorityClass, ago } from '../components.tsx';

export function TicketDetail({ id, onBack }: { id: string; onBack: () => void }): JSX.Element {
  const state = usePolling<TicketResponse>((s) => api.ticket(id, s), { deps: [id] });

  return (
    <section>
      <button className="badge accent" onClick={onBack} style={{ cursor: 'pointer', marginBottom: 16 }}>← queue</button>
      <StateGate state={state}>
        {({ ticket, decisionRecord, approvals }) => (
          <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr', alignItems: 'start' }}>
            <div>
              <div className="card">
                <h3>Ticket {ticket.ticket_id}</h3>
                <div style={{ display: 'flex', gap: 8, margin: '8px 0 14px' }}>
                  <Badge kind={priorityClass(ticket.priority)}>{ticket.priority}</Badge>
                  <Badge>{ticket.status}</Badge>
                  {ticket.intent ? <Badge>{ticket.intent}</Badge> : null}
                </div>
                <div style={{ fontSize: 15, marginBottom: 6 }}>{ticket.subject}</div>
                <div className="mono note">{ticket.customer_ref} · opened {ago(ticket.created_at)}</div>
              </div>

              <div className="section-title">History</div>
              <div className="timeline">
                {(ticket.history ?? []).map((h, i) => (
                  <div className="tl-item" key={i}>
                    <div className="tl-meta"><span>{h.kind}</span><span>{h.actor}</span><span>{ago(h.ts)}</span></div>
                    <div className="tl-body">{h.body}</div>
                  </div>
                ))}
                {(ticket.history ?? []).length === 0 ? <div className="note">no history</div> : null}
              </div>

              {(ticket.recommendations ?? []).length > 0 ? (
                <>
                  <div className="section-title">Recommendations <span className="note">(recommend-only — never executed here)</span></div>
                  {(ticket.recommendations ?? []).map((r, i) => (
                    <div className="card" key={i} style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <strong>{r.action}{r.amount ? ` · ${r.amount}` : ''}</strong>
                        <Badge kind={r.status === 'approved' ? 'ok' : 'warn'}>{r.status ?? 'pending'}</Badge>
                      </div>
                      <div className="note" style={{ marginTop: 4 }}>{r.scope} — {r.policy_basis}</div>
                    </div>
                  ))}
                </>
              ) : null}
            </div>

            <div>
              {decisionRecord ? (
                <div className="card">
                  <h3>Decision record</h3>
                  <dl className="kvs" style={{ marginTop: 8 }}>
                    <dt>terminal</dt><dd>{decisionRecord.terminal_state}</dd>
                    <dt>themis cycles</dt><dd>{decisionRecord.themis_cycle ?? '—'}</dd>
                    <dt>eunomia seal</dt><dd>{decisionRecord.eunomia_seal ?? '—'}</dd>
                    {decisionRecord.escalation?.triggered !== undefined ? (
                      <><dt>escalation</dt><dd>{decisionRecord.escalation.triggered ? 'triggered' : 'not triggered'}</dd></>
                    ) : null}
                  </dl>
                  {(decisionRecord.rubric_verdicts ?? []).length > 0 ? (
                    <div style={{ marginTop: 12 }}>
                      {decisionRecord.rubric_verdicts!.map((rv, i) => (
                        <div key={i} style={{ marginBottom: 8 }}>
                          <div style={{ fontSize: 12.5 }}>
                            <Badge kind={rv.pass ? 'ok' : 'breach'}>{rv.pass ? 'pass' : 'fail'}</Badge>{' '}
                            <span className="mono">{rv.rubric_id}</span>
                          </div>
                          {rv.dims ? (
                            <div className="dims" style={{ marginTop: 4 }}>
                              {Object.entries(rv.dims).map(([d, v]) => (
                                <span className={`dim${v === 0 ? ' zero' : ''}`} key={d}>{d}:{v}</span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {(decisionRecord.injection_findings ?? []).length > 0 ? (
                    <div style={{ marginTop: 10 }}>
                      <div className="note">injection findings</div>
                      {decisionRecord.injection_findings!.map((f, i) => (
                        <div key={i} className="mono" style={{ fontSize: 11.5, color: 'var(--warn)' }}>
                          {(f.owasp ?? []).join(', ')} — {f.disposition}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="card"><h3>Decision record</h3><div className="note" style={{ marginTop: 8 }}>none on file for this ticket</div></div>
              )}

              <div className="section-title">Approvals <span className="note">(read-only)</span></div>
              <div className="card">
                {approvals.length === 0 ? (
                  <div className="note">no approval artifacts. Monetary/irreversible actions require a human-issued
                    <code> APPROVAL-{ticket.ticket_id}-*.yaml</code> — this console cannot create or approve them (Art V).</div>
                ) : (
                  approvals.map((a) => (
                    <div key={a.approval_file} style={{ marginBottom: 8 }}>
                      <Badge kind={a.display_state === 'valid' ? 'ok' : a.display_state === 'expired' ? 'warn' : 'breach'}>{a.display_state}</Badge>{' '}
                      <span className="mono" style={{ fontSize: 12 }}>{a.action}/{a.scope}</span>
                      <div className="note">issued by {a.issued_by} · expires {a.expires_at}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </StateGate>
    </section>
  );
}
