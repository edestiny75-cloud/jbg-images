import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import type { ReactNode } from 'react';

/**
 * The "nothing to show yet" panel. Four screens need one and each wrote its own
 * `<div class="note">` in the legacy tool, with different wording for the same
 * situation.
 */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-extrabold">{title}</h2>
      </CardHeader>
      <CardBody className="flex flex-col items-start gap-4 text-sm text-muted">
        {children}
        {action}
      </CardBody>
    </Card>
  );
}
