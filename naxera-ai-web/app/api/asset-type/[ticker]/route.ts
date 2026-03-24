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

    // Use Yahoo Finance v7 quote endpoint directly via fetch from the Node.js server.
    // This bypasses CORS because the request is made server-to-server, NOT from the user's browser.
    const yahooRes = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}`);
    
    if (!yahooRes.ok) {
       return NextResponse.json({ assetType: 'stock', error: 'Yahoo Finance unreachable' });
    }

    const data = await yahooRes.json();
    const result = data.quoteResponse?.result?.[0];

    if (!result) {
      return NextResponse.json({ assetType: 'stock', error: 'Ticker not found' });
    }

    const qt = (result.quoteType || 'EQUITY').toUpperCase();
    
    let assetType = 'stock';
    if (qt === 'ETF' || qt === 'MUTUALFUND') assetType = 'etf';
    else if (qt === 'CRYPTOCURRENCY') assetType = 'crypto';

    return NextResponse.json({ assetType, quoteType: qt });
  } catch (error: any) {
    console.error('Error fetching asset type via Vercel fetch:', error);
    return NextResponse.json({ assetType: 'stock', error: error.message }, { status: 200 });
  }
}
