import type { PropsWithChildren } from 'react';

type Props = PropsWithChildren<{
  onClick?: () => void;
}>;

export function IconBtn({ children, onClick }: Props) {
  return (
    <button
      className="cursor-pointer text-4xl text-neutral-200 hover:text-white"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
