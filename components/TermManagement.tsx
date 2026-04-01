import React, { useState } from 'react';
import { Term, UserAccount, Role } from '../types';
import { Calendar, Plus, CheckCircle2, AlertCircle, Clock, Trash2, Edit2, X, CalendarDays } from 'lucide-react';
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

  const initialTermState: Partial<Term> = {
    name: '',
    academicYear: '2024/25',
    startDate: '',
    endDate: '',
    isActive: false
  };

  const [formData, setFormData] = useState<Partial<Term>>(initialTermState);

  const handleToggleActive = (id: string) => {
    const updatedTerms = terms.map(t => ({
      ...t,
      isActive: t.id === id
    }));
    onUpdateTerms(updatedTerms);
  };

  const handleSaveTerm = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.name && formData.startDate && formData.endDate) {
      if (isEditing && editingTermId) {
        const updatedTerms = terms.map(t => 
          t.id === editingTermId 
            ? { ...t, ...formData as Term } 
            : t
        );
        onUpdateTerms(updatedTerms);
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
    setFormData({
      name: term.name,
      academicYear: term.academicYear,
      startDate: term.startDate,
      endDate: term.endDate,
      isActive: term.isActive
    });
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
    <div className="space-y-6 p-2">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b-2 border-[#185baf] pb-2">
        <div>
          <h2 className="text-xl font-bold text-[#333] tracking-tight">Academic Terms</h2>
          <p className="text-sm font-medium text-[#666]">Manage semester windows and academic year configurations.</p>
        </div>
        {isAdmin && (
          <button 
            onClick={() => { setIsEditing(false); setIsAdding(true); }}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Add Academic Term</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {terms.map((term) => (
          <div 
            key={term.id}
            className={`relative bg-white border border-[#ccc] transition-all duration-300 ${
              term.isActive ? 'border-l-4 border-l-[#185baf]' : ''
            }`}
          >
            {term.isActive && (
              <div className="bg-[#185baf] text-white text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 inline-block m-2">
                Active Session
              </div>
            )}

            <div className="p-4 space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-bold text-[#333]">{term.name}</h3>
                  <p className="text-xs font-bold text-[#666] uppercase tracking-wider">{term.academicYear}</p>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-1 opacity-100">
                    <button 
                      onClick={() => openEditModal(term)}
                      className="p-1 hover:bg-[#e0e0e0] text-[#333] transition-colors btn-secondary"
                      title="Edit Term"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button 
                      onClick={() => handleDeleteTerm(term.id)}
                      className="p-1 hover:bg-red-50 text-[#ac2925] transition-colors btn-secondary"
                      title="Delete Term"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 py-3 border-y border-[#eee]">
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-[#666] uppercase tracking-widest">Starts</p>
                  <div className="flex items-center gap-2 text-[#333] font-bold text-sm">
                    <Clock className="w-3 h-3 text-[#185baf]" />
                    {term.startDate}
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-[#666] uppercase tracking-widest">Ends</p>
                  <div className="flex items-center gap-2 text-[#333] font-bold text-sm">
                    <CalendarDays className="w-3 h-3 text-[#ac2925]" />
                    {term.endDate}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <button 
                  onClick={() => onViewTerm?.(term.id)}
                  className={`w-full py-1.5 text-sm font-bold border ${
                    viewingTermId === term.id || (!viewingTermId && term.isActive)
                      ? 'bg-[#185baf] text-white border-[#00479b]'
                      : 'bg-white text-[#185baf] border-[#185baf] hover:bg-[#f0f0f0]'
                  }`}
                >
                  {(viewingTermId === term.id || (!viewingTermId && term.isActive)) ? 'Currently Viewing' : 'View Timetable'}
                </button>

                {!term.isActive && isAdmin && (
                  <button 
                    onClick={() => handleToggleActive(term.id)}
                    className="w-full py-1.5 btn-secondary text-sm font-bold"
                  >
                    Set as Global Active
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {terms.length === 0 && (
          <div className="col-span-full py-12 bg-[#f9f9f9] border border-[#ccc] flex flex-col items-center justify-center text-center px-6">
            <div className="w-12 h-12 bg-[#eee] border border-[#ccc] flex items-center justify-center mb-3">
              <Calendar className="w-6 h-6 text-[#999]" />
            </div>
            <h3 className="text-md font-bold text-[#333]">No Academic Terms Found</h3>
            <p className="text-[#666] max-w-xs mt-1 text-sm">Create your first academic term to start scheduling sessions and managing resources.</p>
            {isAdmin && (
              <button 
                onClick={() => { setIsEditing(false); setIsAdding(true); }}
                className="mt-4 text-[#185baf] font-bold hover:underline text-sm"
              >
                Add a term now
              </button>
            )}
          </div>
        )}
      </div>

      <AnimatePresence>
        {isAdding && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div 
              onClick={closeModal}
              className="absolute inset-0 bg-black/20"
            />
            <div className="relative w-full max-w-[500px] bg-[#f0f0f0] border-2 border-[#185baf] shadow-2xl">
              <div className="bg-[#185baf] text-white px-3 py-1.5 flex justify-between items-center cursor-move">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  <span className="text-[12px] font-bold tracking-wide">
                    {isEditing ? 'Edit Academic Term' : 'New Academic Term'}
                  </span>
                </div>
                <button 
                  onClick={closeModal} 
                  className="bg-[#d9534f] text-white px-2 py-0.5 hover:bg-[#c9302c] border border-white/20 font-bold leading-none text-xs"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveTerm} className="p-4 space-y-4 max-h-[75vh] overflow-y-auto">
                <div className="bg-white border border-[#ccc] p-3 space-y-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-[#333] uppercase">Term Name</label>
                    <input 
                      type="text" 
                      placeholder="e.g. Fall Semester 2024" 
                      className="w-full bg-white border border-[#ccc] px-2 py-1 text-sm focus:border-[#185baf] outline-none"
                      value={formData.name}
                      onChange={e => setFormData({...formData, name: e.target.value})}
                      required 
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-[#333] uppercase">Academic Year</label>
                    <input 
                      type="text" 
                      placeholder="e.g. 2024/25" 
                      className="w-full bg-white border border-[#ccc] px-2 py-1 text-sm focus:border-[#185baf] outline-none"
                      value={formData.academicYear}
                      onChange={e => setFormData({...formData, academicYear: e.target.value})}
                      required 
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-[#333] uppercase">Start Date</label>
                      <input 
                        type="date" 
                        className="w-full bg-white border border-[#ccc] px-2 py-1 text-sm focus:border-[#185baf] outline-none"
                        value={formData.startDate}
                        onChange={e => setFormData({...formData, startDate: e.target.value})}
                        required 
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-[#333] uppercase">End Date</label>
                      <input 
                        type="date" 
                        className="w-full bg-white border border-[#ccc] px-2 py-1 text-sm focus:border-[#185baf] outline-none"
                        value={formData.endDate}
                        onChange={e => setFormData({...formData, endDate: e.target.value})}
                        required 
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button 
                    type="button" 
                    onClick={closeModal}
                    className="btn-secondary min-w-[80px]"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="btn-primary min-w-[80px]"
                  >
                    {isEditing ? 'OK' : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default TermManagement;
