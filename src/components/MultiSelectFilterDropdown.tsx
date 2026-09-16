'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronDown, X, Check } from 'lucide-react';

export interface MultiSelectFilterDropdownProps {
  title: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  allLabel?: string;
  className?: string;
  align?: 'left' | 'right';
}

export const MultiSelectFilterDropdown: React.FC<MultiSelectFilterDropdownProps> = ({
  title,
  options = [],
  selected = [],
  onChange,
  placeholder,
  allLabel,
  className = '',
  align = 'left',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Unique and non-empty options
  const cleanOptions = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const opt of options) {
      if (opt !== null && opt !== undefined) {
        const str = String(opt).trim();
        if (str && !seen.has(str)) {
          seen.add(str);
          list.push(str);
        }
      }
    }
    return list;
  }, [options]);

  // Filtered options based on search term
  const filteredOptions = useMemo(() => {
    if (!searchTerm.trim()) return cleanOptions;
    const term = searchTerm.toLowerCase();
    return cleanOptions.filter((opt) => opt.toLowerCase().includes(term));
  }, [cleanOptions, searchTerm]);

  // Selection toggle
  const toggleOption = (opt: string) => {
    if (selected.includes(opt)) {
      onChange(selected.filter((item) => item !== opt));
    } else {
      onChange([...selected, opt]);
    }
  };

  // Select all matching
  const handleSelectAll = () => {
    if (filteredOptions.length === 0) return;
    const newSelectedSet = new Set([...selected, ...filteredOptions]);
    onChange(Array.from(newSelectedSet));
  };

  // Clear all selections
  const handleClear = () => {
    onChange([]);
  };

  // Render trigger label
  const renderTriggerLabel = () => {
    if (!selected || selected.length === 0) {
      return (
        <span className="truncate text-slate-500 font-medium">
          {allLabel || `All ${title}`}
        </span>
      );
    }
    if (selected.length === 1) {
      return (
        <span className="truncate font-bold text-slate-800" title={selected[0]}>
          {selected[0]}
        </span>
      );
    }
    return (
      <span className="font-extrabold text-blue-700 flex items-center space-x-1">
        <span>{selected.length}</span>
        <span className="text-[10px] text-slate-500 font-medium">selected</span>
      </span>
    );
  };

  const hasSelection = selected && selected.length > 0;

  return (
    <div ref={containerRef} className={`relative inline-block w-full text-left font-sans ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full flex items-center justify-between px-2 py-1 text-xs border rounded-md transition-all shadow-2xs ${
          hasSelection
            ? 'bg-blue-50/90 border-blue-400 text-blue-900 ring-1 ring-blue-400/30'
            : 'bg-white border-slate-300 hover:border-slate-400 text-slate-700'
        } focus:outline-none focus:ring-1 focus:ring-blue-500`}
        title={hasSelection ? `Filtered by ${selected.length} values` : `Filter by ${title}`}
      >
        <div className="flex items-center min-w-0 flex-1 mr-1">
          {renderTriggerLabel()}
        </div>
        <div className="flex items-center space-x-1 shrink-0">
          {hasSelection && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                handleClear();
              }}
              className="p-0.5 hover:bg-blue-200/60 rounded-full text-blue-600 transition-colors"
              title="Clear filter"
            >
              <X className="w-3 h-3" />
            </span>
          )}
          <ChevronDown
            className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-150 ${
              isOpen ? 'transform rotate-180 text-blue-600' : ''
            }`}
          />
        </div>
      </button>

      {/* Popover Dropdown */}
      {isOpen && (
        <div
          className={`absolute z-50 mt-1 min-w-[230px] max-w-[320px] w-auto bg-white rounded-xl border border-slate-200 shadow-xl p-2.5 text-slate-800 space-y-2 animate-in fade-in-50 zoom-in-95 duration-100 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
          style={{ minWidth: '220px' }}
        >
          {/* Header title */}
          <div className="flex items-center justify-between pb-1 border-b border-slate-100 text-[11px] font-extrabold text-slate-700 uppercase tracking-wider">
            <span>Filter by {title}</span>
            <span className="text-[10px] text-slate-400 font-normal">
              {cleanOptions.length} total
            </span>
          </div>

          {/* Search Input */}
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={placeholder || `Search ${title.toLowerCase()}...`}
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Action Row: Select All | Clear */}
          <div className="flex items-center justify-between px-1 text-[11px] font-bold">
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-blue-600 hover:text-blue-800 hover:underline transition-colors cursor-pointer"
            >
              Select All
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="text-slate-500 hover:text-slate-700 hover:underline transition-colors cursor-pointer"
            >
              Clear
            </button>
          </div>

          {/* Options Checklist */}
          <div className="max-h-52 overflow-y-auto divide-y divide-slate-100 pr-1 rounded-md border border-slate-100">
            {filteredOptions.length === 0 ? (
              <div className="py-4 text-center text-xs text-slate-400 italic">
                No matching options
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const isChecked = selected.includes(opt);
                return (
                  <label
                    key={opt}
                    onClick={(e) => e.stopPropagation()}
                    className={`flex items-center space-x-2.5 py-1.5 px-2 cursor-pointer transition-colors text-xs font-semibold select-none ${
                      isChecked ? 'bg-blue-50/70 text-blue-900' : 'hover:bg-slate-50 text-slate-800'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleOption(opt)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 cursor-pointer shrink-0"
                    />
                    <span className="truncate flex-1" title={opt}>
                      {opt}
                    </span>
                    {isChecked && <Check className="w-3 h-3 text-blue-600 shrink-0" />}
                  </label>
                );
              })
            )}
          </div>

          {/* Footer showing count */}
          {selected.length > 0 && (
            <div className="pt-1 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
              <span>{selected.length} selected</span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-blue-600 hover:text-blue-800 font-bold"
              >
                Done
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MultiSelectFilterDropdown;
