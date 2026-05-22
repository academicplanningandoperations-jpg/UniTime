import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Send, Minimize2, Bot, User, ChevronUp, RotateCcw, Sparkles, GripHorizontal } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';
import type { Course, Faculty, Room, StudentGroup, ScheduleEntry, Clash, Term } from '../types';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  tokens?: number;
}

interface SessionUsage {
  totalTokens: number;
  requestCount: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  courses: Course[];
  faculties: Faculty[];
  rooms: Room[];
  groups: StudentGroup[];
  schedule: ScheduleEntry[];
  clashes: Clash[];
  activeTerm?: Term;
}

const DAILY_REQ_LIMIT = 1500;
const MIN_W = 340;
const MIN_H = 380;
const DEFAULT_W = 480;
const DEFAULT_H = 640;

const SUGGESTIONS = [
  'How many sessions are scheduled this term?',
  'Which faculty has the most sessions?',
  'Are there any scheduling clashes?',
  'Which rooms are most used?',
  'How do I use the auto-scheduler?',
  'How do I resolve a faculty clash?',
  'What is the CSV format for auto-scheduling?',
  'What cohorts are in the system?',
];

// ── Markdown renderer ────────────────────────────────────────────────────────

function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i} className="font-semibold text-[#0f172a]">{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={i} style={{ background: '#f1f5f9', padding: '1px 5px', color: '#0891b2', fontSize: 12, fontFamily: 'monospace', border: '1px solid #e2e8f0', borderRadius: 3 }}>{part.slice(1, -1)}</code>;
    if (part.startsWith('*') && part.endsWith('*'))
      return <em key={i} style={{ color: '#475569' }}>{part.slice(1, -1)}</em>;
    return <span key={i}>{part}</span>;
  });
}

function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  lines.forEach((line, i) => {
    if (line.startsWith('### '))
      nodes.push(<p key={i} style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginTop: 8, marginBottom: 2 }}>{line.slice(4)}</p>);
    else if (line.startsWith('## '))
      nodes.push(<p key={i} style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginTop: 8, marginBottom: 2 }}>{line.slice(3)}</p>);
    else if (line.startsWith('# '))
      nodes.push(<p key={i} style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginTop: 8, marginBottom: 4 }}>{line.slice(2)}</p>);
    else if (line.startsWith('- ') || line.startsWith('* '))
      nodes.push(
        <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, lineHeight: 1.6, color: '#334155', marginTop: 2 }}>
          <span style={{ color: '#185baf', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>•</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>
      );
    else if (/^\d+\.\s/.test(line)) {
      const m = line.match(/^(\d+)\.\s(.*)$/);
      if (m) nodes.push(
        <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, lineHeight: 1.6, color: '#334155', marginTop: 2 }}>
          <span style={{ color: '#185baf', fontWeight: 700, flexShrink: 0 }}>{m[1]}.</span>
          <span>{renderInline(m[2])}</span>
        </div>
      );
    } else if (line.trim() === '')
      nodes.push(<div key={i} style={{ height: 6 }} />);
    else
      nodes.push(<p key={i} style={{ fontSize: 13, lineHeight: 1.65, color: '#334155', marginTop: 2 }}>{renderInline(line)}</p>);
  });
  return <div>{nodes}</div>;
}

// ── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(
  courses: Course[], faculties: Faculty[], rooms: Room[],
  groups: StudentGroup[], schedule: ScheduleEntry[], clashes: Clash[], activeTerm?: Term
): string {
  const termSchedule = activeTerm ? schedule.filter(s => s.termId === activeTerm.id) : schedule;
  const facultyLoad  = faculties.slice(0, 40).map(f => {
    const n = termSchedule.filter(s => s.facultyId === f.id).length;
    return `${(f as any)._Faculty_name || f.name}(${n}sessions)`;
  }).join(', ');
  const roomUsage = rooms.slice(0, 20).map(r => {
    const n = termSchedule.filter(s => s.roomId === r.id).length;
    return `${(r as any)._unique_name || r.name}(${n}bookings)`;
  }).join(', ');

  return `You are UniTime Assistant — an intelligent AI helper built into UniTime, a university timetable management system.

ACTIVE TERM: ${activeTerm?.name || 'None'} ${activeTerm ? `(${activeTerm.startDate} → ${activeTerm.endDate})` : ''}

STATISTICS:
- Modules: ${courses.length} | Faculty: ${faculties.length} | Rooms: ${rooms.length} | Cohorts: ${groups.length}
- Sessions (this term): ${termSchedule.length} | Clashes: ${clashes.length > 0 ? `${clashes.length} (${[...new Set(clashes.map(c => c.type))].join(', ')})` : 'None'}

MODULES: ${courses.slice(0, 40).map(c => `${(c as any)._unique_name || c.code}:${(c as any)._name || c.name}`).join('; ')}
FACULTY: ${faculties.slice(0, 40).map(f => (f as any)._Faculty_name || f.name).join(', ')}
ROOMS: ${rooms.map(r => `${(r as any)._unique_name || r.name}(${r.type},cap:${r.capacity})`).join(', ')}
COHORTS: ${groups.slice(0, 40).map(g => (g as any)._unique_name || g.name).join(', ')}
FACULTY LOAD: ${facultyLoad}
ROOM USAGE: ${roomUsage}

Help with: timetable questions, faculty workload, room availability, clash resolution, auto-scheduler CSV format, block columns, unresolved session debugging, and general UniTime usage.
Be concise, professional, and helpful. Use markdown formatting for clarity.`;
}

// ── Component ────────────────────────────────────────────────────────────────

