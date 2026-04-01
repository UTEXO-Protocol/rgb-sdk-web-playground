import React from 'react';

interface FieldProps {
  label: string;
  children: React.ReactNode;
  hint?: string;
}

export function Field({ label, children, hint }: FieldProps) {
  return (
    <div className="mb-4">
      <label className="block text-sm text-[#8b949e] mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-[#8b949e] mt-1">{hint}</p>}
    </div>
  );
}

export const inputCls =
  'w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-md text-[#c9d1d9] font-mono text-sm focus:outline-none focus:border-[#58a6ff]';

export const selectCls =
  'w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-md text-[#c9d1d9] font-mono text-sm focus:outline-none focus:border-[#58a6ff]';

export const textareaCls =
  'w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-md text-[#c9d1d9] font-mono text-sm focus:outline-none focus:border-[#58a6ff] resize-y min-h-[60px]';
