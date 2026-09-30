'use client';

import { BOT_LEVELS, botLevel, botLevelText } from '@empire/rules';
import { useId } from 'react';

/** A bot's chess level, with what that level plays like. */
export function BotLevelSelect({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  onChange(level: number): void;
}) {
  const summary = useId();
  return (
    <div className="pb-3">
      <select
        className="input"
        aria-label={label}
        aria-describedby={summary}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {BOT_LEVELS.map((l) => (
          <option key={l.level} value={l.level}>
            {botLevelText(l.level)}
          </option>
        ))}
      </select>
      <p id={summary} className="mt-1 text-sm text-muted">
        {botLevel(value).summary}
      </p>
    </div>
  );
}
