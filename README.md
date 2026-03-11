# 📈 Naxera AI

**An autonomous, institutional-grade quantitative analysis engine and portfolio tracker.**

Naxera AI transforms standard stock tracking into a fully automated financial briefing system. Powered by a multi-agent AI pipeline, custom quantitative math engines, and Next.js, it delivers Goldman Sachs-level market insights straight to your inbox every morning at 6:00 AM.

🌐 **Live Application:** [www.naxera.space](https://www.naxera.space)

---

## ✨ Key Features

### 1. Multi-Agent AI Pipeline 🧠

At the core of Naxera AI is a state-machine orchestrated by LangGraph, routing data between specialized AI nodes:
* **The Researcher:** Autonomously fetches broad, real-time pre-market news using the Tavily API.
* **The Data Collector:** Pulls live financial metrics, target prices, and P/E ratios.
* **The Analyst:** A rigorously prompted Llama-3.3-70b model that synthesizes raw data into institutional-grade JSON reports.
* **The Publisher:** Compiles the data into a responsive HTML email and dispatches it with customized stock charts.

### 2. The "Quant" Upgrade 📊
We don't just rely on LLM hallucinations. Naxera AI mathematically calculates real Technical Indicators before analysis.
* **Trend Analysis:** Calculates 50-day and 200-day Simple Moving Averages (SMA) using a full year of historical market data.
* **Momentum Tracking:** Computes the 14-day Relative Strength Index (RSI) to determine if an asset is overbought or oversold.
* **Data-Driven Verdicts:** The AI Analyst is strictly forced to base its Buy/Sell/Hold verdicts on these hard quantitative outputs.

### 3. Bank-Grade Security & Identity 🔒
* **Passwordless Auth:** Frictionless onboarding using Supabase Magic Links.
* **Multi-Tenant Isolation:** Locked down via strict PostgreSQL Row-Level Security (RLS) policies. Users can only query, insert, or mutate assets tied to their cryptographically secure `auth.uid()`.

### 4. Autonomous Cloud Scheduling ⏰
* **Zero-Touch Execution:** A serverless GitHub Actions CRON job wakes the Python backend up every weekday.
* **Queue Optimization:** Scheduled at exactly 5:43 AM PST to bypass global server rush-hour, ensuring the final report lands in the user's inbox perfectly at 6:00 AM.

---

## 🛠️ Under the Hood

### Tech Stack

<div align="left">
  <img src="https://img.shields.io/badge/Next-black?style=for-the-badge&logo=next.js&logoColor=white" alt="Next JS" />
  <img src="https://img.shields.io/badge/react-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB" alt="React" />
  <img src="https://img.shields.io/badge/tailwindcss-%2338B2AC.svg?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="Tailwind CSS" />
  <br>
  <img src="https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase" />
  <img src="https://img.shields.io/badge/postgres-%23316192.svg?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <br>
  <img src="https://img.shields.io/badge/python-3670A0?style=for-the-badge&logo=python&logoColor=ffdd54" alt="Python" />
  <img src="https://img.shields.io/badge/pandas-%23150458.svg?style=for-the-badge&logo=pandas&logoColor=white" alt="Pandas" />
  <br>
  <img src="https://img.shields.io/badge/vercel-%23000000.svg?style=for-the-badge&logo=vercel&logoColor=white" alt="Vercel" />
  <img src="https://img.shields.io/badge/github%20actions-%232671E5.svg?style=for-the-badge&logo=githubactions&logoColor=white" alt="GitHub Actions" />
</div>

<br>

This project bridges a modern React frontend with a heavy-duty Python AI backend.

* **Frontend:** Next.js 14, React, Tailwind CSS, Lucide Icons
* **Backend & Auth:** Supabase (PostgreSQL + RLS)
* **AI & Orchestration:** LangGraph, Llama-3 (via Groq API), Tavily API
* **Quantitative Engine:** Python, `yfinance`, `pandas`, `matplotlib`
* **Infrastructure:** Vercel (Edge network), GitHub Actions (Serverless CRON)

### The "Quant" Bit
The technical indicators aren't pulled from a basic API; they are calculated manually from raw historical close prices using `pandas` rolling windows to ensure maximum accuracy:
```python
# RSI (14-Day) Calculation Engine
delta = close_px.diff()
gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
rs = gain / loss
rsi = 100 - (100 / (1 + rs))
```

## 🚀 Live Application

Naxera AI is now available exclusively as a managed professional service. 

Experience the autonomous institutional-grade quantitative analysis engine and get your daily financial briefings at:
**[naxera.space](https://naxera.space)**

---

## 👤 Author

**Rohil Shah**
* *Full-Stack Architecture, AI Orchestration, and Quantitative Design*

---

*Built with Next.js, Supabase, and LangGraph.*