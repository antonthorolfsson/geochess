import type { MemberView } from '@empire/rules';
import Link from 'next/link';
import { EmpireSwatch } from '../hatch';

/**
 * A player shown as an empire: their color and hatching, and their name in stencil. With `href`
 * (their empire's statistics page), the name is a link.
 */
export function PlayerName({
  member,
  you = false,
  size = 'md',
  href,
}: {
  member: MemberView | undefined;
  you?: boolean;
  size?: 'sm' | 'md' | 'lg';
  href?: string;
}) {
  if (!member) return <span className="text-muted">Unknown player</span>;
  const text = { sm: 'text-[0.95rem]', md: 'text-lg', lg: 'text-2xl' }[size];
  const content = (
    <>
      <EmpireSwatch color={member.color} size={size === 'lg' ? 22 : 16} className="shrink-0" />
      <span
        className={`truncate font-stencil tracking-wide ${text} ${
          href ? 'decoration-line-strong underline-offset-4 group-hover:underline' : ''
        }`}
      >
        {member.name}
      </span>
      {you && <span className="shrink-0 text-xs font-bold tracking-widest text-muted uppercase">you</span>}
    </>
  );
  const box = 'inline-flex max-w-full min-w-0 items-center gap-2';
  if (!href) return <span className={box}>{content}</span>;
  return (
    <Link href={href} className={`group ${box} rounded-[2px]`} title={`${member.name}’s empire`}>
      {content}
    </Link>
  );
}
