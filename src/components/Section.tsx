import React from 'react';

interface SectionProps {
  title: string;
  hint?: string;
  children: React.ReactNode;
}

export function Section({ title, hint, children }: SectionProps) {
  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-6 mb-6">
      <h2 className="text-[#58a6ff] text-lg font-semibold mb-3">{title}</h2>
      {hint && <p className="text-sm text-[#8b949e] mb-4">{hint}</p>}
      {children}
    </div>
  );
}
