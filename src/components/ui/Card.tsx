import { cn } from '@/lib/ui/cn';
import type { ReactNode } from 'react';

/**
 * The panel surface. Replaces `.card`, `.box`, `.onecard`, `.kv`, `.note`,
 * `.cat-card`, `.pm-card` and `.shipbanner`, which shared one background and
 * shadow declared eight times over.
 */
export function Card({
  children,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'li';
}) {
  return (
    <Tag className={cn('rounded-md bg-panel shadow-panel', className)}>{children}</Tag>
  );
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 border-b border-line px-4 py-3', className)}>
      {children}
    </div>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('p-4', className)}>{children}</div>;
}
