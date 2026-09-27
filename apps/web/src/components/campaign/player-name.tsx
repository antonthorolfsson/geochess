import type { MemberView } from '@empire/rules';
import { EmpireSwatch } from '../hatch';

/** A player shown as an empire: their color and hatching, and their name in stencil. */
export function PlayerName({
  member,
  you = false,
  size = 'md',
}: {
  member: MemberView | undefined;
  you?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  if (!member) return <span className="text-muted">Unknown player</span>;
  const text = { sm: 'text-[0.95rem]', md: 'text-lg', lg: 'text-2xl' }[size];
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <EmpireSwatch color={member.color} size={size === 'lg' ? 22 : 16} className="shrink-0" />
      <span className={`truncate font-stencil tracking-wide ${text}`}>{member.name}</span>
      {you && <span className="shrink-0 text-xs font-bold tracking-widest text-muted uppercase">you</span>}
    </span>
  );
}
