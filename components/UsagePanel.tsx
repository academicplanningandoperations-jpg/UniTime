import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Database, Users, RefreshCcw, ExternalLink, CheckCircle2, AlertTriangle, XCircle, Table2, BarChart3 } from 'lucide-react';
import { supabase } from '../services/supabase';

// Supabase Free plan limits. Change these if the plan is upgraded.
const EGRESS_QUOTA_BYTES = 5 * 1024 ** 3;   // 5 GB uncached egress per billing cycle
const DB_QUOTA_BYTES = 500 * 1024 ** 2;     // 500 MB database
const MAU_QUOTA = 50_000;                   // monthly active users

interface UsageRow { day: string; username: string; bytes: number; requests: number; realtime_msgs: number }
interface DbStats {
  db_bytes: number;
  tables: Record<string, number>;
  per_term: { term: string; name: string; sessions: number; modules: number; faculty: number; rooms: number; cohorts: number }[];
  auth_users: number;
}

const fmtBytes = (b: number) => {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${b} B`;
};
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shortDay = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

// Good / nearly full / over — always shown with an icon and a word, not colour alone.
const statusFor = (pct: number) =>
  pct >= 100 ? { label: 'Over quota', color: '#b91c1c', bg: '#fef2f2', border: '#fecaca', Icon: XCircle }
  : pct >= 80 ? { label: 'Nearly full', color: '#b45309', bg: '#fffbeb', border: '#fde68a', Icon: AlertTriangle }
  : { label: 'OK', color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0', Icon: CheckCircle2 };

const Meter: React.FC<{ pct: number; color: string }> = ({ pct, color }) => (
  <div className="h-2 bg-[#eef2f7] rounded-full overflow-hidden" role="presentation">
    <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(pct, pct > 0 ? 1 : 0))}%`, background: color }} />
  </div>
);

