import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { exec } from 'child_process';
import path from 'path';

export async function POST(request: Request) {
  try {
    const { userId, email, timescale } = await request.json();
    
    if (!userId || !email) {
      return NextResponse.json({ error: 'Missing userId or email' }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    );

    
    // Fetch profile to check plan and rate limit
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('plan, last_manual_trigger')
      .eq('id', userId)
      .single();
      
    if (error || !profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }
    
    // Enforce Pro-only
    if (profile.plan !== 'pro') {
      return NextResponse.json({ error: 'Requires Pro Plan' }, { status: 403 });
    }
    
    // 1-Hour Rate limit check
    if (profile.last_manual_trigger) {
      const lastTrigger = new Date(profile.last_manual_trigger);
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      
      if (lastTrigger > oneHourAgo) {
        const timeRemainingMs = lastTrigger.getTime() - oneHourAgo.getTime();
        const minsLeft = Math.ceil(timeRemainingMs / (60 * 1000));
        return NextResponse.json({ 
          error: `Rate limited. Please wait ${minsLeft} minute(s) before running again.` 
        }, { status: 429 });
      }
    }
    
    // Update the last_manual_trigger timestamp in DB
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ last_manual_trigger: new Date().toISOString() })
      .eq('id', userId);
      
    if (updateError) {
      return NextResponse.json({ error: 'Failed to update rate limit' }, { status: 500 });
    }
    
    // Fire and forget the GitHub Actions workflow!
    const githubRes = await fetch(
      'https://api.github.com/repos/rohilshah2006/naxera-ai/actions/workflows/daily_report.yml/dispatches',
      {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Naxera-AI-Vercel'
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: {
            user_id: userId,
            email: email,
            timescale: timescale || 'all'
          }
        })
      }
    );

    if (!githubRes.ok) {
      const errText = await githubRes.text();
      console.error("GitHub Action Trigger Error:", errText);
      return NextResponse.json({ error: 'Failed to trigger background job on GitHub' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "Report generated successfully! Check your email in 1-2 minutes." });
    
  } catch (err: any) {
    console.error('Manual Trigger Exception:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
