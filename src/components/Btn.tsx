import React from 'react';

type Variant = 'primary' | 'secondary' | 'accent' | 'warning' | 'danger';

const variantCls: Record<Variant, string> = {
  primary:
    'bg-[#238636] hover:bg-[#2ea043] disabled:bg-[#21262d] disabled:text-[#484f58] disabled:cursor-not-allowed text-white',
  secondary:
    'bg-[#30363d] hover:bg-[#484f58] disabled:bg-[#21262d] disabled:text-[#484f58] disabled:cursor-not-allowed text-white',
  accent:
    'bg-[#1f6feb] hover:bg-[#388bfd] disabled:bg-[#21262d] disabled:text-[#484f58] disabled:cursor-not-allowed text-white',
  warning:
    'bg-[#9a6700] hover:bg-[#d29922] disabled:bg-[#21262d] disabled:text-[#484f58] disabled:cursor-not-allowed text-white',
  danger:
    'bg-[#da3633] hover:bg-[#f85149] disabled:bg-[#21262d] disabled:text-[#484f58] disabled:cursor-not-allowed text-white',
};

interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Btn({ variant = 'primary', className = '', children, ...props }: BtnProps) {
  return (
    <button
      className={`px-4 py-2 rounded-md text-sm font-semibold cursor-pointer ${variantCls[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
