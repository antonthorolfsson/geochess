import { botLevel, type MemberView } from '@empire/rules';
import Link from 'next/link';
import { EmpireSwatch } from '../hatch';
import { TitleTokens, useTitlesOf } from '../victory/title-tokens';

/**
 * A player shown as an empire: their color and hatching, and their name in stencil, tagged with
 * its level if it's a bot, then the tokens of the titles they hold. With `href` (their empire's
 * statistics page), the name is a link.
 */
export function PlayerName({
  member,
  you = false,
  size = 'md',
  href,
  showTitles = true,
}: {
  member: MemberView | undefined;
  you?: boolean;
  size?: 'sm' | 'md' | 'lg';
  href?: string;
  /** Off where the titles are already the subject (the Titles list itself). */
  showTitles?: boolean;
}) {
  const held = useTitlesOf(member?.userId);
  const titles = showTitles ? held : [];
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
      {member.bot && <BotTag level={member.bot.level} standIn={member.bot.standIn} />}
      <TitleTokens titles={titles} size={{ sm: 16, md: 18, lg: 24 }[size]} holder={member.userId} />
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

/**
 * "Bot 4": a bot and its chess level, or a bot standing in for the player, spelled out for screen
 * readers and on hover.
 */
export function BotTag({ level, standIn = false }: { level: number; standIn?: boolean }) {
  const { name } = botLevel(level);
  const words = standIn ? `a level ${level} bot is playing for them` : `bot, level ${level}: ${name}`;
  return (
    <span
      className="shrink-0 text-xs font-bold tracking-widest whitespace-nowrap text-muted uppercase"
      title={words[0]!.toUpperCase() + words.slice(1)}
    >
      <span aria-hidden="true">bot {level}</span>
      <span className="sr-only">({words})</span>
    </span>
  );
}
