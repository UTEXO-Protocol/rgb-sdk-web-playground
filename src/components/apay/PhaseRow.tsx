// Phase stepper — web port of RN screens/apay/ui.tsx PhaseRow, one row per
// role (the RN PHASES_P1/P2 split maps to merchant/buyer windows).
import React from 'react';
import { PHASE_LABELS, type Phase } from './config';

const COLOR = {
  done: '#3fb950',
  active: '#58a6ff',
  error: '#f85149',
  idle: '#484f58',
};

export function PhaseRow({ phases, phase }: { phases: Phase[]; phase: Phase }) {
  const idx = phases.indexOf(phase);
  const allDone = phase === 'done';
  return (
    <div className="flex items-center bg-[#0d1117] border border-[#30363d] rounded-lg p-3 mb-4 overflow-x-auto">
      {phases.map((s, i) => {
        const done = allDone || idx > i;
        const active = phase === s;
        const color = done
          ? COLOR.done
          : active
            ? phase === 'error'
              ? COLOR.error
              : COLOR.active
            : COLOR.idle;
        return (
          <React.Fragment key={s}>
            <div className="flex flex-col items-center shrink-0">
              <div
                className="w-6 h-6 rounded-full border-2 flex items-center justify-center text-[10px] font-bold"
                style={{
                  borderColor: color,
                  color,
                  backgroundColor: active ? `${color}20` : 'transparent',
                }}
              >
                {done ? '✓' : i + 1}
              </div>
              <span className="text-[10px] font-semibold mt-0.5" style={{ color }}>
                {PHASE_LABELS[s]}
              </span>
            </div>
            {i < phases.length - 1 && (
              <div
                className="flex-1 h-0.5 mx-1 mb-4 min-w-4"
                style={{ backgroundColor: done ? `${COLOR.done}60` : '#30363d' }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
