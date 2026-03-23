'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Mail, TrendingUp, ShieldCheck, Zap, Activity, LogOut, ArrowRight, HelpCircle, X, Lock } from 'lucide-react';
import { Session } from '@supabase/supabase-js';
import { upgradePlans, type UpgradePlan } from '@/lib/upgradePlans';
import { fetchUserPlan, canUseFrequency, PLAN_LIMITS, type Plan } from '@/lib/userPlan';

type Frequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export default function Home() {
  const router = useRouter();

  // --- AUTHENTICATION STATE ---
  const [session, setSession] = useState<Session | null>(null);
  const [authEmail, setAuthEmail] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const [showTechStack, setShowTechStack] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<UpgradePlan['name']>(upgradePlans[0].name);

  // --- ASSET TRACKING STATE ---
  const [ticker, setTicker] = useState('');
  const [shares, setShares] = useState('1'); // Default to 1 share
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [frequency, setFrequency] = useState<Frequency>('daily');
  const [plan, setPlan] = useState<Plan>('free');

  // --- UI INTERACTION STATE ---
  const [mousePos, setMousePos] = useState({ x: -1000, y: -1000 });

  // 1. Listen for secure logins & session changes
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        const userPlan = await fetchUserPlan(session.user.id);
        setPlan(userPlan);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const scrollToUpgradeSection = () => {
    const target = document.getElementById('upgrade-plan');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // 2. Handle Magic Link Sign In
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthMessage('');

    const { error } = await supabase.auth.signInWithOtp({
      email: authEmail,
      options: {
        emailRedirectTo: `${window.location.origin}/manage`, // Send them to the dashboard!
      }
    });

    if (error) {
      setAuthMessage(error.message);
    } else {
      setAuthMessage('Secure link sent! Check your inbox.');
    }
    setAuthLoading(false);
  };

  // 3. Handle Logging Out
  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.refresh();
  };

  const handleSelectPlan = (planName: UpgradePlan['name']) => {
    setSelectedPlan(planName);
    router.push(`/upgrade?plan=${planName.toLowerCase()}`);
  };

  // 4. Handle Adding an Asset
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');

    // --- NEW: Promise TypeScript the session exists ---
    if (!session || !session.user) {
      setErrorMessage('Secure session not found. Please log in again.');
      setStatus('error');
      return;
    }

    // Basic Validation
    if (!ticker) {
      setErrorMessage('Please fill in the ticker.');
      setStatus('error');
      return;
    }

    if (parseFloat(shares) <= 0) {
      setErrorMessage('You must own at least a fraction of a share!');
      setStatus('error');
      return;
    }

    try {
      // --- Plan limit check ---
      const { count: stockCount } = await supabase
        .from('subscriptions')
        .select('uuid', { count: 'exact', head: true })
        .eq('user_id', session.user.id)
        .eq('active', true);

      const limit = PLAN_LIMITS[plan];
      if ((stockCount ?? 0) >= limit) {
        setErrorMessage(
          plan === 'free'
            ? 'Free plan is limited to 3 stocks. Upgrade to Core for more.'
            : 'Core plan is limited to 10 stocks. Upgrade to Pro for unlimited.'
        );
        setStatus('error');
        return;
      }

      // --- ETF/Crypto plan gate ---
      // Use Yahoo Finance v7 quote endpoint which reliably returns quoteType
      // Use our backend API route to bypass CORS issues from Yahoo Finance
      let detectedAssetType = 'stock';
      try {
        const typeRes = await fetch(`/api/asset-type/${encodeURIComponent(ticker.toUpperCase())}`);
        if (typeRes.ok) {
          const typeData = await typeRes.json();
          detectedAssetType = typeData.assetType || 'stock';
          const isEtfOrCrypto = detectedAssetType === 'etf' || detectedAssetType === 'crypto';
          
          if (isEtfOrCrypto && plan === 'free') {
            setErrorMessage('ETFs and crypto require a Core or Pro plan. Upgrade to unlock.');
            setStatus('error');
            return;
          }
        }
      } catch {
        // If the check fails, allow the add to proceed (fail open)
      }

      // Check for existing rows (active OR inactive)
      const { data: existingSubscription } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('ticker', ticker.toUpperCase())
        .maybeSingle();

      if (existingSubscription) {
        if (existingSubscription.active) {
          // Genuinely already tracking it
          setErrorMessage('You are already tracking this stock!');
          setStatus('error');
          return;
        } else {
          // Was deleted — re-activate it instead of inserting a duplicate
          const { error: reactivateError } = await supabase
            .from('subscriptions')
            .update({
              active: true,
              shares: parseFloat(shares) || 1,
              frequency: frequency,
              asset_type: detectedAssetType,
            })
            .eq('uuid', existingSubscription.uuid);

          if (reactivateError) throw reactivateError;
          setStatus('success');
          setTicker('');
          setShares('1');
          return;
        }
      }

      // Insert new stock tied to their secure ID
      const { error } = await supabase
        .from('subscriptions')
        .insert([
          { 
            email: session.user.email,
            user_id: session.user.id,
            ticker: ticker.toUpperCase(), 
            shares: parseFloat(shares) || 1,
            active: true,
            frequency: frequency,
            asset_type: detectedAssetType,
          }
        ]);

      if (error) throw error;

      setStatus('success');
      setTicker('');
      setShares('1');
    } catch (error) {
      const err = error as Error;
      console.error('Error:', err);
      setErrorMessage(err.message || 'Something went wrong. Please try again.');
      setStatus('error');
    }
  };

  return (
    <main 
      className="min-h-screen bg-black text-white selection:bg-green-500/30 relative overflow-hidden"
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }}
      onMouseLeave={() => setMousePos({ x: -1000, y: -1000 })}
    >
      {/* Background Grids (Moved to Main container to cover entire page) */}
      {/* Soft blue glow */}
      <div
        className="absolute inset-0 pointer-events-none transition-all duration-75 z-0"
        style={{
          background: `radial-gradient(400px circle at ${mousePos.x}px ${mousePos.y}px, rgba(59,130,246,0.35), rgba(0,0,0,0))`,
        }}
      />

      {/* Navigation */}
    <nav className="flex items-center justify-between px-6 py-6 max-w-7xl mx-auto relative z-10">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 bg-white/10 rounded-full flex items-center justify-center">
          <span className="font-bold font-mono text-white">N</span>
        </div>
      </div>

      {/* Right side of navbar */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push('/upgrade')}
          className="text-sm font-medium text-white/70 hover:text-white/90 border border-white/10 rounded-full px-3 py-1 transition-colors"
        >
          Upgrade plan
        </button>

        <div className="hidden md:flex items-center gap-2 bg-green-500/10 border border-green-500/20 px-3 py-1 rounded-full">
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
          <span className="text-xs font-medium text-green-400">Now Live: Naxera AI v3.0</span>
          </div>
          
          {/* Dynamic Navbar: Show Dashboard/Logout if logged in */}
          {session ? (
            <div className="flex gap-4 items-center">
              <button onClick={() => router.push('/manage')} className="text-sm font-medium text-white/70 hover:text-white transition-colors">
                Dashboard
              </button>
              <button onClick={handleLogout} className="text-sm font-medium text-red-400/70 hover:text-red-400 transition-colors flex items-center gap-1" title="Log out">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <span className="text-sm font-medium text-white/50">Enterprise Auth Enabled</span>
          )}
      </div>
    </nav>

      {/* Hero Section */}
      <section className="flex flex-col items-center justify-center text-center px-4 mt-20 mb-32 relative z-10">
        
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-b from-white to-white/60 z-10">
          Financial Intelligence, <br />
          <span className="text-white">Automated.</span>
        </h1>
        
        <p className="text-lg text-white/40 max-w-2xl mb-12 z-10">
          Wake up to a deep-dive analysis of your favorite stock. Powered by Multi-Agent AI, Goldman Sachs logic, and real-time data.
        </p>

        {/* Dynamic Card Area */}
        <div className="w-full max-w-md bg-white/5 border border-white/10 rounded-2xl p-2 shadow-2xl backdrop-blur-sm z-10 transition-all duration-300">
          
          {!session ? (
            /* --- STATE 1: THE AUTH WALL --- */
            <form onSubmit={handleLogin} className="p-6 flex flex-col gap-4 animate-in fade-in zoom-in duration-300">
              <div className="text-center mb-2">
                <h3 className="text-xl font-semibold text-white">Welcome to Naxera AI</h3>
                <p className="text-sm text-white/50 mt-1">Enter your email to securely log in or sign up.</p>
              </div>
              
              <div className="relative">
                <Mail className="absolute left-4 top-3.5 w-5 h-5 text-white/30" />
                <input 
                  type="email" 
                  placeholder="name@company.com"
                  className="w-full bg-white/5 border border-white/10 rounded-lg pl-12 pr-4 py-3 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-green-500/50 transition-all"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  required
                />
              </div>

              <button 
                type="submit"
                disabled={authLoading}
                className="w-full bg-white text-black font-semibold rounded-lg py-3 mt-2 hover:bg-white/90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {authLoading ? 'Sending Protocol...' : 'Continue with Email'}
                {!authLoading && <ArrowRight className="w-4 h-4" />}
              </button>

              {authMessage && (
                <p className={`text-sm text-center mt-2 ${authMessage.includes('sent') ? 'text-green-400' : 'text-red-400'}`}>
                  {authMessage}
                </p>
              )}
            </form>

          ) : status === 'success' ? (
            /* --- STATE 2: SUCCESS --- */
            <div className="p-8 flex flex-col items-center justify-center text-center animate-in fade-in zoom-in duration-300">
              <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mb-4">
                <ShieldCheck className="w-8 h-8 text-green-400" />
              </div>
              <h3 className="text-2xl font-semibold text-white mb-2">Asset Locked.</h3>
              <p className="text-white/50 mb-6">Tracking active for {session.user.email}</p>
              
              {/* NEW: Side-by-side links with the dot separator */}
              <div className="flex items-center justify-center gap-3">
                <button 
                  onClick={() => setStatus('idle')}
                  className="text-sm text-white/70 hover:text-white transition-colors"
                >
                  Add another stock
                </button>
                <span className="text-white/30 text-lg leading-none">•</span>
                <button 
                  onClick={() => router.push('/manage')}
                  className="text-sm text-white/70 hover:text-white transition-colors"
                >
                  View Dashboard
                </button>
              </div>
            </div>
            
          ) : (
            /* --- STATE 3: ADD ASSET (LOGGED IN) --- */
            <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4 animate-in fade-in zoom-in duration-300">
              <div className="text-center mb-2">
                <p className="text-xs text-green-400 font-mono mb-1">SECURE SESSION ACTIVE</p>
                <p className="text-sm text-white/50">{session.user.email}</p>
              </div>

              <div className="flex gap-2">
                <div className="space-y-1 text-left flex-1">
                  <label className="text-xs font-medium text-white/50 ml-1">Asset</label>
                  <div className="relative">
                    <Activity className="absolute left-4 top-3.5 w-5 h-5 text-white/30" />
                    <input 
                      type="text" 
                      placeholder="Ticker (e.g. NVDA, BTC-USD)"
                      className="w-full bg-white/5 border border-white/10 rounded-lg pl-12 pr-4 py-3 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-green-500/50 transition-all uppercase"
                      value={ticker}
                      onChange={(e) => setTicker(e.target.value.toUpperCase())}
                    />
                    <p className="text-[10px] text-white/30 mt-1 ml-1">For crypto, add -USD (e.g. BTC-USD)</p>

                  </div>
                </div>

                <div className="space-y-1 text-left w-28">
                  <label className="text-xs font-medium text-white/50 ml-1">Shares</label>
                  <input 
                    type="number" 
                    min="0.01"
                    step="any"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-green-500/50 transition-all text-center"
                    value={shares}
                    onChange={(e) => setShares(e.target.value)}
                  />
                </div>
              </div>

              {/* Frequency Selection */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-white/50 ml-1 text-left uppercase tracking-widest">Email Frequency</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {(['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as Frequency[]).map((f) => {
                    const isLocked = f !== 'daily' && !canUseFrequency(plan);
                    const isActive = frequency === f;
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() => {
                          if (isLocked) { router.push('/upgrade'); return; }
                          setFrequency(f);
                        }}
                        title={isLocked ? 'Upgrade to Core to unlock' : f}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 border flex items-center gap-1
                          ${isLocked
                            ? 'border-white/5 bg-white/[0.02] text-white/20'
                            : isActive
                              ? 'border-green-400/70 bg-green-500/15 text-green-300 shadow-[0_0_0_1px_rgba(74,222,128,0.4)]'
                              : 'border-white/10 bg-white/5 text-white/40 hover:border-white/30 hover:text-white/70'
                          }`}
                      >
                        {isLocked && <Lock className="w-2.5 h-2.5" />}
                        {f.charAt(0).toUpperCase() + f.slice(1)}
                      </button>
                    );
                  })}
                </div>
                {!canUseFrequency(plan) && session && (
                  <p className="text-[11px] text-white/25 text-center">
                    🔒 <button type="button" onClick={() => router.push('/upgrade')} className="underline hover:text-white/50 transition-colors">Upgrade to Core</button> to unlock all frequencies
                  </p>
                )}
              </div>

              <button 
                type="submit"
                disabled={status === 'loading'}
                className="w-full bg-white text-black font-semibold rounded-lg py-3 mt-2 hover:bg-white/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {status === 'loading' ? (
                  <span className="animate-pulse">Syncing...</span>
                ) : (
                  <>
                    <span>Start Tracking</span>
                    <TrendingUp className="w-4 h-4" />
                  </>
                )}
              </button>

              {status === 'error' && (
                <p className="text-red-400 text-sm text-center mt-2">{errorMessage}</p>
              )}
              </form>
            )}
          </div>


        {/* Social Proof / Footer */}
        <div className="mt-12 flex items-center gap-6 text-white/20">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4" />
            <span className="text-sm">Instant Setup</span>
          </div>
          <div className="w-1 h-1 bg-white/20 rounded-full"></div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" />
            <span className="text-sm">Bank-Grade Privacy</span>
          </div>
        </div>
      </section>

      <footer className="w-full py-6 text-center text-white/10 text-sm">
        <p>Built with LangGraph, Llama 3, and Next.js</p>
      </footer>

      {/* --- TECH STACK FLOATING BUTTON --- */}
      <button
        onClick={() => setShowTechStack(true)}
        className="fixed bottom-6 right-6 bg-white/10 hover:bg-white/20 text-white/50 hover:text-white p-3 rounded-full backdrop-blur-md transition-all z-40 border border-white/10 shadow-2xl"
        title="Architecture & Tech Stack"
      >
        <HelpCircle className="w-6 h-6" />
      </button>

      {/* --- TECH STACK MODAL --- */}
      {showTechStack && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto relative flex flex-col animate-in zoom-in-95 duration-200">
            
            {/* Modal Header */}
            <div className="sticky top-0 bg-[#0a0a0a]/95 backdrop-blur-md p-6 border-b border-white/10 flex justify-between items-start z-10">
              <div>
                <h2 className="text-2xl font-bold text-white">System Architecture</h2>
                <p className="text-white/50 text-sm mt-1 font-mono">Naxera AI v3.0 • Built for Scale</p>
              </div>
              <button 
                onClick={() => setShowTechStack(false)} 
                className="text-white/50 hover:text-white p-2 rounded-lg hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-8 text-left">
              
              {/* Frontend & Auth */}
              <div>
                <h3 className="text-green-400 font-mono text-sm font-bold mb-3 uppercase tracking-wider">Frontend & Identity</h3>
                <ul className="space-y-2 text-white/70 text-sm">
                  <li><strong className="text-white">Framework:</strong> Next.js 14 (React) with Tailwind CSS for highly responsive, dark-mode-first styling.</li>
                  <li><strong className="text-white">Authentication:</strong> Supabase Auth utilizing passwordless Magic Links for secure, frictionless onboarding.</li>
                  <li><strong className="text-white">State Management:</strong> React Hooks (`useState`, `useEffect`) handling dynamic session rendering and API states.</li>
                </ul>
              </div>

              {/* Backend & Database */}
              <div>
                <h3 className="text-green-400 font-mono text-sm font-bold mb-3 uppercase tracking-wider">Backend & Security</h3>
                <ul className="space-y-2 text-white/70 text-sm">
                  <li><strong className="text-white">Database:</strong> Supabase (PostgreSQL) storing active tickers and user relationships.</li>
                  <li><strong className="text-white">Security:</strong> Strict Row-Level Security (RLS) policies enforcing multi-tenant data isolation. Users can only query and mutate data tied to their encrypted `auth.uid()`.</li>
                </ul>
              </div>

              {/* AI & Automation Engine */}
              <div>
                <h3 className="text-green-400 font-mono text-sm font-bold mb-3 uppercase tracking-wider">Multi-Agent AI Engine</h3>
                <ul className="space-y-2 text-white/70 text-sm">
                  <li><strong className="text-white">Orchestration:</strong> LangGraph state-machine routing data between Researcher, Quant, and Analyst nodes.</li>
                  <li><strong className="text-white">LLM:</strong> Llama-3.3-70b (via Groq API) prompted with institutional persona constraints and strict JSON output formatting.</li>
                  <li><strong className="text-white">Quantitative Math:</strong> Custom Python engine using `yfinance` and `pandas` to calculate live 50/200-day SMAs and 14-day RSI.</li>
                  <li><strong className="text-white">Market News:</strong> Tavily API for localized, real-time broad market context.</li>
                </ul>
              </div>

              {/* DevOps */}
              <div>
                <h3 className="text-green-400 font-mono text-sm font-bold mb-3 uppercase tracking-wider">DevOps & Cloud</h3>
                <ul className="space-y-2 text-white/70 text-sm">
                  <li><strong className="text-white">Hosting:</strong> Vercel (Frontend edge delivery).</li>
                  <li><strong className="text-white">Automation:</strong> Serverless GitHub Actions executing the Python LangGraph script via a CRON job at 5:43 AM PST to optimize server queue times and ensure a 6:00 AM delivery.</li>
                </ul>
              </div>

            </div>
          </div>
        </div>
      )}    
    </main>
  );
}
