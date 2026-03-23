import { supabase } from '@/lib/supabase';

export type Plan = 'free' | 'core' | 'pro';
export type LanguageLevel = 'super-simple' | 'easy' | 'regular' | 'advanced' | 'very-advanced';

export const PLAN_LIMITS: Record<Plan, number> = {
  free: 3,
  core: 10,
  pro: Infinity,
};

export const PLAN_LABELS: Record<Plan, string> = {
  free: 'FREE',
  core: 'CORE',
  pro: 'PRO',
};

export const PLAN_COLORS: Record<Plan, string> = {
  free: 'border-white/20 text-white/40',
  core: 'border-blue-400/50 text-blue-400',
  pro: 'border-green-400/60 text-green-400',
};

/** Returns true if this plan can use non-daily email frequencies */
export function canUseFrequency(plan: Plan): boolean {
  return plan === 'core' || plan === 'pro';
}

/** Returns true if this plan can use the manual trigger */
export function canUseTrigger(plan: Plan): boolean {
  return plan === 'pro';
}

/** Fetch the current user's plan from the profiles table */
export async function fetchUserPlan(userId: string): Promise<Plan> {
  const { data, error } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', userId)
    .single();

  if (error || !data) return 'free';
  return (data.plan as Plan) || 'free';
}

export const LANGUAGE_LEVEL_OPTIONS: { value: LanguageLevel; label: string; description: string; requiresPaid: boolean }[] = [
  { value: 'super-simple',  label: 'Super Simple',   description: 'Plain English, no jargon — perfect for beginners', requiresPaid: true },
  { value: 'easy',          label: 'Easy',            description: 'Beginner-friendly with light explanations',         requiresPaid: false },
  { value: 'regular',       label: 'Regular',         description: 'Balanced — the default level',                     requiresPaid: false },
  { value: 'advanced',      label: 'Advanced',        description: 'Professional financial terminology',               requiresPaid: false },
  { value: 'very-advanced', label: 'Very Advanced',   description: 'Highly technical quantitative analysis',           requiresPaid: true },
];

/** Fetch the current user's language_level preference */
export async function fetchUserLanguageLevel(userId: string): Promise<LanguageLevel> {
  const { data, error } = await supabase
    .from('profiles')
    .select('language_level')
    .eq('id', userId)
    .single();

  if (error || !data) return 'regular';
  return (data.language_level as LanguageLevel) || 'regular';
}
