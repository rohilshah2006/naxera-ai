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

    // The /v8/finance/chart endpoint is extremely robust and provides the 'instrumentType' in its metadata.
    const yahooRes = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`);
    
    if (!yahooRes.ok) {
       return NextResponse.json({ assetType: 'stock', error: 'Yahoo Finance unreachable' });
    }

    const data = await yahooRes.json();
    const meta = data.chart?.result?.[0]?.meta;

    if (!meta) {
      return NextResponse.json({ assetType: 'stock', error: 'Ticker not found' });
    }

    const it = (meta.instrumentType || 'EQUITY').toUpperCase();
    
    let assetType = 'stock';
    if (it === 'ETF' || it === 'MUTUALFUND') assetType = 'etf';
    else if (it === 'CRYPTOCURRENCY') assetType = 'crypto';

    return NextResponse.json({ assetType, instrumentType: it });
  } catch (error: any) {
    console.error('Error fetching asset type:', error);
    return NextResponse.json({ assetType: 'stock', error: error.message }, { status: 200 });
  }
}
