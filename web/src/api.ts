/**
 * src/api.ts — typed client for the bridge endpoints (UI-SPEC §4).
 * All data is already redacted server-side (Layer 4). The UI renders it as-is.
 */

export interface Health {
  ok: boolean;
  service: string;
  phase: string;
  writeTools: number;
  children: { tickets: unknown; kb: unknown };
  estate: { events: number; decisionRecords: number; approvals: number };
}

export interface QueueRow {
  ticket_id?: string;
  status?: string;
  priority?: string;
  intent?: string;
  customer_ref?: string;
  subject?: string;
  created_at?: string;
  sla_due?: string;
  sla_remaining_min?: number | null;
  sla_window_min?: number | null;
  breached?: boolean;
}
export interface QueueResponse { tickets: QueueRow[]; count: number }

export interface HistoryEntry { ts?: string; actor?: string; kind?: string; body?: string }
export interface Recommendation { action?: string; scope?: string; amount?: number; policy_basis?: string; status?: string }
export interface TicketFull {
  ticket_id?: string; status?: string; priority?: string; intent?: string;
  customer_ref?: string; subject?: string; created_at?: string;
  sla?: { first_response_due?: string; breached?: boolean };
  history?: HistoryEntry[]; recommendations?: Recommendation[];
}
export interface RubricVerdict { rubric_id?: string; pass?: boolean; dims?: Record<string, number>; seal?: string }
export interface DecisionRecordView {
  terminal_state?: string; themis_cycle?: number; eunomia_seal?: string;
  rubric_verdicts?: RubricVerdict[];
  escalation?: { triggered?: boolean; trigger?: string };
  injection_findings?: Array<{ ref?: string; owasp?: string[]; disposition?: string }>;
  source_file?: string;
}
export interface ApprovalView {
  approval_file: string; status?: string; action?: string; scope?: string;
  issued_by?: string; expires_at?: string; display_state: string;
}
export interface TicketResponse { ticket: TicketFull; decisionRecord: DecisionRecordView | null; approvals: ApprovalView[] }

export interface KpiSnapshot {
  total_runs: number;
  containment_rate: number | null; containment_num: number; containment_denom: number;
  false_deflection_rate: number | null; false_deflection_checks: number;
  grounding_rate: number | null; grounding_checks: number;
  sla_attainment: number | null; sla_ok: number; sla_warn: number; sla_breach: number; sla_total: number;
  sla_by_severity: Record<string, { ok: number; warn: number; breach: number }>;
  aht_median_mins: number | null; aht_mean_mins: number | null; aht_samples: number;
  fcr_rate: number | null; fcr_eligible: number; fcr_pass: number;
  escalation_precision: number | null; total_escalations: number; warranted_esc: number;
  cost_per_resolution: number | null; cost_coverage_pct: number | null; cost_coverage_n: number; cost_coverage_denom: number;
  cost_by_tier: Record<string, number[]>;
  tier_laundering_flags: Array<{ agent: string; expected_tier: string; actual_tier: string }>;
  kb_gap_filed: number;
  worst_3: Array<{ ticket_id: string; terminal_state: string; score: number }>;
  open_hitl_ticket_ids: string[];
  intent_stats: Record<string, { total: number; resolved: number; escalated: number; sla_ok: number; sla_breach: number; cost_samples: number[] }>;
}

export interface KbDoc { doc_id?: string; title?: string; as_of_date?: string; topic_class?: string; stale?: boolean }
export interface KbHealth { docs: KbDoc[]; doc_count: number; index_fresh: boolean | null; kb_gap_filed: number }

export interface HitlItem { ticket_id: string; ts?: string; severity?: string; agent?: string; age_hours: number | null; age_band: string; trigger?: string }
export interface HitlResponse { items: HitlItem[]; count: number }

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, signal ? { signal } : {});
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  health: (s?: AbortSignal) => get<Health>('/api/health', s),
  queue: (q = '', s?: AbortSignal) => get<QueueResponse>(`/api/queue${q}`, s),
  ticket: (id: string, s?: AbortSignal) => get<TicketResponse>(`/api/ticket/${encodeURIComponent(id)}`, s),
  kpi: (s?: AbortSignal) => get<KpiSnapshot>('/api/kpi/snapshot', s),
  kb: (s?: AbortSignal) => get<KbHealth>('/api/kb/health', s),
  hitl: (s?: AbortSignal) => get<HitlResponse>('/api/hitl/aged', s),
};
