export type UpgradePlan = {
  name: string;
  price: number;
  description: string;
  highlights: string[];
  badge: string;
  priceId: string | undefined;
};

export const upgradePlans: UpgradePlan[] = [
  {
    name: 'Core',
    price: 4.99,
    description: 'For investors who want full control over how and when they get their reports.',
    highlights: [
      'Up to 10 stocks tracked',
      'All 5 email frequencies (daily → yearly)',
      'All chart time windows unlocked',
      'ETF & crypto support',
    ],
    badge: 'Most popular',
    priceId: process.env.NEXT_PUBLIC_STRIPE_CORE_PRICE_ID,
  },
  {
    name: 'Pro',
    price: 9.99,
    description: 'For power users who want unlimited tracking and on-demand AI reports.',
    highlights: [
      'Unlimited stocks tracked',
      'Everything in Core',
      'Manual "Run Report Now" trigger (1×/hour)',
      'Weekly portfolio digest email',
    ],
    badge: 'Most advanced',
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID,
  },
];

