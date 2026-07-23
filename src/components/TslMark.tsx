type Props = {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

const sizeMap = {
  sm: {
    frame: 'h-6 w-6 rounded-lg',
    text: 'text-[9px] tracking-[0.35em]',
    accent: 'h-1 w-1',
  },
  md: {
    frame: 'h-10 w-10 rounded-xl',
    text: 'text-[11px] tracking-[0.42em]',
    accent: 'h-1.5 w-1.5',
  },
  lg: {
    frame: 'h-20 w-20 rounded-2xl',
    text: 'text-xl tracking-[0.5em]',
    accent: 'h-2 w-2',
  },
} as const;

export function TslMark({ size = 'md', className = '' }: Props) {
  const styles = sizeMap[size];

  return (
    <div
      className={[
        'relative flex items-center justify-center overflow-hidden border border-white/10',
        'bg-[radial-gradient(circle_at_top,#3a0d10_0%,#1a0a0b_45%,#090909_100%)]',
        'shadow-[0_0_40px_rgba(232,33,39,0.12)]',
        styles.frame,
        className,
      ].join(' ')}
    >
      <div className="absolute inset-[1px] rounded-[inherit] bg-[linear-gradient(145deg,rgba(255,255,255,0.12),rgba(255,255,255,0.02)_35%,rgba(232,33,39,0.12)_100%)]" />
      <div className="absolute inset-x-2 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent" />
      <div className="relative flex items-center gap-1 pl-1 text-white">
        <span className={['font-black uppercase', styles.text].join(' ')}>TSL</span>
        <span className={['rounded-full bg-brand-primary shadow-[0_0_12px_rgba(232,33,39,0.8)]', styles.accent].join(' ')} />
      </div>
    </div>
  );
}
