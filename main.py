import os
from datetime import date
from dotenv import load_dotenv
from supabase import create_client, Client
from src.agent import run_agent, run_digest_agent
from src.tools import get_financial_metrics, send_email

load_dotenv()

# Setup Supabase Connection
url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_KEY")
supabase: Client = create_client(url, key)

# --- PLAN LIMITS (mirrors frontend) ---
PLAN_LIMITS = {
    'free': 3,
    'core': 10,
    'pro': float('inf'),
}


def is_due_today(frequency: str) -> bool:
    """
    Returns True if a stock with this frequency should be emailed on today's date.
      daily     → always (every weekday)
      weekly    → Mondays only (weekday() == 0)
      monthly   → 1st of the month
      quarterly → 1st of Jan, Apr, Jul, Oct
      yearly    → 1st of January
    """
    today = date.today()
    if frequency == 'daily':
        return True
    elif frequency == 'weekly':
        return today.weekday() == 0  # Monday
    elif frequency == 'monthly':
        return today.day == 1
    elif frequency == 'quarterly':
        return today.day == 1 and today.month in (1, 4, 7, 10)
    elif frequency == 'yearly':
        return today.day == 1 and today.month == 1
    return True


def check_price_alerts(email: str, portfolio: list, user_id: str):
    """
    Checks each active price alert for the user.
    Fires a lightweight alert email if current_price crosses the threshold.
    """
    try:
        alerts = supabase.table("price_alerts") \
            .select("*") \
            .eq("user_id", user_id) \
            .eq("active", True) \
            .execute().data

        if not alerts:
            return

        triggered = []
        for alert in alerts:
            ticker = alert['ticker']
            threshold = float(alert['threshold_price'])
            direction = alert['direction']  # 'below' or 'above'

            metrics = get_financial_metrics(ticker)
            current_price = metrics.get('current_price', 0)
            if not current_price:
                continue

            hit = (direction == 'below' and current_price <= threshold) or \
                  (direction == 'above' and current_price >= threshold)

            if hit:
                triggered.append({
                    "ticker": ticker,
                    "current_price": current_price,
                    "threshold": threshold,
                    "direction": direction,
                })
                # Deactivate the alert so it doesn't spam
                supabase.table("price_alerts") \
                    .update({"active": False}) \
                    .eq("id", alert['id']) \
                    .execute()

        if triggered:
            alert_lines = "".join([
                f"<tr><td style='padding:8px;font-weight:bold'>{a['ticker']}</td>"
                f"<td style='padding:8px'>${a['current_price']:,.2f}</td>"
                f"<td style='padding:8px;color:#166534'>{a['direction'].upper()} ${a['threshold']:,.2f}</td></tr>"
                for a in triggered
            ])
            html = f"""
            <div style="font-family:Arial,sans-serif;background:#f3f4f6;padding:20px;">
              <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
                <div style="background:#111827;color:#fff;padding:24px;text-align:center;">
                  <img src="https://naxera.space/logo.png" alt="Naxera AI" style="width: 50px; height: 50px; border-radius: 50%; margin-bottom: 12px; border: 2px solid rgba(255,255,255,0.1);" />
                  <h1 style="margin:0;font-size:22px;">⚡ Price Alert Triggered</h1>
                  <p style="margin:6px 0 0;opacity:0.7;font-size:13px;">Naxera AI — Pro Alert</p>
                </div>
                <div style="padding:24px;">
                  <p style="color:#374151;font-size:14px;">One or more of your price alerts have been triggered:</p>
                  <table style="width:100%;border-collapse:collapse;font-size:14px;">
                    <thead>
                      <tr style="background:#f9fafb;">
                        <th style="padding:8px;text-align:left;border-bottom:1px solid #e5e7eb;">Ticker</th>
                        <th style="padding:8px;text-align:left;border-bottom:1px solid #e5e7eb;">Current Price</th>
                        <th style="padding:8px;text-align:left;border-bottom:1px solid #e5e7eb;">Alert</th>
                      </tr>
                    </thead>
                    <tbody>{alert_lines}</tbody>
                  </table>
                </div>
                <div style="text-align:center;font-size:12px;color:#6b7280;padding:16px;border-top:1px solid #e5e7eb;">
                  Naxera AI • Price Alerts
                </div>
              </div>
            </div>
            """
            send_email(
                to=email,
                subject=f"⚡ Price Alert: {', '.join(a['ticker'] for a in triggered)} triggered",
                body=html,
            )
            print(f"  🔔 Sent {len(triggered)} price alert(s) to {email}")

    except Exception as e:
        print(f"  ⚠️  Price alert check failed for {email}: {e}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Naxera AI")
    parser.add_argument("--manual", action="store_true", help="Run manually for a single user")
    parser.add_argument("--user_id", type=str, help="Supabase User ID")
    parser.add_argument("--email", type=str, help="User Email")
    parser.add_argument("--timescale", type=str, default="all", help="Timescale to run manually (e.g. daily, weekly, all)")
    args = parser.parse_args()

    print("--- Starting Naxera AI (Portfolio Mode) ---")
    today = date.today()
    print(f"📅 Today: {today.strftime('%A, %B %d %Y')}")
    is_monday = today.weekday() == 0

    # 1. Fetch all ACTIVE subscriptions
    print("📡 Fetching active subscriptions from Supabase...")
    if args.manual and args.user_id:
        response = supabase.table("subscriptions").select("*").eq("active", True).eq("user_id", args.user_id).execute()
    else:
        response = supabase.table("subscriptions").select("*").eq("active", True).execute()
        
    subscriptions = response.data

    if not subscriptions:
        print("⚠️ No active subscriptions found in database.")
        exit(0)
    else:
        print(f"✅ Found {len(subscriptions)} total active tickers.")

    # 2. Fetch profiles (plan + language_level) for all users
    user_ids = list({sub.get('user_id') for sub in subscriptions if sub.get('user_id')})
    profiles_response = supabase.table("profiles").select("id, plan, language_level").in_("id", user_ids).execute()
    profile_map = {
        p['id']: {
            'plan': p.get('plan', 'free'),
            'language_level': p.get('language_level', 'regular'),
        }
        for p in (profiles_response.data or [])
    }

    # 3. GROUP BY USER
    user_portfolios: dict = {}
    for sub in subscriptions:
        email = sub['email']
        if email not in user_portfolios:
            user_portfolios[email] = []
        user_portfolios[email].append({
            "ticker": sub['ticker'],
            "shares": float(sub['shares']),
            "uuid": sub.get('uuid'),
            "frequency": sub.get('frequency', 'daily'),
            "asset_type": sub.get('asset_type', 'stock'),
            "user_id": sub.get('user_id'),
        })

    print(f"📊 Processing portfolios for {len(user_portfolios)} unique users...\n")

    # 4. Loop through each USER
    for email, portfolio in user_portfolios.items():
        try:
            user_id = portfolio[0].get('user_id', '')
            profile = profile_map.get(user_id, {'plan': 'free', 'language_level': 'regular'})
            plan = profile['plan']
            language_level = profile['language_level']

            # --- BACKEND PLAN ENFORCEMENT ---
            limit = PLAN_LIMITS.get(plan, 3)
            if len(portfolio) > limit:
                print(f"  ⚠️  {email} ({plan}) has {len(portfolio)} stocks, plan allows {int(limit)}. Capping.")
                portfolio = portfolio[:int(limit)]

            # --- PRICE ALERTS (Pro only) ---
            if plan == 'pro':
                check_price_alerts(email, portfolio, user_id)

            # --- WEEKLY DIGEST (Pro only, Mondays) ---
            if plan == 'pro' and is_monday:
                print(f"  📋 Sending weekly digest to {email}...")
                try:
                    run_digest_agent({
                        "user_email": email,
                        "portfolio": portfolio,
                        "language_level": language_level,
                        "retry_count": 0,
                    })
                    print(f"  ✅ Weekly digest sent to {email}")
                except Exception as e:
                    print(f"  ⚠️  Weekly digest failed for {email}: {e}")

            # --- REGULAR PER-STOCK REPORTS ---
            if args.manual:
                if args.timescale and args.timescale != "all":
                    due_today = [item for item in portfolio if item['frequency'] == args.timescale]
                else:
                    due_today = portfolio
            else:
                due_today = [item for item in portfolio if is_due_today(item['frequency'])]

            # On Mondays, Pro users already get the digest. Skip their weekly stocks
            # to avoid duplication — but still process daily, monthly, etc.
            if plan == 'pro' and is_monday and not args.manual:
                due_today = [item for item in due_today if item['frequency'] != 'weekly']

            if not due_today:
                skipped = [f"{item['ticker']}({item['frequency']})" for item in portfolio]
                print(f"⏭️  Skipping {email} — no stocks due today. ({', '.join(skipped)})")
                continue

            skipped_stocks = [item for item in portfolio if not is_due_today(item['frequency'])]
            if skipped_stocks and not args.manual:
                labels = [f"{s['ticker']}({s['frequency']})" for s in skipped_stocks]
                print(f"  ⏭️  Skipping {len(skipped_stocks)} stock(s) not due today: {', '.join(labels)}")

            print(f"--- 🤖 Processing Portfolio for {email} ({len(due_today)} stock(s) due today) ---")

            inputs = {
                "user_email": email,
                "portfolio": due_today,
                "retry_count": 0,
                "language_level": language_level,
            }
            run_agent(inputs)
            print(f"✅ Finished sending to {email}")

        except Exception as e:
            print(f"❌ Failed to process {email}: {e}")

    print("\n--- Batch Job Complete ---")