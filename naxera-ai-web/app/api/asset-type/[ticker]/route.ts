import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';

const execAsync = util.promisify(exec);

export async function GET(
  request: Request,
  { params }: { params: any }
) {
  try {
    const url = new URL(request.url);
    const parts = url.pathname.split('/');
    const ticker = decodeURIComponent(parts[parts.length - 1]).toUpperCase();

    console.log(`[Asset-Type] Fetching for ${ticker}...`);

    // Add cache: 'no-store' to bypass Vercel/Next.js caching
    const yahooRes = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&range=1d`,
      { cache: 'no-store' }
    );
    
    if (!yahooRes.ok) {
       console.error(`[Asset-Type] Yahoo reached but failed for ${ticker}: ${yahooRes.status}`);
       return NextResponse.json({ assetType: 'stock', error: 'Yahoo Finance unreachable' });
    }

    const data = await yahooRes.json();
    const meta = data.chart?.result?.[0]?.meta;

    if (!meta) {
      console.warn(`[Asset-Type] Ticker ${ticker} not found in chart API.`);
      return NextResponse.json({ assetType: 'stock', error: 'Ticker not found' });
    }

    const rawType = (meta.instrumentType || 'EQUITY').toUpperCase();
    console.log(`[Asset-Type] Ticker ${ticker} raw type: ${rawType}`);
    
    let assetType = 'stock';
    // More inclusive matching for ETFs and Mutual Funds
    if (rawType.includes('ETF') || rawType.includes('MUTUAL') || rawType.includes('FUND')) {
      assetType = 'etf';
    } else if (rawType.includes('CRYPTOCURRENCY') || rawType.includes('COIN')) {
      assetType = 'crypto';
    }

    return NextResponse.json({ assetType, instrumentType: rawType });
  } catch (error: any) {
    console.error(`[Asset-Type] Exception fetching asset type:`, error);
    return NextResponse.json({ assetType: 'stock', error: error.message }, { status: 200 });
  }
}
