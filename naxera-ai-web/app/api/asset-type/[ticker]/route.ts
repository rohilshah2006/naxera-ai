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
    // Extract ticker from URL path manually to avoid Next.js 14/15 params bugs
    const url = new URL(request.url);
    const parts = url.pathname.split('/');
    const ticker = decodeURIComponent(parts[parts.length - 1]);

    
    // Use the python environment in the parent directory
    const pythonPath = path.resolve(process.cwd(), '../venv/bin/python3');
    
    // We execute a tiny python script that uses yfinance to get the quoteType.
    // This perfectly mimics how tools.py fetches data without triggering Yahoo's rate limits.
    const script = `import yfinance as yf; import sys; print(yf.Ticker(sys.argv[1]).info.get('quoteType', 'EQUITY'))`;
    
    let execResult;
    try {
      execResult = await execAsync(`"${pythonPath}" -c "${script}" ${ticker}`);
    } catch (e: any) {
      return NextResponse.json({ assetType: 'stock', error: e.message, stderr: e.stderr });
    }
    
    const { stdout, stderr } = execResult;
    const qt = stdout.trim().toUpperCase();
    
    let assetType = 'stock';
    if (qt === 'ETF' || qt === 'MUTUALFUND') assetType = 'etf';
    else if (qt === 'CRYPTOCURRENCY') assetType = 'crypto';

    return NextResponse.json({ assetType, quoteType: qt });
  } catch (error) {
    console.error('Error fetching asset type via python:', error);
    return NextResponse.json({ assetType: 'stock' }, { status: 200 });
  }
}