const UsagePanel: React.FC = () => {
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [stats, setStats] = useState<DbStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  // Day of the month the Supabase billing cycle starts (see Supabase → Billing).
  const [cycleDay, setCycleDay] = useState<number>(() => {
    try { return Math.min(28, Math.max(1, Number(localStorage.getItem('unitime_billing_day')) || 1)); } catch { return 1; }
  });

  const load = async () => {
    if (!supabase) return;
    setLoading(true); setError('');
    const since = new Date(); since.setDate(since.getDate() - 62);
    const [u, s] = await Promise.all([
      supabase.from('usage_log').select('*').gte('day', isoDay(since)),
      supabase.rpc('db_stats'),
    ]);
    if (u.error || s.error) setError((u.error || s.error)!.message);
    setRows((u.data as UsageRow[]) || []);
    setStats((s.data as DbStats) || null);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const saveCycleDay = (d: number) => {
    setCycleDay(d);
    try { localStorage.setItem('unitime_billing_day', String(d)); } catch { /* ignore */ }
  };

  const view = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const cycleStart = new Date(today.getFullYear(), today.getMonth(), cycleDay);
    if (cycleStart > today) cycleStart.setMonth(cycleStart.getMonth() - 1);
    const cycleEnd = new Date(cycleStart); cycleEnd.setMonth(cycleEnd.getMonth() + 1);
    const startIso = isoDay(cycleStart);

    const byDay = new Map<string, { bytes: number; requests: number }>();
    const byUser = new Map<string, number>();
    let cycleBytes = 0;
    let firstLogged: string | null = null;
    for (const r of rows) {
      if (!firstLogged || r.day < firstLogged) firstLogged = r.day;
      const d = byDay.get(r.day) || { bytes: 0, requests: 0 };
      d.bytes += Number(r.bytes); d.requests += Number(r.requests);
      byDay.set(r.day, d);
      if (r.day >= startIso) {
        cycleBytes += Number(r.bytes);
        byUser.set(r.username, (byUser.get(r.username) || 0) + Number(r.bytes));
      }
    }
    const days: { day: string; bytes: number; requests: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const k = isoDay(d);
      days.push({ day: k, ...(byDay.get(k) || { bytes: 0, requests: 0 }) });
    }
    const elapsedDays = Math.max(1, Math.round((today.getTime() - cycleStart.getTime()) / 86400000) + 1);
    const cycleDays = Math.round((cycleEnd.getTime() - cycleStart.getTime()) / 86400000);
    const countedFrom = firstLogged && firstLogged > startIso ? firstLogged : startIso;
    const countedDays = Math.max(1, Math.round((today.getTime() - new Date(countedFrom + 'T00:00:00').getTime()) / 86400000) + 1);
    const projected = (cycleBytes / countedDays) * cycleDays;
    const users = Array.from(byUser, ([username, bytes]) => ({ username, bytes })).sort((a, b) => b.bytes - a.bytes);
    return {
      cycleStart, cycleEnd, cycleBytes, projected, users, days,
      daysLeft: cycleDays - elapsedDays + 1,
      partial: !!firstLogged && firstLogged > startIso, firstLogged,
      maxDay: Math.max(1, ...days.map(d => d.bytes)),
    };
  }, [rows, cycleDay]);

  const egressPct = (view.cycleBytes / EGRESS_QUOTA_BYTES) * 100;
  const projPct = (view.projected / EGRESS_QUOTA_BYTES) * 100;
  const dbPct = stats ? (stats.db_bytes / DB_QUOTA_BYTES) * 100 : 0;
  const eStatus = statusFor(Math.max(egressPct, projPct >= 100 ? 80 : 0));
  const dStatus = statusFor(dbPct);
  const ref = (import.meta as any).env?.VITE_SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  const dashboardUrl = ref ? `https://supabase.com/dashboard/project/${ref}` : 'https://supabase.com/dashboard';
  const tables = stats ? Object.entries(stats.tables || {}).sort((a, b) => b[1] - a[1]) : [];

  const Tile: React.FC<{ title: string; icon: React.ReactNode; status?: ReturnType<typeof statusFor>; children: React.ReactNode }> = ({ title, icon, status, children }) => (
    <div className="bg-white border border-[#e2e8f0] p-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-[#475569]">{icon}{title}</span>
        {status && (
          <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wide px-1.5 py-0.5 border"
            style={{ color: status.color, background: status.bg, borderColor: status.border }}>
            <status.Icon className="w-3 h-3" />{status.label}
          </span>
        )}
      </div>
      {children}
    </div>
  );

  return (
    <div className="bg-[#f8fafc] border border-[#c8ddf8] shadow-sm mb-6">
      <div className="text-white px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap" style={{ background: 'linear-gradient(135deg, #0f3d8c, #185baf)' }}>
        <h3 className="font-bold text-[13px] uppercase tracking-wide flex items-center gap-2"><Activity className="w-4 h-4" /> Database &amp; Usage</h3>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading} className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase bg-white/10 hover:bg-white/25 border border-white/30 disabled:opacity-50">
            <RefreshCcw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <a href={dashboardUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase bg-white text-[#185baf] hover:bg-blue-50">
            Exact figures in Supabase <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {error && <div className="mx-4 mt-3 px-3 py-2 text-[12px] font-bold bg-[#fef2f2] border border-[#fecaca] text-[#b91c1c]">Couldn't load usage: {error}</div>}

      <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <Tile title="Egress this cycle (estimate)" icon={<Activity className="w-3.5 h-3.5" />} status={eStatus}>
          <div className="text-[22px] font-black text-[#0f172a] leading-none">≈ {fmtBytes(view.cycleBytes)}
            <span className="text-[12px] font-bold text-[#64748b]"> of {fmtBytes(EGRESS_QUOTA_BYTES)}</span></div>
          <Meter pct={egressPct} color={eStatus.color} />
          <div className="text-[11px] text-[#475569] leading-snug">
            <b>{fmtBytes(Math.max(0, EGRESS_QUOTA_BYTES - view.cycleBytes))}</b> remaining · {view.daysLeft} day{view.daysLeft === 1 ? '' : 's'} left in cycle<br />
            At this pace: <b>≈ {fmtBytes(view.projected)}</b> by {view.cycleEnd.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            {projPct >= 100 && <span className="text-[#b91c1c] font-bold"> — would exceed the quota</span>}
          </div>
        </Tile>

        <Tile title="Database size" icon={<Database className="w-3.5 h-3.5" />} status={stats ? dStatus : undefined}>
          <div className="text-[22px] font-black text-[#0f172a] leading-none">{stats ? fmtBytes(stats.db_bytes) : '—'}
            <span className="text-[12px] font-bold text-[#64748b]"> of {fmtBytes(DB_QUOTA_BYTES)}</span></div>
          <Meter pct={dbPct} color={dStatus.color} />
          <div className="text-[11px] text-[#475569] leading-snug">
            Largest: {tables.slice(0, 3).map(([t, b]) => `${t} ${fmtBytes(b)}`).join(' · ') || '—'}
          </div>
        </Tile>

        <Tile title="Team logins" icon={<Users className="w-3.5 h-3.5" />}>
          <div className="text-[22px] font-black text-[#0f172a] leading-none">{stats?.auth_users ?? '—'}
            <span className="text-[12px] font-bold text-[#64748b]"> of {MAU_QUOTA.toLocaleString()} allowed</span></div>
          <div className="text-[11px] text-[#475569] leading-snug">
            Billing cycle starts on day&nbsp;
            <select value={cycleDay} onChange={e => saveCycleDay(Number(e.target.value))} className="border border-[#cbd5e1] text-[11px] font-bold px-1">
              {Array.from({ length: 28 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            &nbsp;of the month (see Supabase → Billing).
          </div>
        </Tile>
      </div>

      {view.partial && (
        <div className="mx-4 mb-3 px-3 py-2 text-[11px] bg-[#eff6ff] border border-[#bfdbfe] text-[#1e3a8a]">
          Counting started on {shortDay(view.firstLogged!)}, so this cycle's total is missing the days before that. Use “Exact figures in Supabase” for the full number this month.
        </div>
      )}

      {/* Daily egress — one series, so the title names it and no legend is needed */}
      <div className="mx-4 mb-4 bg-white border border-[#e2e8f0] p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-black uppercase tracking-widest text-[#475569]">Estimated egress per day — last 30 days</span>
          <button onClick={() => setAsTable(v => !v)} className="flex items-center gap-1 text-[10px] font-bold uppercase text-[#185baf] hover:underline">
            {asTable ? <><BarChart3 className="w-3 h-3" /> Chart</> : <><Table2 className="w-3 h-3" /> Table</>}
          </button>
        </div>
        {asTable ? (
          <div className="max-h-56 overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead><tr className="text-left text-[#64748b]"><th className="py-1">Day</th><th>Egress</th><th>Requests</th></tr></thead>
              <tbody>{[...view.days].reverse().map(d => (
                <tr key={d.day} className="border-t border-[#f1f5f9]"><td className="py-1">{shortDay(d.day)}</td><td>{fmtBytes(d.bytes)}</td><td>{d.requests}</td></tr>
              ))}</tbody>
            </table>
          </div>
        ) : (
          <div className="relative">
            <div className="flex items-end h-32 gap-[2px] border-b border-[#cbd5e1]" onMouseLeave={() => setHover(null)}>
              {view.days.map((d, i) => (
                <div key={d.day} className="flex-1 h-full flex items-end cursor-default" onMouseEnter={() => setHover(i)}>
                  <div className="w-full rounded-t-[4px]"
                    style={{ height: `${(d.bytes / view.maxDay) * 100}%`, minHeight: d.bytes > 0 ? 2 : 0, background: hover === i ? '#0f3d8c' : '#185baf' }} />
                </div>
              ))}
            </div>
            {hover !== null && (
              <div className="absolute -top-2 px-2 py-1 bg-[#0f172a] text-white text-[10px] font-bold pointer-events-none whitespace-nowrap"
                style={{ left: `${Math.min(80, (hover / 30) * 100)}%` }}>
                {shortDay(view.days[hover].day)} · {fmtBytes(view.days[hover].bytes)} · {view.days[hover].requests} requests
              </div>
            )}
            <div className="flex justify-between text-[9px] text-[#94a3b8] font-bold mt-1">
              <span>{shortDay(view.days[0].day)}</span>
              <span>peak {fmtBytes(view.maxDay)}</span>
              <span>today</span>
            </div>
          </div>
        )}
      </div>

      <div className="mx-4 mb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-white border border-[#e2e8f0] p-4">
          <div className="text-[10px] font-black uppercase tracking-widest text-[#475569] mb-2">Who used it this cycle</div>
          {view.users.length === 0 ? <p className="text-[11px] text-[#94a3b8]">No usage recorded yet.</p> : view.users.map(u => (
            <div key={u.username} className="flex items-center gap-2 py-1 text-[11px]">
              <span className="w-24 truncate font-bold text-[#0f172a]">@{u.username}</span>
              <div className="flex-1"><Meter pct={view.cycleBytes ? (u.bytes / view.cycleBytes) * 100 : 0} color="#185baf" /></div>
              <span className="w-16 text-right text-[#475569]">{fmtBytes(u.bytes)}</span>
            </div>
          ))}
        </div>
        <div className="bg-white border border-[#e2e8f0] p-4 overflow-x-auto">
          <div className="text-[10px] font-black uppercase tracking-widest text-[#475569] mb-2">Records per term</div>
          <table className="w-full text-[11px]">
            <thead><tr className="text-left text-[#64748b]"><th className="py-1">Term</th><th>Sessions</th><th>Modules</th><th>Faculty</th><th>Rooms</th><th>Cohorts</th></tr></thead>
            <tbody>{(stats?.per_term || []).map(t => (
              <tr key={t.term} className="border-t border-[#f1f5f9]">
                <td className="py-1 font-bold">{t.name}</td><td>{t.sessions}</td><td>{t.modules}</td><td>{t.faculty}</td><td>{t.rooms}</td><td>{t.cohorts}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      <p className="px-4 pb-3 text-[10px] text-[#64748b] leading-snug">
        Egress is estimated by each team member's app (compressed data received from Supabase, plus live updates) and reported every few minutes.
        It reads slightly low; Supabase's own dashboard has the exact, billed figure. Database size and record counts are exact.
      </p>
    </div>
  );
};

export default UsagePanel;
