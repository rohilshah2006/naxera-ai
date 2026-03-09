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
        
        # Get Standard Data & Chart
        data = get_financial_metrics(ticker)
        chart_file = generate_stock_chart(ticker)
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
            "price": price,
            "value": value,
            "pe_ratio": data.get("pe_ratio", "N/A"),
            "target_mean_price": data.get("target_mean_price", "N/A"),
            "quant": quant_data # Store our new math
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
    
    print("🧠 Synthesizing Deep-Dive Quant Reports...")

    cards_html = ""
    # Your Vercel link is safe right here!
    user_uuid = state["portfolio"][0].get("uuid", "")
    manage_url = f"https://naxera-ai-delta.vercel.app/manage?id={user_uuid}"
    
    for stock in portfolio_data:
        ticker = stock['ticker']
        quant = stock['quant']
        
        # NEW PROMPT: Force the AI to format JSON safely
        prompt = f"""
        You are a Senior Quantitative Investment Analyst at Goldman Sachs.
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

        # Build the HTML with the new Quant Section and Data Mini-Grid
        cards_html += f"""
        <div style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); margin-bottom: 20px;">
            <div style="padding: 15px 25px; border-bottom: 1px solid #e5e7eb; background-color: #f9fafb; display: flex; justify-content: space-between; align-items: center;">
                <h2 style="margin: 0; font-size: 20px; color: #111827; font-weight: bold;">{ticker} <span style="font-size: 14px; color: #6b7280; font-weight: normal; margin-left: 8px;">({stock['shares']} shares)</span></h2>
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
                        <td style="padding: 10px; border: 1px solid #e5e7eb; color: #111827;">${stock['target_mean_price']}</td>
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
                <a href="{manage_url}" style="color: #9ca3af; text-decoration: underline;">Manage Portfolio or Unsubscribe</a>
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