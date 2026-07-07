import React from 'react';

interface SectionProps {
  title: string;
  hint?: string;
  children: React.ReactNode;
  /** Anchor id so page-level navigation can scroll to this section. */
  id?: string;
}

export function Section({ title, hint, children, id }: SectionProps) {
  return (
    <div id={id} className="bg-[#161b22] border border-[#30363d] rounded-lg p-6 mb-6 scroll-mt-4">
      <h2 className="text-[#58a6ff] text-lg font-semibold mb-3">{title}</h2>
      {hint && <p className="text-sm text-[#8b949e] mb-4">{hint}</p>}
      {children}
    </div>
  );
}
