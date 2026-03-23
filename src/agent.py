import os
import json
import yfinance as yf
import pandas as pd
from typing import TypedDict, Literal
from dotenv import load_dotenv

from langgraph.graph import StateGraph, END
from langchain_groq import ChatGroq
from tavily import TavilyClient
from langchain_core.messages import HumanMessage
from src.state import AgentState
from src.tools import get_financial_metrics, send_email, generate_stock_chart 

load_dotenv()

# --- SETUP ---
tavily = TavilyClient(api_key=os.getenv("TAVILY_API_KEY"))
llm = ChatGroq(
    model="llama-3.3-70b-versatile",
    temperature=0,
    api_key=os.getenv("GROQ_API_KEY")
)

# --- NODE 1: RESEARCHER ---
def search_node(state: AgentState):
    print("📰 Fetching broad market news...")
    try:
        # For a portfolio, broad market news is better
        response = tavily.search(query="US stock market pre-market news today", topic="news", days=1)
        news_text = " ".join([res['title'] for res in response.get('results', [])[:4]])
    except Exception:
        news_text = "Standard market conditions."

    return {"news_results": [news_text]}

# --- NODE 2: DATA COLLECTOR ---
def data_collection_node(state: AgentState):
    portfolio = state["portfolio"]
    portfolio_data = []
    chart_paths = []
    total_value = 0.0

    print(f"📊 Fetching data, charts, and calculating Quant indicators for {len(portfolio)} assets...")
    
    for item in portfolio:
        ticker = item["ticker"]
        shares = item["shares"]
        
        # Get Standard Data & Chart — pass frequency so chart window matches
        data = get_financial_metrics(ticker)
        frequency = item.get("frequency", "daily")
        chart_file = generate_stock_chart(ticker, frequency)
        if chart_file:
            chart_paths.append(chart_file)
            
        # --- NEW: CALCULATE TECHNICAL INDICATORS ---
        try:
            stock = yf.Ticker(ticker)
            hist = stock.history(period="1y") # Need 1 year for the 200-day average
            
            if not hist.empty and len(hist) > 200:
                close_px = hist['Close']
                
                # Moving Averages
                sma_50 = close_px.rolling(window=50).mean().iloc[-1]
                sma_200 = close_px.rolling(window=200).mean().iloc[-1]
                
                # RSI (14-Day)
                delta = close_px.diff()
                gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
                loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
                rs = gain / loss
                rsi = 100 - (100 / (1 + rs))
                rsi_14 = float(rsi.iloc[-1])
                
                quant_data = {
                    "sma_50": f"${round(sma_50, 2)}",
                    "sma_200": f"${round(sma_200, 2)}",
                    "rsi": round(rsi_14, 2)
                }
            else:
                quant_data = {"sma_50": "N/A", "sma_200": "N/A", "rsi": "N/A"}
        except Exception as e:
            print(f"⚠️ Quant error for {ticker}: {e}")
            quant_data = {"sma_50": "N/A", "sma_200": "N/A", "rsi": "N/A"}
        # ---------------------------------------------
            
        # Calculate Value
        price = data.get("current_price") or 0
        value = price * shares
        total_value += value
        
        # Save EVERYTHING
        portfolio_data.append({
            "ticker": ticker,
            "shares": shares,
            "frequency": frequency,
            "price": price,
            "value": value,
            "pe_ratio": data.get("pe_ratio", "N/A"),
            "target_mean_price": data.get("target_mean_price", "N/A"),
            "quant": quant_data
        })
        
    return {
        "portfolio_data": portfolio_data, 
        "total_value": total_value, 
        "chart_paths": chart_paths
    }

