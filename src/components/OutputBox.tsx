import React, { useRef } from 'react';

interface OutputBoxProps {
  label?: string;
  value: string;
}

export function OutputBox({ label = 'Result', value }: OutputBoxProps) {
  const preRef = useRef<HTMLPreElement>(null);

  function copy() {
    navigator.clipboard.writeText(value).catch(() => {});
  }

  if (!value) return null;

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-[#8b949e]">{label}</span>
        <button
          onClick={copy}
          className="text-xs px-2 py-1 bg-[#30363d] hover:bg-[#484f58] text-[#c9d1d9] rounded"
        >
          Copy
        </button>
      </div>
      <pre
        ref={preRef}
        className="bg-[#0d1117] border border-[#30363d] rounded-md p-4 text-sm font-mono leading-relaxed max-h-72 overflow-auto whitespace-pre-wrap break-all text-[#c9d1d9]"
      >
        {value}
      </pre>
    </div>
  );
}
