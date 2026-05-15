import React, { useState } from 'react';
import { Term, UserAccount, Role } from '../types';
import { Calendar, Plus, Clock, Trash2, Edit2, CalendarDays, Sparkles, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface TermManagementProps {
  terms: Term[];
  onUpdateTerms: (terms: Term[]) => void;
  currentUser: UserAccount;
  onViewTerm?: (id: string) => void;
  viewingTermId?: string | null;
}

const TermManagement: React.FC<TermManagementProps> = ({ terms, onUpdateTerms, currentUser, onViewTerm, viewingTermId }) => {
  const isAdmin = currentUser.role === Role.ADMIN || currentUser.role === Role.SUPER_ADMIN;
  const [isAdding, setIsAdding] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingTermId, setEditingTermId] = useState<string | null>(null);

  const TERM_GRADIENTS = [
    'linear-gradient(135deg, #185baf 0%, #0891b2 100%)',
    'linear-gradient(135deg, #7c3aed 0%, #6366f1 100%)',
    'linear-gradient(135deg, #059669 0%, #0891b2 100%)',
    'linear-gradient(135deg, #d97706 0%, #ea580c 100%)',
    'linear-gradient(135deg, #e11d48 0%, #db2777 100%)',
  ];

  const initialTermState: Partial<Term> = { name: '', academicYear: '2024/25', startDate: '', endDate: '', isActive: false };
  const [formData, setFormData] = useState<Partial<Term>>(initialTermState);

  const handleToggleActive = (id: string) => {
    onUpdateTerms(terms.map(t => ({ ...t, isActive: t.id === id })));
  };

  const handleSaveTerm = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.name && formData.startDate && formData.endDate) {
      if (isEditing && editingTermId) {
        onUpdateTerms(terms.map(t => t.id === editingTermId ? { ...t, ...formData as Term } : t));
      } else {
        const term: Term = {
          id: formData.name.trim(),
          name: formData.name,
          academicYear: formData.academicYear || '2024/25',
          startDate: formData.startDate,
          endDate: formData.endDate,
          isActive: terms.length === 0
        };
        onUpdateTerms([...terms, term]);
      }
      closeModal();
    }
  };

  const openEditModal = (term: Term) => {
    setFormData({ name: term.name, academicYear: term.academicYear, startDate: term.startDate, endDate: term.endDate, isActive: term.isActive });
    setEditingTermId(term.id);
    setIsEditing(true);
    setIsAdding(true);
  };

  const closeModal = () => {
    setIsAdding(false);
    setIsEditing(false);
    setEditingTermId(null);
    setFormData(initialTermState);
  };

  const handleDeleteTerm = (id: string) => {
    if (confirm('Are you sure you want to delete this term? All related schedules may be affected.')) {
      onUpdateTerms(terms.filter(t => t.id !== id));
    }
  };

  return (
    <div className="p-4 max-w-[1200px] mx-auto min-h-screen">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mb-6 overflow-hidden relative" style={{ background: 'linear-gradient(135deg, #0c1b3a 0%, #0f2d5e 35%, #185baf 70%, #1a7fd4 100%)' }}>
        <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle at 80% 50%, rgba(255,255,255,0.06) 0%, transparent 60%)' }} />
        <div className="absolute right-0 top-0 bottom-0 w-32 opacity-[0.04]" style={{ backgroundImage: 'repeating-linear-gradient(-45deg, white 0px, white 1px, transparent 1px, transparent 12px)' }} />
        <div className="relative px-5 py-4 flex justify-between items-center">
          <div>
            <h2 className="text-[17px] font-black text-white tracking-tight flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-300" />
              Academic Terms
            </h2>
            <p className="text-[11px] text-blue-200 font-medium mt-0.5">Manage semester windows and academic year configurations</p>
          </div>
          {isAdmin && (
            <button
              onClick={() => { setIsEditing(false); setIsAdding(true); }}
              className="flex items-center gap-2 px-4 py-2 bg-white text-[#185baf] text-[11px] font-black uppercase tracking-widest hover:bg-blue-50 transition-colors shadow-sm border border-white/80"
            >
              <Plus className="w-3.5 h-3.5" /> New Term
            </button>
          )}
        </div>
      </div>

      {/* ── Term Cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {terms.map((term, idx) => {
          const isViewing = viewingTermId === term.id || (!viewingTermId && term.isActive);
          const grad = TERM_GRADIENTS[idx % TERM_GRADIENTS.length];
          return (
            <div key={term.id}
              className={`bg-white shadow-sm border overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 ${term.isActive ? 'border-[#185baf]' : 'border-[#e2e8f0]'}`}>

              {/* Card top band */}
              <div className="relative px-4 py-4" style={{ background: grad }}>
                <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: 'radial-gradient(circle at 80% 20%, white, transparent 60%)' }} />
                <div className="relative flex justify-between items-start">
                  <div className="flex-1 min-w-0">
                    {term.isActive && (
                      <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-white bg-white/20 border border-white/30 px-2 py-0.5 mb-2">
                        <Sparkles className="w-2.5 h-2.5" /> Active
                      </span>
                    )}
                    <h3 className="text-[15px] font-black text-white leading-tight truncate">{term.name}</h3>
                    <p className="text-[10px] font-bold text-white/70 uppercase tracking-widest mt-0.5">{term.academicYear}</p>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      <button onClick={() => openEditModal(term)} className="p-1.5 bg-white/10 hover:bg-white/25 text-white border border-white/20 transition-colors" title="Edit">
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button onClick={() => handleDeleteTerm(term.id)} className="p-1.5 bg-white/10 hover:bg-red-500/80 text-white border border-white/20 transition-colors" title="Delete">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Card body */}
              <div className="p-4">
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-[#f8fafc] border border-[#e2e8f0] px-3 py-2">
                    <p className="text-[9px] font-bold text-[#94a3b8] uppercase tracking-widest mb-1">Starts</p>
                    <div className="flex items-center gap-1.5 text-[#0f172a]">
                      <Clock className="w-3 h-3 text-[#185baf]" />
                      <span className="text-[12px] font-bold">{term.startDate}</span>
                    </div>
                  </div>
                  <div className="bg-[#f8fafc] border border-[#e2e8f0] px-3 py-2">
                    <p className="text-[9px] font-bold text-[#94a3b8] uppercase tracking-widest mb-1">Ends</p>
                    <div className="flex items-center gap-1.5 text-[#0f172a]">
                      <CalendarDays className="w-3 h-3 text-[#e11d48]" />
                      <span className="text-[12px] font-bold">{term.endDate}</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => onViewTerm?.(term.id)}
                    className={`w-full py-2 text-[11px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${
                      isViewing
                        ? 'text-white border border-transparent shadow-sm'
                        : 'bg-white border border-[#185baf] text-[#185baf] hover:bg-[#eff6ff]'
                    }`}
                    style={isViewing ? { background: grad } : {}}
                  >
                    {isViewing ? 'Currently Viewing' : 'View Timetable'}
                    {!isViewing && <ArrowRight className="w-3 h-3" />}
                  </button>

                  {!term.isActive && isAdmin && (
                    <button
                      onClick={() => handleToggleActive(term.id)}
                      className="w-full py-1.5 text-[10px] font-bold uppercase tracking-widest text-[#64748b] border border-[#e2e8f0] bg-[#f8fafc] hover:bg-[#f1f5f9] hover:text-[#334155] transition-colors"
                    >
                      Set as Active
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {terms.length === 0 && (
          <div className="col-span-full py-16 bg-white border border-[#e2e8f0] shadow-sm flex flex-col items-center justify-center text-center px-6">
            <div className="w-16 h-16 bg-[#eff6ff] border border-[#bfdbfe] flex items-center justify-center mb-4">
              <Calendar className="w-8 h-8 text-[#185baf]" />
            </div>
            <h3 className="text-[14px] font-black text-[#0f172a]">No Academic Terms</h3>
            <p className="text-[#64748b] max-w-xs mt-2 text-[12px] leading-relaxed">Create your first academic term to start scheduling sessions and managing resources.</p>
            {isAdmin && (
              <button
                onClick={() => { setIsEditing(false); setIsAdding(true); }}
                className="mt-5 flex items-center gap-2 px-5 py-2 text-white text-[11px] font-black uppercase tracking-widest border shadow-sm hover:opacity-90 transition-opacity"
                style={{ background: 'linear-gradient(135deg, #185baf, #0891b2)' }}
              >
                <Plus className="w-3.5 h-3.5" /> Create First Term
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Modal ──────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {isAdding && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div onClick={closeModal} className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ duration: 0.15 }}
              className="relative w-full max-w-[480px] bg-white shadow-2xl border border-[#e2e8f0] overflow-hidden"
            >
              <div className="px-4 py-3 flex justify-between items-center" style={{ background: 'linear-gradient(135deg, #0f2d5e, #185baf)' }}>
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-white" />
                  <span className="text-[12px] font-black text-white tracking-wide uppercase">
                    {isEditing ? 'Edit Academic Term' : 'New Academic Term'}
                  </span>
                </div>
                <button onClick={closeModal} className="bg-white/10 hover:bg-white/25 text-white px-2.5 py-1 font-bold text-[11px] border border-white/20 transition-colors">✕</button>
              </div>

              <form onSubmit={handleSaveTerm} className="p-5 space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-[#475569] uppercase tracking-widest">Term Name</label>
                  <input
                    type="text" placeholder="e.g. Fall Semester 2024"
                    className="w-full bg-[#f8fafc] border border-[#e2e8f0] px-3 py-2 text-[13px] text-[#0f172a] font-medium focus:border-[#185baf] focus:bg-white outline-none transition-colors"
                    value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-[#475569] uppercase tracking-widest">Academic Year</label>
                  <input
                    type="text" placeholder="e.g. 2024/25"
                    className="w-full bg-[#f8fafc] border border-[#e2e8f0] px-3 py-2 text-[13px] text-[#0f172a] font-medium focus:border-[#185baf] focus:bg-white outline-none transition-colors"
                    value={formData.academicYear} onChange={e => setFormData({...formData, academicYear: e.target.value})} required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-[#475569] uppercase tracking-widest">Start Date</label>
                    <input
                      type="date"
                      className="w-full bg-[#f8fafc] border border-[#e2e8f0] px-3 py-2 text-[13px] text-[#0f172a] font-medium focus:border-[#185baf] focus:bg-white outline-none transition-colors"
                      value={formData.startDate} onChange={e => setFormData({...formData, startDate: e.target.value})} required
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-[#475569] uppercase tracking-widest">End Date</label>
                    <input
                      type="date"
                      className="w-full bg-[#f8fafc] border border-[#e2e8f0] px-3 py-2 text-[13px] text-[#0f172a] font-medium focus:border-[#185baf] focus:bg-white outline-none transition-colors"
                      value={formData.endDate} onChange={e => setFormData({...formData, endDate: e.target.value})} required
                    />
                  </div>
                </div>

                <div className="pt-2 flex justify-end gap-2 border-t border-[#f1f5f9]">
                  <button type="button" onClick={closeModal} className="btn-secondary min-w-[80px]">Cancel</button>
                  <button type="submit" className="btn-primary min-w-[80px]">
                    {isEditing ? 'Save Changes' : 'Create Term'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default TermManagement;
