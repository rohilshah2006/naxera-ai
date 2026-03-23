import yfinance as yf
import os
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from datetime import timedelta

# ... (keep your existing get_financial_metrics function) ...

def generate_stock_chart(ticker: str, frequency: str = 'daily'):
    """
    Generates a stock chart whose time window matches the email frequency:
      daily     → last 24 hours  (30m bars)
      weekly    → last 7 days    (1d bars)
      monthly   → last 30 days   (1d bars)
      quarterly → last 4 months  (1wk bars)
      yearly    → last 1 year    (1wk bars)
    """
    FREQ_CONFIG = {
        'daily':     {'period': '5d',  'interval': '30m',  'label': 'Last 24 Hours',  'date_fmt': '%H:%M'},
        'weekly':    {'period': '1mo', 'interval': '1d',   'label': 'Last 7 Days',    'date_fmt': '%b %d'},
        'monthly':   {'period': '3mo', 'interval': '1d',   'label': 'Last 1 Month',   'date_fmt': '%b %d'},
        'quarterly': {'period': '1y',  'interval': '1wk',  'label': 'Last 4 Months',  'date_fmt': '%b %Y'},
        'yearly':    {'period': '2y',  'interval': '1wk',  'label': 'Last 1 Year',    'date_fmt': '%b %Y'},
    }
    cfg = FREQ_CONFIG.get(frequency, FREQ_CONFIG['daily'])

    try:
        stock = yf.Ticker(ticker)
        hist = stock.history(period=cfg['period'], interval=cfg['interval'])

        if hist.empty:
            print("⚠️ No price history found.")
            return None

        # For daily, slice to the last 24 hours exactly (same logic as before)
        if frequency == 'daily':
            last_timestamp = hist.index[-1]
            start_timestamp = last_timestamp - timedelta(hours=24)
            subset = hist[hist.index >= start_timestamp]
            if subset.empty:
                return None
        # For weekly, keep only the last 7 calendar days
        elif frequency == 'weekly':
            last_timestamp = hist.index[-1]
            start_timestamp = last_timestamp - timedelta(days=7)
            subset = hist[hist.index >= start_timestamp]
            if subset.empty:
                subset = hist  # fallback
        # For monthly: last 30 days
        elif frequency == 'monthly':
            last_timestamp = hist.index[-1]
            start_timestamp = last_timestamp - timedelta(days=30)
            subset = hist[hist.index >= start_timestamp]
            if subset.empty:
                subset = hist
        # quarterly / yearly: use all returned data (period already constrains it)
        else:
            subset = hist

        plt.switch_backend('Agg')
        plt.figure(figsize=(10, 5))

        start_price = subset['Open'].iloc[0]
        end_price = subset['Close'].iloc[-1]
        color = '#166534' if end_price >= start_price else '#991b1b'

        plt.plot(subset.index, subset['Close'], color=color, linewidth=2)
        plt.fill_between(subset.index, subset['Close'], min(subset['Close']), color=color, alpha=0.1)

        plt.gca().xaxis.set_major_formatter(mdates.DateFormatter(cfg['date_fmt']))
        plt.title(f"{ticker} • {cfg['label']}", fontsize=14, fontweight='bold', color='#333')
        plt.grid(True, linestyle='--', alpha=0.3)
        plt.xticks(rotation=0)
        plt.gca().spines['top'].set_visible(False)
        plt.gca().spines['right'].set_visible(False)

        filename = f"{ticker}_chart.png"
        plt.savefig(filename, bbox_inches='tight')
        plt.close()

        print(f"📈 Chart generated ({cfg['label']}): {filename}")
        return filename

    except Exception as e:
        print(f"❌ Failed to generate chart: {e}")
        return None


import resend

def send_email(to: str, subject: str, body: str, attachments=None):
    try:
        resend.api_key = os.getenv("RESEND_API_KEY")
        
        # Prepare Resend payload
        sender_email = os.getenv("SENDER_EMAIL") or "Naxera AI <onboarding@resend.dev>"
        params: resend.Emails.SendParams = {
            # You must use a verified domain here if you have one on Resend.
            # Otherwise it falls back to the testing email onboarding@resend.dev
            "from": sender_email, 
            "to": [to],
            "subject": subject,
            "html": body,
        }

        # Handle attachments specifically for Resend
        if attachments:
            resend_attachments = []
            for filepath in attachments:
                if os.path.exists(filepath):
                    with open(filepath, "rb") as f:
                        file_data = list(f.read()) # Resend accepts a list of bytes
                    resend_attachments.append({
                        "filename": os.path.basename(filepath),
                        "content": file_data
                    })
            if resend_attachments:
                params["attachments"] = resend_attachments

        # Send the email
        email_response = resend.Emails.send(params)
        print(f"📧 Email sent to {to} via Resend! ID: {email_response}")
        return True
        
    except Exception as e:
        print(f"❌ Failed to send email via Resend: {e}")
        return False

def get_financial_metrics(ticker: str):
    """
    Fetches key financial data using yfinance.
    Works for stocks, ETFs, and crypto by trying multiple price fields.
    """
    try:
        stock = yf.Ticker(ticker)
        info = stock.info

        # --- PRICE FALLBACK CHAIN ---
        price = (
            info.get("currentPrice")
            or info.get("regularMarketPrice")
            or info.get("previousClose")
            or info.get("navPrice")   # some ETFs expose NAV
            or 0
        )
        try:
            price = float(price)
        except (TypeError, ValueError):
            price = 0.0

        # P/E: not available for most ETFs or crypto
        pe_raw = info.get("trailingPE")
        pe_ratio = round(float(pe_raw), 2) if pe_raw is not None else "N/A"

        # Analyst target: stocks only, ETFs/crypto get N/A
        target = info.get("targetMeanPrice")

        # Company summary: safe slice
        raw_summary = info.get("longBusinessSummary") or "No description available."
        company_summary = raw_summary[:500] + "..." if len(raw_summary) > 500 else raw_summary

        # --- ASSET TYPE ---
        quote_type = (info.get("quoteType") or "").upper()
        QUOTE_TYPE_MAP = {
            "EQUITY":         "Stock",
            "ETF":            "ETF",
            "CRYPTOCURRENCY": "Crypto",
            "MUTUALFUND":     "Mutual Fund",
            "INDEX":          "Index",
            "FUTURE":         "Futures",
        }
        asset_type = QUOTE_TYPE_MAP.get(quote_type, "Stock")

        financial_data = {
            "current_price": price,
            "market_cap": info.get("marketCap"),
            "pe_ratio": pe_ratio,
            "target_mean_price": target,
            "recommendation": info.get("recommendationKey"),
            "company_summary": company_summary,
            "asset_type": asset_type,
        }
        return financial_data
    except Exception as e:
        print(f"Error fetching data for {ticker}: {e}")
        return {"asset_type": "Stock"}