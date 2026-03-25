
import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, ChevronDown, Check, X, Plus, Minus } from 'lucide-react';

interface Option {
  id: string;
  name: string;
  code?: string;
  sub?: string;
  extra?: React.ReactNode;
}

interface SearchableDropdownProps {
  label: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  icon: React.ReactNode;
  placeholder?: string;
  required?: boolean;
}

export const SearchableDropdown: React.FC<SearchableDropdownProps> = ({ 
  label, options, value, onChange, icon, placeholder = "Select option...", required 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(o => o.id === value);
  const filteredOptions = options.filter(o => 
    o.name.toLowerCase().includes(search.toLowerCase()) || 
    o.code?.toLowerCase().includes(search.toLowerCase()) ||
    o.sub?.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="space-y-1" ref={dropdownRef}>
      <label className="text-[10px] font-bold text-[#666] uppercase tracking-widest flex items-center gap-2">
        {icon} {label}
      </label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-between bg-white border border-[#ccc] px-3 py-1.5 text-[11px] font-bold text-[#333] hover:bg-[#f8f9fa] transition-colors text-left outline-none focus:ring-1 focus:ring-[#185baf] min-h-[30px]"
        >
          <span className={`truncate ${!selectedOption ? 'text-[#999]' : 'text-[#333]'}`}>
            {selectedOption ? selectedOption.name : placeholder}
          </span>
          <ChevronDown className={`w-3.5 h-3.5 text-[#666] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.15 }}
              className="absolute z-50 w-full mt-1 bg-white border border-[#ccc] shadow-lg overflow-hidden"
            >
              <div className="p-1.5 border-b border-[#eee] bg-[#f8f9fa]">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#999]" />
                  <input
                    autoFocus
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search..."
                    className="w-full bg-white border border-[#ccc] pl-7 pr-2 py-1 text-[11px] font-bold text-[#333] outline-none focus:border-[#185baf] placeholder:text-[#999]"
                  />
                </div>
              </div>
              <div className="max-h-60 overflow-y-auto p-1 custom-scrollbar bg-white">
                {filteredOptions.length > 0 ? (
                  filteredOptions.map(option => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        onChange(option.id);
                        setIsOpen(false);
                        setSearch('');
                      }}
                      className={`w-full flex items-center justify-between px-2 py-1.5 text-[11px] font-bold transition-none text-left border border-transparent ${
                        value === option.id ? 'bg-[#185baf] text-white border-[#0d47a1]' : 'text-[#333] hover:bg-[#e0e0e0] hover:border-[#ccc]'
                      }`}
                    >
                      <div className="flex flex-col items-start min-w-0 flex-1 pr-2">
                        <div className="flex items-center justify-between w-full gap-2">
                          <span className="truncate leading-tight">{option.name}</span>
                          {option.extra}
                        </div>
                        {(option.code || option.sub) && (
                          <span className={`text-[9px] uppercase tracking-wider font-normal leading-tight mt-0.5 ${value === option.id ? 'text-[#e0e0e0]' : 'text-[#666]'}`}>
                            {option.code || option.sub}
                          </span>
                        )}
                      </div>
                      {value === option.id && <Check className={`w-3.5 h-3.5 shrink-0 ${value === option.id ? 'text-white' : 'text-[#185baf]'}`} />}
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-4 text-center">
                    <p className="text-[10px] font-bold text-[#999] uppercase tracking-widest">No results found</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

interface MultiSearchableDropdownProps {
  label: string;
  options: Option[];
  values: string[];
  onChange: (values: string[]) => void;
  icon: React.ReactNode;
  placeholder?: string;
  required?: boolean;
}

export const MultiSearchableDropdown: React.FC<MultiSearchableDropdownProps> = ({ 
  label, options, values, onChange, icon, placeholder = "Select multiple...", required 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filteredOptions = options.filter(o => 
    o.name.toLowerCase().includes(search.toLowerCase()) || 
    o.code?.toLowerCase().includes(search.toLowerCase()) ||
    o.sub?.toLowerCase().includes(search.toLowerCase())
  );

  const toggleOption = (id: string) => {
    if (values.includes(id)) {
      onChange(values.filter(v => v !== id));
    } else {
      onChange([...values, id]);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="space-y-1" ref={dropdownRef}>
      <label className="text-[10px] font-bold text-[#666] uppercase tracking-widest flex items-center gap-2">
        {icon} {label}
      </label>
      <div className="relative">
        <div
          onClick={() => setIsOpen(!isOpen)}
          className="w-full min-h-[30px] flex flex-wrap gap-1 items-center bg-white border border-[#ccc] px-2 py-1 text-[11px] font-bold text-[#333] hover:bg-[#f8f9fa] transition-colors cursor-pointer"
        >
          {values.length > 0 ? (
            values.map(v => {
              const opt = options.find(o => o.id === v);
              return (
                <span key={v} onClick={(e) => { e.stopPropagation(); toggleOption(v); }} className="bg-[#e0e0e0] hover:bg-[#dcdcdc] border border-[#ccc] px-1.5 py-0.5 text-[10px] flex items-center gap-1 cursor-pointer transition-colors group">
                  {opt?.name}
                  <X className="w-3 h-3 text-[#666] group-hover:text-[#d9534f]" />
                </span>
              );
            })
          ) : (
            <span className="text-[#999] font-normal pl-1">{placeholder}</span>
          )}
          <div className="flex-1" />
          <div className="flex items-center gap-1.5 shrink-0">
            {values.length > 0 && (
              <span className="bg-[#185baf] text-white text-[9px] font-bold px-1.5 py-0.5 min-w-[18px] text-center leading-none">
                {values.length}
              </span>
            )}
            <ChevronDown className={`w-3.5 h-3.5 text-[#666] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
          </div>
        </div>

        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.15 }}
              className="absolute z-50 w-full mt-1 bg-white border border-[#ccc] shadow-lg overflow-hidden"
            >
              <div className="p-1.5 border-b border-[#eee] bg-[#f8f9fa]">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#999]" />
                  <input
                    autoFocus
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search..."
                    className="w-full bg-white border border-[#ccc] pl-7 pr-2 py-1 text-[11px] font-bold text-[#333] outline-none focus:border-[#185baf] placeholder:text-[#999]"
                  />
                </div>
              </div>
              <div className="max-h-60 overflow-y-auto p-1 custom-scrollbar bg-white">
                {filteredOptions.length > 0 ? (
                  filteredOptions.map(option => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleOption(option.id); }}
                      className={`w-full flex items-center justify-between px-2 py-1.5 text-[11px] font-bold transition-none text-left border border-transparent ${
                        values.includes(option.id) ? 'bg-[#e0e0e0] text-[#185baf] border-[#ccc]' : 'text-[#333] hover:bg-[#f0f0f0] hover:border-[#ccc]'
                      }`}
                    >
                      <div className="flex flex-col items-start min-w-0 flex-1 pr-2">
                        <span className="truncate leading-tight">{option.name}</span>
                        {(option.code || option.sub) && (
                          <span className={`text-[9px] uppercase tracking-wider font-normal leading-tight mt-0.5 ${values.includes(option.id) ? 'text-[#185baf]' : 'text-[#666]'}`}>
                            {option.code || option.sub}
                          </span>
                        )}
                      </div>
                      <div className={`w-3.5 h-3.5 border flex items-center justify-center shrink-0 ${values.includes(option.id) ? 'bg-[#185baf] border-[#185baf]' : 'bg-white border-[#999]'}`}>
                        {values.includes(option.id) && <Check className="w-2.5 h-2.5 text-white" />}
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-4 text-center">
                    <p className="text-[10px] font-bold text-[#999] uppercase tracking-widest">No results found</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