const ChatbotPanel: React.FC<Props> = ({
  isOpen, onClose, courses, faculties, rooms, groups, schedule, clashes, activeTerm,
}) => {
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages]       = useState<Message[]>([]);
  const [input, setInput]             = useState('');
  const [isLoading, setIsLoading]     = useState(false);
  const [usage, setUsage]             = useState<SessionUsage>(() => {
    try {
      const stored = localStorage.getItem('unitime_chat_usage');
      if (stored) {
        const parsed = JSON.parse(stored);
        const today = new Date().toDateString();
        if (parsed.date === today) {
          return {
            totalTokens: parsed.totalTokens || 0,
            requestCount: parsed.requestCount || 0,
          };
        }
      }
    } catch (e) {
      console.error('Failed to load chat usage from localStorage', e);
    }
    return { totalTokens: 0, requestCount: 0 };
  });
  const [error, setError]             = useState('');

  // Save usage to localStorage whenever it changes
  useEffect(() => {
    try {
      const today = new Date().toDateString();
      localStorage.setItem('unitime_chat_usage', JSON.stringify({
        date: today,
        totalTokens: usage.totalTokens,
        requestCount: usage.requestCount,
      }));
    } catch (e) {
      console.error('Failed to save chat usage to localStorage', e);
    }
  }, [usage]);

  // Position and size state
  const [pos, setPos]   = useState({ x: window.innerWidth - DEFAULT_W - 12, y: 42 });
  const [size, setSize] = useState({ w: DEFAULT_W, h: DEFAULT_H });

  // Refs to track current values inside effects
  const sizeRef = useRef(size);
  useEffect(() => { sizeRef.current = size; }, [size]);

  // Drag refs
  const dragging    = useRef(false);
  const dragOffset  = useRef({ x: 0, y: 0 });

  // Resize refs
  const resizing     = useRef(false);
  const resizeEdge   = useRef('');
  const resizeStart  = useRef({ mouseX: 0, mouseY: 0, w: 0, h: 0, px: 0, py: 0 });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLTextAreaElement>(null);
  const aiRef          = useRef<GoogleGenAI | null>(null);

  // Try import.meta.env first (standard Vite — works reliably on Vercel),
  // then fall back to define-replaced process.env values
  const apiKey = (
    (import.meta.env as Record<string, string>).GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.API_KEY ||
    ''
  ).trim();

  useEffect(() => {
    if (apiKey) aiRef.current = new GoogleGenAI({ apiKey });
  }, [apiKey]);

  useEffect(() => {
    if (messages.length > 0) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen && !isMinimized) setTimeout(() => inputRef.current?.focus(), 150);
  }, [isOpen, isMinimized]);

  // Reset position and size when re-opened
  useEffect(() => {
    if (isOpen) {
      setSize({ w: DEFAULT_W, h: DEFAULT_H });
      setPos({ x: window.innerWidth - DEFAULT_W - 12, y: 42 });
    }
  }, [isOpen]);

  // ── Drag handler ──────────────────────────────────────────────────────────
  const onDragMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragging.current = true;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  };

  // ── Resize handler ────────────────────────────────────────────────────────
  const onResizeMouseDown = (edge: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    resizing.current = true;
    resizeEdge.current = edge;
    resizeStart.current = { mouseX: e.clientX, mouseY: e.clientY, w: size.w, h: size.h, px: pos.x, py: pos.y };
  };

  // ── Global mouse move / up ────────────────────────────────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragging.current) {
        const w = sizeRef.current.w;
        const newX = Math.max(0, Math.min(window.innerWidth - w, e.clientX - dragOffset.current.x));
        const newY = Math.max(0, Math.min(window.innerHeight - 60, e.clientY - dragOffset.current.y));
        setPos({ x: newX, y: newY });
      } else if (resizing.current) {
        const { mouseX, mouseY, w, h, px, py } = resizeStart.current;
        const dx = e.clientX - mouseX;
        const dy = e.clientY - mouseY;
        const edge = resizeEdge.current;
        let newW = w, newH = h, newX = px, newY = py;
        if (edge.includes('e')) newW = Math.max(MIN_W, w + dx);
        if (edge.includes('s')) newH = Math.max(MIN_H, h + dy);
        if (edge.includes('w')) { newW = Math.max(MIN_W, w - dx); newX = px + (w - newW); }
        if (edge.includes('n')) { newH = Math.max(MIN_H, h - dy); newY = py + (h - newH); }
        setSize({ w: newW, h: newH });
        setPos({ x: newX, y: newY });
      }
    };
    const onUp = () => { dragging.current = false; resizing.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  // ── Send message ───────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading || !aiRef.current) return;
    setError('');
    setIsMinimized(false);

    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: text.trim(), timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const history = [...messages, userMsg].map(m => ({
        role: m.role === 'assistant' ? 'model' as const : 'user' as const,
        parts: [{ text: m.content }],
      }));

      const response = await aiRef.current.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: history,
        config: {
          systemInstruction: buildSystemPrompt(courses, faculties, rooms, groups, schedule, clashes, activeTerm),
          maxOutputTokens: 1024,
          temperature: 0.7,
        },
      });

      const responseText = response.text || 'Sorry, I could not generate a response.';
      const tokenCount   = (response.usageMetadata as any)?.totalTokenCount || 0;

      setUsage(prev => ({ totalTokens: prev.totalTokens + tokenCount, requestCount: prev.requestCount + 1 }));
      setMessages(prev => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: responseText, timestamp: new Date(), tokens: tokenCount }]);
    } catch (err: any) {
      const raw = err?.message || '';
      let friendly = '';

      // Try to parse structured API error JSON embedded in the message
      try {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          const apiErr = parsed?.error;
          if (apiErr) {
            const code = apiErr.code;
            const details = apiErr.details || [];
            const retryInfo = details.find((d: any) => d['@type']?.includes('RetryInfo'));
            const retryDelay = retryInfo?.retryDelay?.replace('s', '') || '';
            const quotaViolations = details.find((d: any) => d['@type']?.includes('QuotaFailure'))?.violations || [];
            const isZeroLimit = quotaViolations.some((v: any) => v.quotaMetric?.includes('free_tier'));

            if (code === 429) {
              if (isZeroLimit) {
                friendly = 'Free tier quota unavailable for this API key. This usually means the key belongs to a Google Workspace (university/work) account. Create a new key at aistudio.google.com using a personal Gmail account.';
              } else if (retryDelay) {
                friendly = `Rate limit hit. Please wait ${retryDelay} seconds and try again.`;
              } else {
                friendly = 'Daily quota exceeded (1,500 req/day on free tier). Try again tomorrow.';
              }
            } else if (code === 404) {
              friendly = 'Gemini model not found. Check the model name or try again later.';
            } else if (code === 403) {
              friendly = 'API key invalid or lacks permission. Check GEMINI_API_KEY in Vercel settings.';
            } else {
              friendly = `API error (${code}): ${apiErr.message?.split('\n')[0]?.slice(0, 120) || 'Unknown error'}`;
            }
          }
        }
      } catch (_) { /* JSON parse failed, fall through */ }

      if (!friendly) {
        const lower = raw.toLowerCase();
        if (lower.includes('quota') || lower.includes('429')) friendly = 'Quota exceeded. Please wait and try again.';
        else if (lower.includes('api key') || lower.includes('invalid') || lower.includes('403')) friendly = 'Invalid API key. Check GEMINI_API_KEY in Vercel settings.';
        else friendly = 'Error communicating with Gemini. Please try again.';
      }

      setError(friendly);
    } finally {
      setIsLoading(false);
    }
  }, [messages, isLoading, courses, faculties, rooms, groups, schedule, clashes, activeTerm]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  if (!isOpen) return null;

  // No API key configured — show setup instructions instead of silently hiding
  if (!apiKey) return (
    <div
      className="fixed z-[980] flex flex-col overflow-hidden"
      style={{ left: pos.x, top: pos.y, width: 400, background: '#ffffff', border: '1px solid #94a3b8', boxShadow: '0 12px 40px rgba(0,0,0,0.22)' }}
    >
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#0a2d6e]" style={{ background: 'linear-gradient(180deg,#1e6ad4 0%,#185baf 60%,#124a99 100%)' }}>
        <Sparkles className="w-4 h-4 text-yellow-300" />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'white' }}>UniTime AI Assistant</span>
        <button onClick={onClose} className="ml-auto p-1 text-white/60 hover:text-white"><X className="w-4 h-4" /></button>
      </div>
      <div className="p-5 space-y-3">
        <p style={{ fontSize: 13, fontWeight: 700, color: '#dc2626' }}>⚠ API Key Not Configured</p>
        <p style={{ fontSize: 12, color: '#334155', lineHeight: 1.6 }}>
          The AI Assistant requires a Gemini API key. To set it up:
        </p>
        <ol style={{ fontSize: 12, color: '#334155', lineHeight: 1.8, paddingLeft: 16 }}>
          <li>Go to <strong>aistudio.google.com</strong> (sign in with personal Gmail)</li>
          <li>Click <strong>Get API key → Create API key</strong></li>
          <li>In Vercel → Project → <strong>Settings → Environment Variables</strong></li>
          <li>Add <code style={{ background: '#f1f5f9', padding: '1px 4px', fontSize: 11 }}>GEMINI_API_KEY</code> = your key (tick <strong>Production</strong>)</li>
          <li>Go to <strong>Deployments → Redeploy</strong></li>
        </ol>
      </div>
    </div>
  );

  const reqPct    = Math.min(100, (usage.requestCount / DAILY_REQ_LIMIT) * 100);
  const remaining = Math.max(0, DAILY_REQ_LIMIT - usage.requestCount);
  const reqColor  = reqPct > 80 ? '#dc2626' : reqPct > 50 ? '#d97706' : '#16a34a';

  return (
    <div
      className="fixed z-[980] flex flex-col overflow-hidden select-none"
      style={{
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: isMinimized ? 'auto' : size.h,
        background: '#ffffff',
        border: '1px solid #94a3b8',
        boxShadow: '0 12px 40px rgba(0,0,0,0.22), 0 4px 12px rgba(0,0,0,0.12)',
        userSelect: 'none',
      }}
    >
      {/* ── Resize handles (edges + corners) ── */}
      {!isMinimized && (
        <>
          <div onMouseDown={onResizeMouseDown('e')}  style={{ position: 'absolute', right: 0,  top: 10, bottom: 10, width: 5, cursor: 'ew-resize', zIndex: 20 }} />
          <div onMouseDown={onResizeMouseDown('w')}  style={{ position: 'absolute', left: 0,   top: 10, bottom: 10, width: 5, cursor: 'ew-resize', zIndex: 20 }} />
          <div onMouseDown={onResizeMouseDown('s')}  style={{ position: 'absolute', bottom: 0, left: 10, right: 10, height: 5, cursor: 'ns-resize', zIndex: 20 }} />
          <div onMouseDown={onResizeMouseDown('se')} style={{ position: 'absolute', bottom: 0, right: 0, width: 14, height: 14, cursor: 'se-resize', zIndex: 21 }} />
          <div onMouseDown={onResizeMouseDown('sw')} style={{ position: 'absolute', bottom: 0, left: 0,  width: 14, height: 14, cursor: 'sw-resize', zIndex: 21 }} />
          <div onMouseDown={onResizeMouseDown('ne')} style={{ position: 'absolute', top: 0,    right: 0, width: 14, height: 14, cursor: 'ne-resize', zIndex: 21 }} />
          <div onMouseDown={onResizeMouseDown('nw')} style={{ position: 'absolute', top: 0,    left: 0,  width: 14, height: 14, cursor: 'nw-resize', zIndex: 21 }} />
          {/* Visual grip dots at bottom-right */}
          <div style={{ position: 'absolute', bottom: 3, right: 3, pointerEvents: 'none', zIndex: 22, display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
            {[0,1,2].map(r => (
              <div key={r} style={{ display: 'flex', gap: 2 }}>
                {Array.from({ length: 3 - r }).map((_, c) => (
                  <div key={c} style={{ width: 3, height: 3, borderRadius: '50%', background: '#cbd5e1' }} />
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Header (drag handle) ── */}
      <div
        onMouseDown={onDragMouseDown}
        className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-[#0a2d6e]"
        style={{
          background: 'linear-gradient(180deg, #1e6ad4 0%, #185baf 60%, #124a99 100%)',
          cursor: 'grab',
        }}
      >
        <GripHorizontal className="w-4 h-4 text-white/40 shrink-0" />
        <div className="w-8 h-8 flex items-center justify-center shrink-0 bg-white/20 border border-white/30">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p style={{ fontSize: 13, fontWeight: 900, color: 'white', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            UniTime AI Assistant
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <div className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse" />
            <span style={{ fontSize: 10, color: '#bfdbfe', fontWeight: 500 }}>Gemini 2.0 Flash · Free Tier</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={() => {
                setMessages([]);
                setUsage({ totalTokens: 0, requestCount: 0 });
                setError('');
              }}
              title="Clear chat"
              className="p-2 text-white/60 hover:text-white hover:bg-white/15 transition-all rounded"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => setIsMinimized(m => !m)}
            title={isMinimized ? 'Expand' : 'Minimise'}
            className="p-2 text-white/60 hover:text-white hover:bg-white/15 transition-all rounded"
          >
            {isMinimized ? <ChevronUp className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
          </button>
          <button
            onClick={onClose}
            title="Close"
            className="p-2 text-white/60 hover:text-red-300 hover:bg-white/15 transition-all rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {/* ── Usage bar ── */}
          <div className="shrink-0 px-4 py-2.5 border-b border-[#e2e8f0] bg-[#f8fafc]">
            <div className="flex items-center justify-between mb-1.5">
              <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Daily Quota
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: reqColor }}>
                {remaining.toLocaleString()} requests remaining
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden bg-[#e2e8f0]">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${reqPct}%`, background: `linear-gradient(90deg, ${reqColor}bb, ${reqColor})` }}
              />
            </div>
            <div className="flex justify-between mt-1.5">
              <span style={{ fontSize: 10, color: '#94a3b8' }}>
                {usage.requestCount} used · {usage.totalTokens.toLocaleString()} tokens this session
              </span>
              <span style={{ fontSize: 10, color: '#94a3b8' }}>1,500 / day free</span>
            </div>
          </div>

          {/* ── Messages ── */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-[#f8fafc]" style={{ userSelect: 'text' }}>

            {messages.length === 0 && (
              <div className="flex flex-col gap-4">
                {/* Welcome card */}
                <div className="bg-white border border-[#e2e8f0] p-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 flex items-center justify-center bg-[#185baf] shrink-0">
                      <Sparkles className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <p style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        Ask Me Anything
                      </p>
                      <p style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                        I have full context of your live timetable
                      </p>
                    </div>
                  </div>
                </div>

                {/* Suggestions */}
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                    Suggested Questions
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTIONS.map(q => (
                      <button
                        key={q}
                        onClick={() => sendMessage(q)}
                        className="px-3 py-1.5 text-left bg-white border border-[#bfdbfe] hover:bg-[#eff6ff] hover:border-[#185baf] transition-all"
                        style={{ fontSize: 12, color: '#185baf', lineHeight: 1.4 }}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {messages.map(msg => (
              <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div
                  className="w-8 h-8 shrink-0 flex items-center justify-center mt-0.5"
                  style={{
                    background: msg.role === 'user' ? '#185baf' : '#f1f5f9',
                    border: msg.role === 'assistant' ? '1px solid #e2e8f0' : 'none',
                  }}
                >
                  {msg.role === 'user'
                    ? <User className="w-4 h-4 text-white" />
                    : <Bot className="w-4 h-4 text-[#185baf]" />
                  }
                </div>

                <div className={`flex flex-col gap-1 max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div
                    className="px-4 py-3"
                    style={msg.role === 'user' ? {
                      background: 'linear-gradient(135deg, #1e6ad4, #185baf)',
                    } : {
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
                    }}
                  >
                    {msg.role === 'user'
                      ? <p style={{ fontSize: 13, lineHeight: 1.6, color: 'white', whiteSpace: 'pre-wrap' }}>{msg.content}</p>
                      : renderMarkdown(msg.content)
                    }
                  </div>
                  <span style={{ fontSize: 10, color: '#94a3b8', padding: '0 4px' }}>
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {msg.tokens ? ` · ${msg.tokens.toLocaleString()} tokens` : ''}
                  </span>
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {isLoading && (
              <div className="flex gap-3">
                <div className="w-8 h-8 flex items-center justify-center bg-[#f1f5f9] border border-[#e2e8f0]">
                  <Bot className="w-4 h-4 text-[#185baf]" />
                </div>
                <div className="px-4 py-3 bg-white border border-[#e2e8f0] flex items-center gap-1.5 shadow-sm">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="w-2 h-2 rounded-full bg-[#185baf]"
                      style={{ animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />
                  ))}
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="px-4 py-3 bg-[#fef2f2] border border-[#fecaca]">
                <p style={{ fontSize: 12, color: '#dc2626', fontWeight: 600, lineHeight: 1.5 }}>⚠ {error}</p>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* ── Input ── */}
          <div className="shrink-0 p-3 border-t border-[#e2e8f0] bg-white">
            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about timetable, faculty, rooms, clashes…"
                rows={2}
                disabled={isLoading}
                className="flex-1 resize-none border border-[#cbd5e1] focus:outline-none focus:border-[#185baf] transition-colors bg-[#f8fafc] disabled:opacity-50"
                style={{ fontSize: 13, color: '#0f172a', padding: '10px 12px', maxHeight: 100 }}
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || isLoading}
                className="flex items-center justify-center transition-all disabled:opacity-30 hover:opacity-90 active:scale-95 shrink-0"
                style={{ background: 'linear-gradient(135deg, #1e6ad4, #185baf)', width: 44, height: 44 }}
              >
                <Send className="w-4 h-4 text-white" />
              </button>
            </div>
            <p style={{ fontSize: 10, color: '#cbd5e1', marginTop: 6 }}>
              Enter to send · Shift+Enter for new line · Drag header to move · Drag edges/corners to resize
            </p>
          </div>
        </>
      )}
    </div>
  );
};

export default ChatbotPanel;
