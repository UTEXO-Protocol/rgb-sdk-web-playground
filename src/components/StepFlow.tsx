import React, { useState } from 'react';
import { Btn } from './Btn';

interface Step {
  label: string;
  variant?: 'primary' | 'secondary' | 'accent' | 'warning' | 'danger';
  onClick: () => Promise<void>;
}

interface StepFlowProps {
  steps: [Step, Step, Step];
  auto: { label: string; onClick: () => Promise<void> };
  disabled?: boolean;
}

export function StepFlow({ steps, auto, disabled = false }: StepFlowProps) {
  const [step, setStep] = useState(0); // 0=none started, 1=after step1, 2=after step2, 3=done
  const [loading, setLoading] = useState(false);

  async function runStep(idx: number, handler: () => Promise<void>) {
    setLoading(true);
    try {
      await handler();
      setStep(idx + 1);
    } catch {
      // error is handled by parent; don't advance step
    } finally {
      setLoading(false);
    }
  }

  async function runAuto() {
    setLoading(true);
    try {
      await auto.onClick();
      setStep(3);
    } catch {
      // parent handles
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2 items-center mb-4">
      <Btn
        variant={steps[0].variant ?? 'primary'}
        onClick={() => runStep(0, steps[0].onClick)}
        disabled={disabled || loading}
      >
        {steps[0].label}
      </Btn>
      <span className="text-[#484f58]">→</span>
      <Btn
        variant={steps[1].variant ?? 'warning'}
        onClick={() => runStep(1, steps[1].onClick)}
        disabled={disabled || loading || step < 1}
      >
        {steps[1].label}
      </Btn>
      <span className="text-[#484f58]">→</span>
      <Btn
        variant={steps[2].variant ?? 'accent'}
        onClick={() => runStep(2, steps[2].onClick)}
        disabled={disabled || loading || step < 2}
      >
        {steps[2].label}
      </Btn>
      <span className="text-[#484f58] mx-1">|</span>
      <Btn
        variant="secondary"
        onClick={runAuto}
        disabled={disabled || loading}
      >
        {auto.label}
      </Btn>
    </div>
  );
}
