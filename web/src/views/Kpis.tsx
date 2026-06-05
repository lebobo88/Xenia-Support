import type { JSX } from 'react';
import { api, type KpiSnapshot } from '../api.ts';
import { usePolling } from '../usePolling.ts';
import { StateGate, pct, num } from '../components.tsx';

export function Kpis(): JSX.Element {
  const state = usePolling<KpiSnapshot>((s) => api.kpi(s), { isEmpty: (d) => d.total_runs === 0 });

  return (
    <StateGate state={state} emptyLabel="No runs in range — KPIs populate once DecisionRecords exist.">
      {(k) => (
        <div>
          {/* coverage honesty banner — cost is NEVER shown without a coverage
              statement (anti-Goodhart). The null case (no resolutions in range)
              gets its own banner rather than being silently omitted. */}
          {k.cost_coverage_pct === null ? (
            <div className="banner warn" role="note" style={{ marginBottom: 16 }}>
              ⚠ No resolutions in range — cost-per-resolution is unavailable (0 coverage).
            </div>
          ) : k.cost_coverage_pct < 80 ? (
            <div className="banner warn" role="note" style={{ marginBottom: 16 }}>
              ⚠ Cost coverage {pct(k.cost_coverage_pct / 100)} — cost figures below are partial (only {k.cost_coverage_n}/{k.cost_coverage_denom} resolutions carry a cost).
            </div>
          ) : (
            <div className="banner ok" role="note" style={{ marginBottom: 16 }}>
              ✓ Cost coverage {pct(k.cost_coverage_pct / 100)} ({k.cost_coverage_n}/{k.cost_coverage_denom} resolutions).
            </div>
          )}

          {/* anti-Goodhart paired card */}
          <div className="card" style={{ marginBottom: 14 }}>
            <h3>Containment — paired with false-deflection (anti-Goodhart)</h3>
            <div className="metric-pair" style={{ marginTop: 8 }}>
              <div>
                <div className="metric-val">{pct(k.containment_rate)}</div>
                <div className="metric-sub">containment · {k.containment_num}/{k.containment_denom} runs resolved</div>
              </div>
              <div>
                <div className="metric-val" style={{ color: (k.false_deflection_rate ?? 0) > 0 ? 'var(--breach)' : 'var(--ok)' }}>{pct(k.false_deflection_rate)}</div>
                <div className="metric-sub">false-deflection · {k.false_deflection_checks} judged</div>
              </div>
              <div>
                <div className="metric-val small">{pct(k.grounding_rate)}</div>
                <div className="metric-sub">grounding · {k.grounding_checks} judged</div>
              </div>
            </div>
          </div>

          <div className="grid metric-grid">
            <Metric title="SLA attainment" val={pct(k.sla_attainment)} sub={`ok ${k.sla_ok} · warn ${k.sla_warn} · breach ${k.sla_breach}`} />
            <Metric title="AHT (first response)" val={k.aht_median_mins === null ? '—' : `${num(k.aht_median_mins, 1)}m`} sub={`median · mean ${num(k.aht_mean_mins, 1)}m · n=${k.aht_samples}`} />
            <Metric title="FCR (proxy)" val={pct(k.fcr_rate)} sub={`${k.fcr_pass}/${k.fcr_eligible} resolved`} />
            <Metric title="Escalation precision" val={pct(k.escalation_precision)} sub={`${k.warranted_esc}/${k.total_escalations} warranted`} />
            <Metric title="Cost / resolution" val={k.cost_per_resolution === null ? '—' : `$${num(k.cost_per_resolution, 3)}`} sub={`coverage ${pct((k.cost_coverage_pct ?? 0) / 100)}`} />
            <Metric title="KB gap velocity" val={String(k.kb_gap_filed)} sub="filed in range" />
          </div>

          {k.tier_laundering_flags.length > 0 ? (
            <>
              <div className="section-title">Tier-laundering flags</div>
              <div className="card">
                {k.tier_laundering_flags.map((f, i) => (
                  <div key={i} className="mono" style={{ fontSize: 12.5, color: 'var(--warn)' }}>
                    {f.agent}: expected {f.expected_tier}, ran {f.actual_tier}
                  </div>
                ))}
              </div>
            </>
          ) : null}

          <div className="section-title">Worst runs by rubric score</div>
          <div className="card" style={{ padding: 0 }}>
            <table className="table">
              <thead><tr><th>Ticket</th><th>Terminal state</th><th>Score</th></tr></thead>
              <tbody>
                {k.worst_3.map((w) => (
                  <tr key={w.ticket_id}><td className="mono">{w.ticket_id}</td><td>{w.terminal_state}</td><td className="mono">{num(w.score, 2)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="section-title">Per-intent breakdown</div>
          <div className="card" style={{ padding: 0 }}>
            <table className="table">
              <thead><tr><th>Intent</th><th>Total</th><th>Resolved</th><th>Escalated</th><th>SLA ok/breach</th></tr></thead>
              <tbody>
                {Object.entries(k.intent_stats).map(([intent, s]) => (
                  <tr key={intent}>
                    <td>{intent}</td><td className="mono">{s.total}</td><td className="mono">{s.resolved}</td>
                    <td className="mono">{s.escalated}</td><td className="mono">{s.sla_ok}/{s.sla_breach}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </StateGate>
  );
}

function Metric({ title, val, sub }: { title: string; val: string; sub: string }): JSX.Element {
  return (
    <div className="card">
      <h3>{title}</h3>
      <div className="metric-val small">{val}</div>
      <div className="metric-sub">{sub}</div>
    </div>
  );
}