# --- NODE 3: ANALYST ---
def analyze_node(state: AgentState):
    news_content = state.get("news_results", [""])[0]
    portfolio_data = state.get("portfolio_data", [])
    total_value = state.get("total_value", 0)
    language_level = state.get("language_level", "regular")
    
    # --- LANGUAGE STYLE INSTRUCTIONS ---
    LANGUAGE_STYLES = {
        "super-simple":  "Write in extremely plain, simple English. Use no financial jargon whatsoever. Explain every concept as if you're talking to someone who has never heard of the stock market. Use short sentences and simple analogies.",
        "easy":          "Write in simple, beginner-friendly language. Avoid jargon where possible. When you must use a financial term, briefly explain what it means in parentheses.",
        "regular":       "Write in a balanced, accessible professional tone. Use standard financial terminology without over-explaining.",
        "advanced":      "Write using professional financial and investment analysis language, assuming the reader is a knowledgeable investor.",
        "very-advanced": "Write using highly technical quantitative analysis language suited for professional traders and institutional investors. Use precise financial terminology, statistical references, and assume deep domain expertise.",
    }
    language_instruction = LANGUAGE_STYLES.get(language_level, LANGUAGE_STYLES["regular"])
    
    print("🧠 Synthesizing Deep-Dive Quant Reports...")

    cards_html = ""
    # Use environment variable for the frontend URL (defaults to production if not set)
    user_uuid = state["portfolio"][0].get("uuid", "")
    frontend_url = os.getenv("FRONTEND_URL", "https://naxera-ai-delta.vercel.app")
    manage_url = f"{frontend_url}/manage?id={user_uuid}"
    
    for stock in portfolio_data:
        ticker = stock['ticker']
        quant = stock['quant']
        frequency = stock.get('frequency', 'daily')
        freq_label = frequency.capitalize()  # e.g. "Daily", "Weekly"
        
        # NEW PROMPT: Force the AI to format JSON safely
        prompt = f"""
        You are a Senior Quantitative Investment Analyst at Goldman Sachs.
        
        LANGUAGE INSTRUCTION (follow this strictly):
        {language_instruction}
        
        Ticker: {ticker}
        Broad Market News: {news_content}
        Financials: Price ${stock['price']}, PE {stock['pe_ratio']}
        Technical Indicators: 50-Day SMA: {quant['sma_50']}, 200-Day SMA: {quant['sma_200']}, RSI (14-day): {quant['rsi']}.
        
        Output a valid JSON object with exactly 4 fields. 
        CRITICAL RULES FOR JSON: 
        - Use the literal characters \\n for paragraph breaks. Do NOT use actual line breaks inside the string values.
        - Do NOT use double quotes inside your text (use single quotes ' instead).
        
        1. "quant_analysis": A lengthy, in-depth 2-to-3 paragraph technical and quantitative analysis. Discuss the moving averages (trend), the RSI (momentum), and what this means for institutional buyers.
        2. "summary": A concise 3-sentence executive summary.
        3. "verdict": A single word: "Buy", "Sell", or "Hold".
        4. "rationale": A 1-sentence explanation of the verdict.
        
        Return ONLY the JSON string.
        """
        
        raw_response = llm.invoke([HumanMessage(content=prompt)]).content
        
        try:
            cleaned_response = raw_response.replace("```json", "").replace("```", "").strip()
            # NEW: strict=False tells Python to forgive accidental line breaks!
            analysis = json.loads(cleaned_response, strict=False)
        except Exception as e:
            print(f"⚠️ JSON Parse Error for {ticker}: {e}")
            analysis = {
                "quant_analysis": "Quantitative data currently processing.",
                "summary": "Analysis data temporarily unavailable.",
                "verdict": "Hold",
                "rationale": "Pending manual review."
            }

        verdict = analysis.get('verdict', 'Hold').upper()
        verdict_color = "#166534" if verdict == "BUY" else "#991b1b" if verdict == "SELL" else "#854d0e"

        # Asset type badge for email
        asset_type = stock.get('asset_type', 'Stock')
        ASSET_COLORS = {
            "Stock":       ("#e8f0fe", "#1a56db"),
            "ETF":         ("#e0f2fe", "#0369a1"),
            "Crypto":      ("#fef9c3", "#92400e"),
            "Mutual Fund": ("#f3e8ff", "#7e22ce"),
            "Index":       ("#f0fdf4", "#15803d"),
        }
        at_bg, at_fg = ASSET_COLORS.get(asset_type, ("#f3f4f6", "#374151"))

        # Build the HTML with the new Quant Section and Data Mini-Grid
        cards_html += f"""
        <div style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); margin-bottom: 20px;">
            <div style="padding: 15px 25px; border-bottom: 1px solid #e5e7eb; background-color: #f9fafb; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h2 style="margin: 0 0 6px 0; font-size: 20px; color: #111827; font-weight: bold;">{ticker} <span style="font-size: 14px; color: #6b7280; font-weight: normal; margin-left: 8px;">({stock['shares']} shares)</span></h2>
                    <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                        <span style="font-size: 11px; font-weight: 600; letter-spacing: 0.05em; background-color: #dcfce7; color: #166534; padding: 2px 8px; border-radius: 99px;">&#8635; {freq_label}</span>
                        <span style="font-size: 11px; font-weight: 600; letter-spacing: 0.05em; background-color: {at_bg}; color: {at_fg}; padding: 2px 8px; border-radius: 99px;">{asset_type}</span>
                    </div>
                </div>
                <h2 style="margin: 0; font-size: 20px; color: #111827;">${stock['value']:,.2f}</h2>
            </div>
            
            <div style="padding: 25px;">
                
                <h3 style="margin-top: 0; color: #374151; font-size: 16px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px;">Quantitative & Technical Analysis</h3>
                
                <div style="display: flex; gap: 10px; margin-bottom: 20px;">
                    <div style="flex: 1; background-color: #f3f4f6; padding: 12px; border-radius: 6px; text-align: center; border: 1px solid #e5e7eb;">
                        <span style="display: block; font-size: 11px; color: #6b7280; text-transform: uppercase; font-weight: bold; margin-bottom: 4px;">RSI (14-Day)</span>
                        <span style="font-size: 18px; font-weight: bold; color: #111827;">{quant['rsi']}</span>
                    </div>
                    <div style="flex: 1; background-color: #f3f4f6; padding: 12px; border-radius: 6px; text-align: center; border: 1px solid #e5e7eb;">
                        <span style="display: block; font-size: 11px; color: #6b7280; text-transform: uppercase; font-weight: bold; margin-bottom: 4px;">50-Day SMA</span>
                        <span style="font-size: 18px; font-weight: bold; color: #111827;">{quant['sma_50']}</span>
                    </div>
                    <div style="flex: 1; background-color: #f3f4f6; padding: 12px; border-radius: 6px; text-align: center; border: 1px solid #e5e7eb;">
                        <span style="display: block; font-size: 11px; color: #6b7280; text-transform: uppercase; font-weight: bold; margin-bottom: 4px;">200-Day SMA</span>
                        <span style="font-size: 18px; font-weight: bold; color: #111827;">{quant['sma_200']}</span>
                    </div>
                </div>

                <p style="color: #4b5563; line-height: 1.7; margin-bottom: 30px; font-size: 14px;">
                    {analysis.get('quant_analysis')}
                </p>

                <h3 style="margin-top: 0; color: #374151; font-size: 16px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px;">Executive Summary</h3>
                <p style="color: #4b5563; line-height: 1.6; margin-bottom: 25px; font-size: 14px;">
                    {analysis.get('summary')}
                </p>

                <h3 style="margin-top: 0; color: #374151; font-size: 16px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px;">Key Metrics</h3>
                <table style="width: 100%; margin-bottom: 25px; border-collapse: collapse; font-size: 14px;">
                    <tr>
                        <td style="padding: 10px; background-color: #f9fafb; border: 1px solid #e5e7eb; font-weight: bold; color: #374151; width: 30%;">Price</td>
                        <td style="padding: 10px; border: 1px solid #e5e7eb; color: #111827;">${stock['price']:,.2f}</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px; background-color: #f9fafb; border: 1px solid #e5e7eb; font-weight: bold; color: #374151;">Target</td>
                        <td style="padding: 10px; border: 1px solid #e5e7eb; color: #111827;">{f"${stock['target_mean_price']:,.2f}" if stock['target_mean_price'] else 'N/A'}</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px; background-color: #f9fafb; border: 1px solid #e5e7eb; font-weight: bold; color: #374151;">P/E Ratio</td>
                        <td style="padding: 10px; border: 1px solid #e5e7eb; color: #111827;">{stock['pe_ratio']}</td>
                    </tr>
                </table>

                <div style="background-color: {verdict_color}15; border-left: 4px solid {verdict_color}; padding: 15px;">
                    <strong style="color: {verdict_color}; font-size: 16px; display: block; margin-bottom: 5px;">VERDICT: {verdict}</strong>
                    <span style="color: #374151; font-size: 14px;">{analysis.get('rationale')}</span>
                </div>
            </div>
        </div>
        """

    # 3. Assemble the Final Email with the Navy Header
    html_template = f"""
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f3f4f6; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto;">
            
            <div style="background-color: #111827; color: #ffffff; padding: 25px; text-align: center; border-radius: 8px; margin-bottom: 25px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <h1 style="margin: 0; font-size: 26px; font-weight: bold;">Naxera AI</h1>
                <p style="margin: 5px 0 0 0; opacity: 0.8; font-size: 14px;">Daily Portfolio Wrap</p>
                
                <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #374151;">
                    <span style="font-size: 12px; font-weight: bold; letter-spacing: 1px; color: #9ca3af;">TOTAL VALUE</span><br/>
                    <span style="font-size: 40px; font-weight: bold; color: #4ade80;">${total_value:,.2f}</span>
                </div>
            </div>
            
            {cards_html}
            
            <div style="text-align: center; font-size: 12px; color: #6b7280; margin-top: 30px; padding: 20px; border-top: 1px solid #d1d5db;">
                Generated by Naxera AI • Goldman Sachs Analysis Logic
                <br><br>
                <a href="https://naxera.space" style="color: #9ca3af; text-decoration: underline;">Manage Portfolio or Unsubscribe</a>
            </div>
        </div>
    </div>
    """
    
    return {"final_report": html_template}

