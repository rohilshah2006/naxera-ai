'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { upgradePlans } from '@/lib/upgradePlans';
import { fetchUserPlan, type Plan } from '@/lib/userPlan';
import { ShieldCheck, Zap, CheckCircle2 } from 'lucide-react';

// Map plan names from upgradePlans to our Plan type keys
const PLAN_NAME_MAP: Record<string, Plan> = {
  'core': 'core',
  'pro': 'pro',
};

export default function UpgradePage() {
  const router = useRouter();
  const [userPlan, setUserPlan] = useState<Plan | null>(null);
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const plan = await fetchUserPlan(session.user.id);
        setUserPlan(plan);
      }
    });
  }, []);

  const handlePlanSelection = async (plan: any) => {
    if (!plan.priceId) {
      alert('This plan is not yet configured for payment.');
      return;
    }

    setLoadingPlan(plan.name);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/');
        return;
      }

      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          priceId: plan.priceId,
          userId: session.user.id,
          userEmail: session.user.email,
        }),
      });

      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert('Failed to initialize checkout');
      }
    } catch (err) {
      console.error('Checkout error:', err);
      alert('Something went wrong');
    } finally {
      setLoadingPlan(null);
    }
  };


  const isCurrentPlan = (planName: string): boolean => {
    if (!userPlan) return false;
    const planKey = PLAN_NAME_MAP[planName.toLowerCase()];
    return userPlan === planKey;
  };

  const isOwnedOrHigher = (planName: string): boolean => {
    if (!userPlan) return false;
    const order: Plan[] = ['free', 'core', 'pro'];
    const planKey = PLAN_NAME_MAP[planName.toLowerCase()];
    return order.indexOf(userPlan) >= order.indexOf(planKey);
  };

  return (
    <main className="min-h-screen bg-[#050505] text-white selection:bg-green-500/30">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,#22c55e1a_0%,transparent_55%)] pointer-events-none"></div>
      <div className="relative z-10 max-w-6xl mx-auto px-4 py-12">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
          <div>
            <p className="text-xs font-mono tracking-[0.5em] text-green-400 uppercase">Upgrade plan</p>
            <h1 className="text-3xl md:text-4xl font-bold">Secure the plan that matches your workflow.</h1>
            <p className="text-white/50 max-w-2xl mt-2">
              Pick a plan that unlocks Naxera AI depth, then confirm the secure checkout flow from the dashboard.
            </p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/" className="text-white/70 hover:text-white transition">
              Back to home
            </Link>
            <div className="text-green-400 flex items-center gap-1">
              <ShieldCheck className="w-4 h-4" />
              Secure billing
            </div>
          </div>
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          {upgradePlans.map((plan) => {
            const owned = isCurrentPlan(plan.name);
            const alreadyHigher = isOwnedOrHigher(plan.name) && !owned;

            return (
              <article
                key={plan.name}
                className={`rounded-3xl border p-6 backdrop-blur-xl transition relative
                  ${owned
                    ? 'border-green-400/50 bg-green-500/8 shadow-[0_0_30px_rgba(74,222,128,0.08)]'
                    : 'border-white/10 bg-white/5 hover:border-white/40'
                  }`}
              >
                {/* Owned badge */}
                {owned && (
                  <div className="absolute -top-3 left-6 flex items-center gap-1.5 bg-green-500 text-black text-xs font-bold px-3 py-1 rounded-full shadow-lg">
                    <CheckCircle2 className="w-3 h-3" />
                    Current Plan
                  </div>
                )}

                <div className="flex items-center justify-between mb-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-white/50">{plan.name} Plan</p>
                  <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${owned ? 'border-green-400/40 text-green-400' : 'border-white/20 text-white/60'}`}>
                    {owned ? '✓ Active' : plan.badge}
                  </span>
                </div>

                <h2 className="text-4xl font-bold text-white mb-2">
                  ${plan.price}
                  <span className="text-base text-white/40 font-normal"> /mo</span>
                </h2>

                <p className="text-white/60 mb-6">{plan.description}</p>

                <ul className="space-y-2 mb-6 text-sm text-white/70">
                  {plan.highlights.map((item) => (
                    <li key={item} className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full inline-block ${owned ? 'bg-green-400' : 'bg-green-400'}`}></span>
                      {item}
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  onClick={() => handlePlanSelection(plan)}
                  disabled={owned || alreadyHigher || (loadingPlan !== null)}
                  className={`w-full font-semibold rounded-2xl py-3 transition flex items-center justify-center gap-2
                    ${owned
                      ? 'bg-green-500/10 border border-green-500/30 text-green-400 cursor-default'
                      : alreadyHigher
                        ? 'bg-white/5 border border-white/10 text-white/30 cursor-not-allowed'
                        : 'bg-green-500 text-black hover:bg-green-400'
                    }`}
                >
                  {loadingPlan === plan.name ? (
                    <>
                      <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin"></div>
                      Redirecting...
                    </>
                  ) : (
                    owned ? '✓ You\'re on this plan' : alreadyHigher ? 'Already included in your plan' : `Select ${plan.name}`
                  )}
                </button>

              </article>
            );
          })}
        </div>
      </div>
      <footer className="relative z-10 border-t border-white/10 mt-12 pt-6 text-center text-sm text-white/40">
        <div className="flex items-center justify-center gap-3">
          <Zap className="w-4 h-4" />
          Secure checkout via Stripe
        </div>
        <p className="mt-2">Questions? Reach out via the dashboard chat once you are logged in.</p>
      </footer>
    </main>
  );
}
