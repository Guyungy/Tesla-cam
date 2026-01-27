import clsx from 'clsx';
import type { PropsWithChildren } from 'react';

type Props = PropsWithChildren<{
  name?: string;
  active?: boolean;
  onClick?: () => void;
}>;

export function Preview({ name, active, children, onClick }: Props) {
  return (
    <div
      className={clsx(
        'relative cursor-pointer overflow-hidden rounded-xl',
        active ? 'outline-2' : 'hover:outline-2 hover:outline-neutral-400',
      )}
      onClick={onClick}
    >
      {children}
      {active && (
        <div className="absolute top-0 right-0 bottom-0 left-0 bg-black/60"></div>
      )}
      <div className="absolute right-0 bottom-0 left-0 bg-linear-to-t from-black px-2 py-1">
        {name}
      </div>
    </div>
  );
}