# --- NODE 4: PUBLISHER ---
def publisher_node(state: AgentState):
    report = state["final_report"]
    recipient = state["user_email"]
    charts = state.get("chart_paths", [])
    total_val = state.get("total_value", 0)
    
    print(f"📧 Sending Portfolio Wrap to {recipient} with {len(charts)} charts...")
    
    send_email(
        to=recipient, 
        subject=f"Market Wrap: Your ${total_val:,.2f} Portfolio", 
        body=report,
        attachments=charts 
    )
    
    # Cleanup all charts
    for chart in charts:
        if isinstance(chart, str) and os.path.exists(chart):
            os.remove(chart)
            
    return {"final_report": report}

# --- LOGIC & GRAPH ---
def build_graph():
    workflow = StateGraph(AgentState)
    workflow.add_node("researcher", search_node)
    workflow.add_node("data_collector", data_collection_node)
    workflow.add_node("analyst", analyze_node)
    workflow.add_node("publisher", publisher_node)

    workflow.set_entry_point("researcher")
    workflow.add_edge("researcher", "data_collector")
    workflow.add_edge("data_collector", "analyst")
    workflow.add_edge("analyst", "publisher")
    workflow.add_edge("publisher", END)

    return workflow.compile()

def run_agent(inputs: dict):
    app = build_graph()
    result = app.invoke(inputs)
    return result["final_report"]


