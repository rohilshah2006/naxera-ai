import yfinance as yf
import os
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from datetime import timedelta

# ... (keep your existing get_financial_metrics function) ...

def generate_stock_chart(ticker: str):
    """
    Generates a chart for the LAST 24 HOURS of trading data.
    """
    try:
        stock = yf.Ticker(ticker)
        # We fetch 5 days to be safe (in case of weekends/holidays)
        # Interval '30m' is good for a 24h view (48 bars)
        hist = stock.history(period="5d", interval="30m")
        
        if hist.empty:
            print("⚠️ No price history found.")
            return None
            
        # 1. Calculate the Window
        # Get the very last timestamp in the dataset
        last_timestamp = hist.index[-1]
        
        # Go back exactly 24 hours from that last moment
        start_timestamp = last_timestamp - timedelta(hours=24)
        
        # 2. Slice the Data
        # We only keep rows that are newer than 'start_timestamp'
        subset = hist[hist.index >= start_timestamp]
        
        if subset.empty:
            return None

        # 3. Setup the Plot
        plt.switch_backend('Agg') 
        plt.figure(figsize=(10, 5))
        
        # Color Logic (Green if it ended higher than it started)
        start_price = subset['Open'].iloc[0]
        end_price = subset['Close'].iloc[-1]
        color = '#166534' if end_price >= start_price else '#991b1b' # Dark Green / Dark Red
        
        # Plot Line
        plt.plot(subset.index, subset['Close'], color=color, linewidth=2)
        
        # Fill area under line for a "Robinhood" look
        plt.fill_between(subset.index, subset['Close'], min(subset['Close']), color=color, alpha=0.1)
        
        # Formatting Time Axis
        plt.gca().xaxis.set_major_formatter(mdates.DateFormatter('%H:%M'))
        plt.title(f"{ticker} • Last 24 Hours", fontsize=14, fontweight='bold', color='#333')
        plt.grid(True, linestyle='--', alpha=0.3)
        plt.xticks(rotation=0)
        
        # Clean up borders
        plt.gca().spines['top'].set_visible(False)
        plt.gca().spines['right'].set_visible(False)
        
        # 4. Save
        filename = f"{ticker}_chart.png"
        plt.savefig(filename, bbox_inches='tight')
        plt.close()
        
        print(f"📈 Chart generated (24h window): {filename}")
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
    """
    try:
        stock = yf.Ticker(ticker)
        info = stock.info
        
        # We only want the most important data
        financial_data = {
            "current_price": info.get("currentPrice"),
            "market_cap": info.get("marketCap"),
            "pe_ratio": info.get("trailingPE"),
            "target_mean_price": info.get("targetMeanPrice"),
            "recommendation": info.get("recommendationKey"), # e.g., 'buy', 'hold'
            "company_summary": info.get("longBusinessSummary")[:500] + "..." # First 500 chars
        }
        return financial_data
    except Exception as e:
        print(f"Error fetching data for {ticker}: {e}")
        return {}