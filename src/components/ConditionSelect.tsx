'use client';

import React from 'react';

interface Props {
  value: string | null | undefined;
  options: string[];
  placeholder: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
}

/**
 * Dropdown for long Terms & Conditions texts (price, payment, delivery, ...).
 *
 * Native <select> elements cut off long option text, so this:
 *  - is rendered in a wider column (see the docket table headers),
 *  - puts the full text in a hover tooltip (title) on the select and on every option,
 *  - shows the full selected text underneath, wrapped, so it can be read without opening the list.
 * A value that is no longer in the presets is still shown instead of silently appearing blank.
 */
export default function ConditionSelect({ value, options, placeholder, onChange, className = '', disabled }: Props) {
  const current = value || '';
  const allOptions = current && !options.includes(current) ? [current, ...options] : options;

  return (
    <div className="space-y-1">
      <select
        value={current}
        title={current || placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full bg-white border border-purple-200 rounded-md px-1.5 py-1 text-[11px] font-semibold text-purple-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20 truncate ${className}`}
      >
        <option value="">{placeholder}</option>
        {allOptions.map((opt, i) => (
          <option key={i} value={opt} title={opt}>
            {opt}
          </option>
        ))}
      </select>
      {current && (
        <p className="text-[10px] leading-snug text-purple-900/80 whitespace-normal break-words line-clamp-3" title={current}>
          {current}
        </p>
      )}
    </div>
  );
}
