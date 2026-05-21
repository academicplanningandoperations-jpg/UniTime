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

const WINDOW_W = 480;
const WINDOW_H = 640;

const ChatbotPanel: React.FC<Props> = ({
  isOpen, onClose, courses, faculties, rooms, groups, schedule, clashes, activeTerm,
}) => {
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages]       = useState<Message[]>([]);
  const [input, setInput]             = useState('');
  const [isLoading, setIsLoading]     = useState(false);
  const [usage, setUsage]             = useState<SessionUsage>({ totalTokens: 0, requestCount: 0 });
  const [error, setError]             = useState('');

  // Drag state
  const [pos, setPos]       = useState({ x: window.innerWidth - WINDOW_W - 12, y: 42 });
  const dragging            = useRef(false);
  const dragOffset          = useRef({ x: 0, y: 0 });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLTextAreaElement>(null);
  const aiRef          = useRef<GoogleGenAI | null>(null);

  const apiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || '').trim();

  useEffect(() => {
    if (apiKey) aiRef.current = new GoogleGenAI({ apiKey });
  }, [apiKey]);

  useEffect(() => {
    if (messages.length > 0) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen && !isMinimized) setTimeout(() => inputRef.current?.focus(), 150);
  }, [isOpen, isMinimized]);

  // Reset position to top-right when re-opened
  useEffect(() => {
    if (isOpen) setPos({ x: window.innerWidth - WINDOW_W - 12, y: 42 });
  }, [isOpen]);

  // ── Drag handlers ──────────────────────────────────────────────────────────
  const onMouseDown = (e: React.MouseEvent) => {
    // Only drag on the header bar itself, not buttons inside it
    if ((e.target as HTMLElement).closest('button')) return;
    dragging.current = true;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const newX = Math.max(0, Math.min(window.innerWidth  - WINDOW_W, e.clientX - dragOffset.current.x));
      const newY = Math.max(0, Math.min(window.innerHeight - 60,       e.clientY - dragOffset.current.y));
      setPos({ x: newX, y: newY });
    };
    const onUp = () => { dragging.current = false; };
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
        model: 'gemini-1.5-flash',
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
      const msg = err?.message || '';
      if (msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('429'))
        setError('Daily quota exceeded. Free tier: 1,500 requests/day. Try again tomorrow.');
      else if (msg.toLowerCase().includes('api key') || msg.toLowerCase().includes('invalid'))
        setError('Invalid API key. Check GEMINI_API_KEY in Vercel environment variables.');
      else
        setError(`Error: ${msg || 'Unknown error.'}`);
    } finally {
      setIsLoading(false);
    }
  }, [messages, isLoading, courses, faculties, rooms, groups, schedule, clashes, activeTerm]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  if (!isOpen || !apiKey) return null;

  const reqPct             = Math.min(100, (usage.requestCount / DAILY_REQ_LIMIT) * 100);
  const remaining          = Math.max(0, DAILY_REQ_LIMIT - usage.requestCount);
  const reqColor           = reqPct > 80 ? '#dc2626' : reqPct > 50 ? '#d97706' : '#16a34a';
  const termScheduleCount  = activeTerm ? schedule.filter(s => s.termId === activeTerm.id).length : schedule.length;

  return (
    <div
      className="fixed z-[980] flex flex-col overflow-hidden select-none"
      style={{
        left: pos.x,
        top: pos.y,
        width: WINDOW_W,
        height: isMinimized ? 'auto' : WINDOW_H,
        background: '#ffffff',
        border: '1px solid #94a3b8',
        boxShadow: '0 12px 40px rgba(0,0,0,0.22), 0 4px 12px rgba(0,0,0,0.12)',
        userSelect: 'none',
      }}
    >
      {/* ── Header (drag handle) ── */}
      <div
        onMouseDown={onMouseDown}
        className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-[#0a2d6e]"
        style={{
          background: 'linear-gradient(180deg, #1e6ad4 0%, #185baf 60%, #124a99 100%)',
          cursor: dragging.current ? 'grabbing' : 'grab',
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
            <span style={{ fontSize: 10, color: '#bfdbfe', fontWeight: 500 }}>Gemini 1.5 Flash · Free Tier</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={() => { setMessages([]); setUsage({ totalTokens: 0, requestCount: 0 }); setError(''); }}
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
                  <div className="flex items-center gap-3 mb-3">
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
                  <div className="grid grid-cols-3 gap-2 pt-3 border-t border-[#f1f5f9]">
                    {[
                      { label: 'Faculty', value: faculties.length },
                      { label: 'Rooms', value: rooms.length },
                      { label: 'Sessions', value: termScheduleCount },
                    ].map(s => (
                      <div key={s.label} className="text-center bg-[#f8fafc] border border-[#e2e8f0] py-2">
                        <p style={{ fontSize: 20, fontWeight: 900, color: '#185baf' }}>{s.value}</p>
                        <p style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          {s.label}
                        </p>
                      </div>
                    ))}
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
                {/* Avatar */}
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

                {/* Bubble */}
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
                <p style={{ fontSize: 12, color: '#dc2626', fontWeight: 500 }}>⚠ {error}</p>
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
              Enter to send · Shift+Enter for new line · Drag the header to move this window
            </p>
          </div>
        </>
      )}
    </div>
  );
};

export default ChatbotPanel;
