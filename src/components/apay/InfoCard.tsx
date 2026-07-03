// Key/value info card — web port of RN screens/apay/ui.tsx InfoCard.

export function InfoCard({
  title,
  rows,
  accent,
}: {
  title: string;
  rows: [string, string][];
  accent?: string;
}) {
  return (
    <div
      className="bg-[#0d1117] border border-[#30363d] rounded-lg p-3 mb-3"
      style={accent ? { borderColor: `${accent}60` } : undefined}
    >
      <div
        className="text-[11px] uppercase tracking-wider text-[#8b949e] mb-2"
        style={accent ? { color: accent } : undefined}
      >
        {title}
      </div>
      {rows.map(([k, v], i) => (
        <div
          key={i}
          className="flex justify-between gap-3 py-1 border-t border-[#21262d] text-xs"
        >
          <span className="text-[#8b949e] shrink-0">{k}</span>
          <span className="text-[#79c0ff] font-mono text-right break-all select-all">{v}</span>
        </div>
      ))}
    </div>
  );
}
