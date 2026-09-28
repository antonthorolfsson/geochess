import type { Metadata } from 'next';
import { RulesScreen } from '@/components/rules/rules-screen';

export const metadata: Metadata = {
  title: 'How to play',
  description: 'The rules of Empire Chess: the draft, each round step by step, wars, answers, the battle and accords.',
};

export default function Page() {
  return <RulesScreen />;
}
