'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { fetchUserPlan, canUseFrequency, canUseTrigger, PLAN_LIMITS, PLAN_LABELS, PLAN_COLORS, LANGUAGE_LEVEL_OPTIONS, fetchUserLanguageLevel, type Plan, type LanguageLevel } from '@/lib/userPlan';
import { ShieldCheck, Trash2, Activity, Plus, LogOut, Lock, Zap, BookOpen, Bell, BellOff } from 'lucide-react';

type PriceAlert = {
  id: string;
  ticker: string;
  threshold_price: number;
  direction: 'above' | 'below';
  active: boolean;
};

type Frequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

type Stock = {
  uuid: string;
  ticker: string;
  shares: number;
  frequency: Frequency;
  asset_type: string;
};

const FREQUENCY_OPTIONS: { value: Frequency; label: string; description: string }[] = [
  { value: 'daily',     label: 'Daily',     description: 'Every weekday morning' },
  { value: 'weekly',    label: 'Weekly',    description: 'Every Monday' },
  { value: 'monthly',   label: 'Monthly',   description: '1st of each month' },
  { value: 'quarterly', label: 'Quarterly', description: '4× per year' },
  { value: 'yearly',    label: 'Yearly',    description: 'Jan 1st each year' },
];

export default function ManagePage() {
  const router = useRouter();
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<Plan>('free');
  const [languageLevel, setLanguageLevel] = useState<LanguageLevel>('regular');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>([]);
  const [alertTicker, setAlertTicker] = useState('');
  const [alertPrice, setAlertPrice] = useState('');
  const [alertDirection, setAlertDirection] = useState<'above' | 'below'>('below');
  const [alertSaving, setAlertSaving] = useState(false);


  useEffect(() => {
    checkUserAndFetchStocks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkUserAndFetchStocks = async () => {
    try {
      const { data: { session }, error: authError } = await supabase.auth.getSession();
      if (authError || !session) {
        router.push('/');
        return;
      }
      setEmail(session.user.email || '');

      // Fetch plan, language level, and stocks in parallel
      const [userPlan, userLang, stocksResult] = await Promise.all([
        fetchUserPlan(session.user.id),
        fetchUserLanguageLevel(session.user.id),
        supabase
          .from('subscriptions')
          .select('uuid, ticker, shares, frequency, asset_type')
          .eq('user_id', session.user.id)
          .eq('active', true),
      ]);

      setPlan(userPlan);
      setLanguageLevel(userLang);

      // --- NEW: SELF-HEALING SYNC ---
      // If any stocks are found matching this email but with a DIFFERENT user_id, 
      // it means they belong to a legacy account iteration. Move them to the new ID.
      const { data: orphans } = await supabase
        .from('subscriptions')
        .select('uuid')
        .eq('email', session.user.email)
        .neq('user_id', session.user.id);
      
      if (orphans && orphans.length > 0) {
        console.log(`[Manage] Self-healing initiated: Migrating ${orphans.length} orphaned stocks to new UUID...`);
        await supabase
          .from('subscriptions')
          .update({ user_id: session.user.id })
          .eq('email', session.user.email);
        
        // RE-FETCH stocks now that they are linked
        const refetched = await supabase
          .from('subscriptions')
          .select('uuid, ticker, shares, frequency, asset_type')
          .eq('user_id', session.user.id)
          .eq('active', true);
        stocksResult.data = refetched.data;
      }
      // -------------------------------

      // Safety: Ensure a profile row exists for all users
      console.log(`[Manage] Ensuring profile exists for user ID: ${session.user.id}`);
      const { data: profileCheck, error: checkError } = await supabase.from('profiles').select('id').eq('id', session.user.id).maybeSingle();
      
      if (checkError) {
        console.error('[Manage] Profile check error:', checkError);
      }

      if (!profileCheck) {
        console.log('[Manage] No profile found. Creating fresh profile...');
        const { error: insertError } = await supabase.from('profiles').insert([{ id: session.user.id, plan: 'free' }]);
        if (insertError) console.error('[Manage] Profile insert failed:', insertError);
        else console.log('[Manage] Fresh profile created successfully.');
      }

      if (stocksResult.error) throw stocksResult.error;

      const normalized = (stocksResult.data || []).map((s) => ({
        ...s,
        frequency: (s.frequency as Frequency) || 'daily',
        asset_type: s.asset_type || 'stock',
      }));

      setStocks(normalized);

      // Fetch price alerts (Pro users)
      if (userPlan === 'pro') {
        const { data: alertsData } = await supabase
          .from('price_alerts')
          .select('*')
          .eq('user_id', session.user.id)
          .eq('active', true)
          .order('created_at', { ascending: false });
        setPriceAlerts(alertsData || []);
      }
    } catch (error) {
      console.error('Error fetching dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddAlert = async () => {
    if (!alertTicker || !alertPrice) return;
    setAlertSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data, error } = await supabase.from('price_alerts').insert([{
      user_id: session.user.id,
      ticker: alertTicker.toUpperCase(),
      threshold_price: parseFloat(alertPrice),
      direction: alertDirection,
      active: true,
    }]).select().single();
    if (!error && data) {
      setPriceAlerts(prev => [data as PriceAlert, ...prev]);
      setAlertTicker('');
      setAlertPrice('');
    }
    setAlertSaving(false);
  };

  const handleDeleteAlert = async (id: string) => {
    await supabase.from('price_alerts').update({ active: false }).eq('id', id);
    setPriceAlerts(prev => prev.filter(a => a.id !== id));
  };

  const handleLanguageLevelChange = async (level: LanguageLevel) => {
    const isPaid = plan === 'core' || plan === 'pro';
    const opt = LANGUAGE_LEVEL_OPTIONS.find(o => o.value === level);
    if (opt?.requiresPaid && !isPaid) {
      router.push('/upgrade');
      return;
    }
    setLanguageLevel(level);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { error, count } = await supabase
      .from('profiles')
      .update({ language_level: level }, { count: 'exact' })
      .eq('id', session.user.id);
      
    if (error) {
      console.error('Error saving language level:', error);
      alert(`Error saving language level: ${error.message}`);
      checkUserAndFetchStocks(); // Rollback UI state
    } else if (count === 0) {
      console.warn('No rows updated for language level.');
      alert('Security Warning: No profile row was updated. If you are on an old account, please visit the Manage page again after 60 seconds.');
      checkUserAndFetchStocks();
    } else {
      console.log('Language level saved successfully!');
      // Optional: show a small success indicator
    }
  };

  const handleFrequencyChange = async (uuid: string, newFreq: Frequency) => {
    if (newFreq !== 'daily' && !canUseFrequency(plan)) {
      router.push('/upgrade');
      return;
    }
    setStocks((prev) =>
      prev.map((s) => (s.uuid === uuid ? { ...s, frequency: newFreq } : s))
    );
    setSavingId(uuid);

    const { error } = await supabase
      .from('subscriptions')
      .update({ frequency: newFreq })
      .eq('uuid', uuid);

    if (error) {
      console.error('Failed to update frequency:', error);
      checkUserAndFetchStocks();
    }
    setSavingId(null);
  };

  const handleDelete = async (rowId: string) => {
    await supabase
      .from('subscriptions')
      .update({ active: false })
      .eq('uuid', rowId);
    checkUserAndFetchStocks();
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  const [triggerLoading, setTriggerLoading] = useState(false);
  const [triggerTimescale, setTriggerTimescale] = useState<string>('all');

  const handleManualTrigger = async () => {
    setTriggerLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch('/api/manual-trigger', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          userId: session.user.id, 
          email: session.user.email,
          timescale: triggerTimescale 
        })
      });
      const data = await res.json();
      
      if (!res.ok) {
        alert(`❌ ${data.error || 'Failed to trigger report'}`);
      } else {
        alert(data.message);
      }
    } catch (err) {
      alert("❌ An unexpected error occurred.");
    } finally {
      setTriggerLoading(false);
    }
  };

  const stockLimit = PLAN_LIMITS[plan];
  const atLimit = stocks.length >= stockLimit;

  if (loading) {
    return (
      <main className="min-h-screen bg-[#050505] flex items-center justify-center">
        <div className="text-white/50 animate-pulse font-mono text-sm">Decrypting secure vault...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#050505] text-white px-4">

      {/* Navbar */}
      <nav className="flex items-center justify-between py-6 max-w-7xl mx-auto border-b border-white/10 mb-8">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => router.push('/')}>
          <img 
            src="/logo.png" 
            alt="Naxera AI" 
            className="w-8 h-8 rounded-full border border-white/10 object-cover"
          />
          <span className="font-bold font-mono text-white text-xl hidden sm:block">Naxera AI</span>
        </div>

        <button
          onClick={handleLogout}
          className="text-sm font-medium text-red-400/70 hover:text-red-400 transition-colors flex items-center gap-2"
        >
          <LogOut className="w-4 h-4" />
          <span className="hidden sm:block">Disconnect Session</span>
        </button>
      </nav>

      <div className="w-full max-w-2xl mx-auto bg-white/5 border border-white/10 rounded-2xl p-8 shadow-2xl backdrop-blur-sm">

        {/* Header */}
        <div className="flex items-center justify-between mb-8 border-b border-white/10 pb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-green-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-semibold text-white">Manage Portfolio</h2>
                {/* Plan badge */}
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${PLAN_COLORS[plan]}`}>
                  {PLAN_LABELS[plan]}
                </span>
              </div>
              <p className="text-white/50 text-sm">{email}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Pro: Manual trigger button */}
            {canUseTrigger(plan) && (
              <div className="flex items-center gap-2">
                <select 
                  value={triggerTimescale}
                  onChange={(e) => setTriggerTimescale(e.target.value)}
                  title="Select timescale to run"
                  className="bg-white/5 border border-white/10 rounded-xl px-2 py-2 text-xs text-white focus:outline-none focus:border-white/30 cursor-pointer"
                >
                  <option value="all">All</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
                <div className="relative">
                  <button
                    onClick={handleManualTrigger}
                    disabled={triggerLoading}
                    className="flex items-center gap-1.5 bg-green-500/10 hover:bg-green-500/20 disabled:opacity-50 border border-green-500/30 text-green-400 text-xs font-semibold px-3 py-2 rounded-xl transition-all"
                    title="Manually trigger a report"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    {triggerLoading ? 'Sending...' : 'Run Now'}
                  </button>
                </div>
              </div>
            )}

            {/* Add stock button — disabled if at plan limit */}
            <button
              onClick={() => atLimit ? router.push('/upgrade') : router.push('/')}
              className={`p-2 rounded-full transition-all ${
                atLimit
                  ? 'bg-white/5 text-white/20 cursor-not-allowed'
                  : 'bg-white/10 hover:bg-white/20 text-white/70 hover:text-white'
              }`}
              title={atLimit ? `${PLAN_LABELS[plan]} plan limit reached (${stockLimit} stocks)` : 'Add New Asset'}
            >
              <Plus className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Plan limit warning */}
        {atLimit && (
          <div className="mb-5 flex items-center justify-between bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-3 text-sm">
            <span className="text-amber-400/80">
              {plan === 'free'
                ? 'Free plan is limited to 3 stocks.'
                : 'Core plan is limited to 10 stocks.'
              } Upgrade to unlock more.
            </span>
            <button
              onClick={() => router.push('/upgrade')}
              className="text-xs font-semibold text-amber-400 hover:text-amber-300 ml-4 shrink-0"
            >
              Upgrade →
            </button>
          </div>
        )}

        {/* Price Alerts (Pro only) */}
        {plan === 'pro' ? (
          <div className="mb-6 bg-white/[0.03] border border-white/10 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Bell className="w-4 h-4 text-green-400/60" />
              <p className="text-xs font-mono text-white/40 uppercase tracking-widest">Price Alerts</p>
              <span className="ml-auto text-[10px] font-bold text-green-400 border border-green-400/30 px-2 py-0.5 rounded-full">PRO</span>
            </div>

            {/* Add Alert Row */}
            <div className="flex flex-wrap gap-2 mb-3">
              <input
                type="text"
                placeholder="Ticker (e.g. NVDA)"
                value={alertTicker}
                onChange={(e) => setAlertTicker(e.target.value.toUpperCase())}
                className="flex-1 min-w-24 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30"
              />
              <input
                type="number"
                placeholder="Price ($)"
                value={alertPrice}
                onChange={(e) => setAlertPrice(e.target.value)}
                className="w-28 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30"
              />
              <div className="flex rounded-lg overflow-hidden border border-white/10">
                <button
                  onClick={() => setAlertDirection('below')}
                  className={`px-3 py-2 text-xs font-semibold transition-all ${alertDirection === 'below' ? 'bg-red-500/20 text-red-400' : 'bg-white/5 text-white/40'}`}
                >Below</button>
                <button
                  onClick={() => setAlertDirection('above')}
                  className={`px-3 py-2 text-xs font-semibold transition-all ${alertDirection === 'above' ? 'bg-green-500/20 text-green-400' : 'bg-white/5 text-white/40'}`}
                >Above</button>
              </div>
              <button
                onClick={handleAddAlert}
                disabled={alertSaving || !alertTicker || !alertPrice}
                className="px-4 py-2 bg-green-500/20 border border-green-500/30 text-green-400 text-xs font-semibold rounded-lg hover:bg-green-500/30 transition-all disabled:opacity-40"
              >
                {alertSaving ? 'Saving…' : '+ Add Alert'}
              </button>
            </div>

            {/* Alert List */}
            {priceAlerts.length === 0 ? (
              <p className="text-xs text-white/25 text-center py-2">No active alerts. Add one above.</p>
            ) : (
              <div className="space-y-1.5">
                {priceAlerts.map((alert) => (
                  <div key={alert.id} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2 text-xs">
                    <span className="font-bold text-white">{alert.ticker}</span>
                    <span className={`font-semibold ${alert.direction === 'below' ? 'text-red-400' : 'text-green-400'}`}>
                      {alert.direction === 'below' ? '▼' : '▲'} ${alert.threshold_price.toLocaleString()}
                    </span>
                    <button onClick={() => handleDeleteAlert(alert.id)} className="text-white/30 hover:text-red-400 transition-colors">
                      <BellOff className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="mb-6 bg-white/[0.02] border border-white/5 rounded-xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-white/20" />
              <p className="text-xs text-white/25">Price Alerts — Pro feature</p>
            </div>
            <button onClick={() => router.push('/upgrade')} className="text-xs text-white/30 underline hover:text-white/50 transition-colors">Upgrade</button>
          </div>
        )}

        {/* Language Level Selector */}
        <div className="mb-6 bg-white/[0.03] border border-white/10 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen className="w-4 h-4 text-white/40" />
            <p className="text-xs font-mono text-white/40 uppercase tracking-widest">Email Language Level</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {LANGUAGE_LEVEL_OPTIONS.map((opt) => {
              const isActive = languageLevel === opt.value;
              const isPaid = plan === 'core' || plan === 'pro';
              const isLocked = opt.requiresPaid && !isPaid;
              return (
                <button
                  key={opt.value}
                  onClick={() => handleLanguageLevelChange(opt.value)}
                  title={isLocked ? 'Upgrade to Core to unlock' : opt.description}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 border flex items-center gap-1
                    ${isLocked
                      ? 'border-white/5 bg-white/[0.02] text-white/20'
                      : isActive
                        ? 'border-green-400/70 bg-green-500/15 text-green-300 shadow-[0_0_0_1px_rgba(74,222,128,0.4)]'
                        : 'border-white/10 bg-white/5 text-white/40 hover:border-white/30 hover:text-white/70'
                    }`}
                >
                  {isLocked && <Lock className="w-2.5 h-2.5" />}
                  {opt.label}
                </button>
              );
            })}
          </div>
          {!( plan === 'core' || plan === 'pro') && (
            <p className="text-[11px] text-white/25 mt-2">
              🔒 <button onClick={() => router.push('/upgrade')} className="underline hover:text-white/50 transition-colors">Upgrade to Core</button> to unlock Super Simple & Very Advanced
            </p>
          )}
        </div>

        {/* Stocks List */}
        {stocks.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-white/10 rounded-xl">
            <p className="text-white/50 mb-4">No active assets in your vault.</p>
            <button onClick={() => router.push('/')} className="text-green-400 hover:text-green-300 text-sm font-medium transition-colors">
              + Add your first stock
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            {stocks.map((stock) => (
              <div
                key={stock.uuid}
                className="bg-white/5 border border-white/10 rounded-xl p-5 transition-all hover:bg-white/[0.07]"
              >
                {/* Stock Header Row */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-4">
                    <div className="bg-white/10 p-2 rounded-md">
                      <Activity className="w-5 h-5 text-white/70" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-xl font-bold text-white uppercase">{stock.ticker}</h3>
                        {/* Asset type badge */}
                        {(() => {
                          const t = stock.asset_type?.toLowerCase() || 'stock';
                          const cfg = t === 'etf' ? { label: 'ETF', cls: 'border-blue-400/50 text-blue-400' }
                            : t === 'crypto' ? { label: 'Crypto', cls: 'border-amber-400/50 text-amber-400' }
                            : t === 'mutual fund' ? { label: 'Mutual Fund', cls: 'border-purple-400/50 text-purple-400' }
                            : { label: 'Stock', cls: 'border-white/20 text-white/40' };
                          return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.cls}`}>{cfg.label}</span>;
                        })()}
                      </div>
                      <p className="text-white/50 text-sm">
                        {stock.shares} {stock.shares === 1 ? 'share' : 'shares'}
                        {savingId === stock.uuid && (
                          <span className="ml-2 text-green-400/60 text-xs animate-pulse">saving…</span>
                        )}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => handleDelete(stock.uuid)}
                    className="text-red-400 hover:text-red-300 hover:bg-red-400/10 p-2 rounded-lg transition-all"
                    title="Remove Asset"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>

                {/* Frequency Selector */}
                <div>
                  <p className="text-xs font-mono text-white/30 mb-2 uppercase tracking-widest">Email Frequency</p>
                  <div className="flex flex-wrap gap-2">
                    {FREQUENCY_OPTIONS.map((opt) => {
                      const isActive = stock.frequency === opt.value;
                      const isLocked = opt.value !== 'daily' && !canUseFrequency(plan);
                      return (
                        <button
                          key={opt.value}
                          onClick={() => handleFrequencyChange(stock.uuid, opt.value)}
                          title={isLocked ? 'Upgrade to Core to unlock' : opt.description}
                          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 border flex items-center gap-1
                            ${isLocked
                              ? 'border-white/5 bg-white/[0.02] text-white/20 cursor-pointer'
                              : isActive
                                ? 'border-green-400/70 bg-green-500/15 text-green-300 shadow-[0_0_0_1px_rgba(74,222,128,0.4)]'
                                : 'border-white/10 bg-white/5 text-white/40 hover:border-white/30 hover:text-white/70'
                            }`}
                        >
                          {isLocked && <Lock className="w-2.5 h-2.5" />}
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  {!canUseFrequency(plan) && (
                    <p className="text-[11px] text-white/25 mt-1.5">
                      🔒 <button onClick={() => router.push('/upgrade')} className="underline hover:text-white/50 transition-colors">Upgrade to Core</button> to unlock all frequencies
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
