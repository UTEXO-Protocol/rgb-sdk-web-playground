// Timestamped → req / ← res console — web port of RN screens/apay/ui.tsx
// LogPane (tail 500 kept by the hook), auto-scrolls to the newest line.
import { useEffect, useRef } from 'react';
import type { LogEntry } from './config';

export function LogPane({ entries }: { entries: LogEntry[] }) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  return (
    <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-3 mt-2">
      <div className="text-[11px] uppercase tracking-wider text-[#8b949e] mb-2">Console</div>
      <div ref={boxRef} className="max-h-80 overflow-y-auto font-mono text-[11px] leading-[18px]">
        {entries.length === 0 ? (
          <span className="text-[#484f58] italic">No output yet</span>
        ) : (
          entries.map((e, i) => (
            <div
              key={i}
              className={
                e.type === 'success'
                  ? 'text-[#3fb950]'
                  : e.type === 'error'
                    ? 'text-[#f85149]'
                    : 'text-[#8b949e]'
              }
            >
              {e.time} {e.msg}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