def run_digest_agent(inputs: dict):
    """
    Pro-only: Sends a lightweight weekly portfolio digest email.
    Instead of deep per-stock AI analysis, this is a quick snapshot table
    covering all holdings with current price, 1-week change, RSI signal, and verdict.
    """
    from datetime import date
    portfolio = inputs.get("portfolio", [])
    email = inputs.get("user_email", "")
    language_level = inputs.get("language_level", "regular")

    LANGUAGE_STYLES = {
        "super-simple":  "Write in extremely plain, simple English. No jargon.",
        "easy":          "Write in simple, beginner-friendly language.",
        "regular":       "Write in a balanced professional tone.",
        "advanced":      "Write using professional financial language.",
        "very-advanced": "Write using highly technical quantitative language for professional traders.",
    }
    lang_note = LANGUAGE_STYLES.get(language_level, LANGUAGE_STYLES["regular"])

    rows_html = ""
    total_value = 0.0
    summaries = []

    for item in portfolio:
        ticker = item["ticker"]
        shares = item["shares"]
        try:
            metrics = get_financial_metrics(ticker)
            price = metrics.get("current_price", 0) or 0
            value = price * shares
            total_value += value

            # Quick 1-week price change
            stock_yf = yf.Ticker(ticker)
            hist = stock_yf.history(period="5d")
            if len(hist) >= 2:
                week_change = ((hist['Close'].iloc[-1] - hist['Close'].iloc[0]) / hist['Close'].iloc[0]) * 100
                change_str = f"+{week_change:.1f}%" if week_change >= 0 else f"{week_change:.1f}%"
                change_color = "#166534" if week_change >= 0 else "#991b1b"
            else:
                change_str = "N/A"
                change_color = "#6b7280"

            # Simple RSI signal
            hist_long = stock_yf.history(period="1mo")
            if len(hist_long) >= 15:
                delta = hist_long['Close'].diff()
                gain = delta.clip(lower=0).rolling(14).mean()
                loss = (-delta.clip(upper=0)).rolling(14).mean()
                rs = gain / loss.replace(0, 1e-9)
                rsi = float((100 - (100 / (1 + rs))).iloc[-1])
                signal = "Oversold" if rsi < 30 else "Overbought" if rsi > 70 else "Neutral"
                signal_color = "#166534" if rsi < 30 else "#991b1b" if rsi > 70 else "#374151"
                rsi_str = f"{rsi:.0f}"
            else:
                signal = "N/A"
                signal_color = "#6b7280"
                rsi_str = "N/A"

            summaries.append(f"{ticker} at ${price:,.2f} ({change_str} this week, RSI {rsi_str})")

            rows_html += f"""
            <tr>
              <td style="padding:10px 12px;font-weight:bold;color:#111827">{ticker}</td>
              <td style="padding:10px 12px;color:#374151">{shares}</td>
              <td style="padding:10px 12px;color:#111827">${price:,.2f}</td>
              <td style="padding:10px 12px;font-weight:bold;color:{change_color}">{change_str}</td>
              <td style="padding:10px 12px;color:{signal_color}">{signal} ({rsi_str})</td>
              <td style="padding:10px 12px;font-weight:bold;color:#111827">${value:,.2f}</td>
            </tr>"""
        except Exception as exc:
            print(f"  ⚠️  Digest: could not fetch {ticker}: {exc}")

    # Ask the LLM for a short portfolio summary paragraph
    try:
        summary_prompt = f"""
        {lang_note}
        
        You are reviewing a portfolio's weekly performance. Here is the data:
        {'; '.join(summaries) if summaries else 'No data available.'}
        
        Write a concise 2-3 sentence overview of how this portfolio performed this week.
        Highlight any standout moves, the overall trend, and one actionable observation.
        Keep it under 80 words. Return only the plain text paragraph, no JSON.
        """
        summary_para = llm.invoke([HumanMessage(content=summary_prompt)]).content.strip()
    except Exception:
        summary_para = "Weekly portfolio data has been compiled. Review the table above for key metrics."

    frontend_url = os.getenv("FRONTEND_URL", "https://naxera-ai-delta.vercel.app")

    html = f"""
    <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background-color:#f3f4f6;padding:20px;">
      <div style="max-width:620px;margin:0 auto;">
        <div style="background-color:#111827;color:#fff;padding:25px;text-align:center;border-radius:8px;margin-bottom:20px;">
          <h1 style="margin:0;font-size:24px;font-weight:bold;">Naxera AI</h1>
          <p style="margin:4px 0 0;opacity:0.7;font-size:13px;">Weekly Portfolio Digest · Pro Member</p>
          <div style="margin-top:16px;padding-top:16px;border-top:1px solid #374151;">
            <span style="font-size:11px;color:#9ca3af;letter-spacing:1px;">TOTAL VALUE</span><br>
            <span style="font-size:36px;font-weight:bold;color:#4ade80;">${total_value:,.2f}</span>
          </div>
        </div>

        <div style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,0.07);margin-bottom:20px;">
          <div style="padding:16px 20px;border-bottom:1px solid #e5e7eb;">
            <h2 style="margin:0;font-size:16px;color:#111827;">This Week's Snapshot</h2>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="background:#f9fafb;border-bottom:1px solid #e5e7eb;">
                <th style="padding:9px 12px;text-align:left;color:#6b7280;font-weight:600;">Ticker</th>
                <th style="padding:9px 12px;text-align:left;color:#6b7280;font-weight:600;">Shares</th>
                <th style="padding:9px 12px;text-align:left;color:#6b7280;font-weight:600;">Price</th>
                <th style="padding:9px 12px;text-align:left;color:#6b7280;font-weight:600;">7-Day</th>
                <th style="padding:9px 12px;text-align:left;color:#6b7280;font-weight:600;">RSI Signal</th>
                <th style="padding:9px 12px;text-align:left;color:#6b7280;font-weight:600;">Value</th>
              </tr>
            </thead>
            <tbody>{rows_html}</tbody>
          </table>
        </div>

        <div style="background:#fff;border-radius:8px;padding:20px;box-shadow:0 2px 6px rgba(0,0,0,0.07);margin-bottom:20px;">
          <h2 style="margin:0 0 10px;font-size:16px;color:#111827;">AI Portfolio Summary</h2>
          <p style="color:#4b5563;line-height:1.7;font-size:14px;margin:0">{summary_para}</p>
        </div>

        <div style="text-align:center;font-size:12px;color:#6b7280;padding:16px;border-top:1px solid #d1d5db;">
          Generated by Naxera AI · Pro Weekly Digest<br><br>
          <a href="{frontend_url}/manage" style="color:#9ca3af;text-decoration:underline;">Manage Portfolio</a>
        </div>
      </div>
    </div>
    """

    today_str = date.today().strftime("%B %d, %Y")
    send_email(
        to=email,
        subject=f"📋 Weekly Digest: ${total_value:,.2f} Portfolio · {today_str}",
        body=html,
    )