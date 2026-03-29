"""
Data ingestion layer: pulls historical financials from yfinance.
Idempotent - same ticker always returns same structured output for same date.

Special ticker DEMO returns hardcoded Apple data instantly for demo stability.
"""

import threading
import yfinance as yf
import pandas as pd
from models.schemas import YearProjection
import logging

logger = logging.getLogger(__name__)

# ─── Demo God Mode ────────────────────────────────────────────────────────────
_HARDCODED_DATA: dict[str, tuple[str, list[YearProjection]]] = {
    "RYA.IR": (
        "Ryanair Holdings plc",
        [
            YearProjection(year=2021, revenue_bn=1.63, operating_margin_pct=-54.2, net_income_bn=-1.01),
            YearProjection(year=2022, revenue_bn=4.80, operating_margin_pct=0.87, net_income_bn=-0.35),
            YearProjection(year=2023, revenue_bn=10.78, operating_margin_pct=13.25, net_income_bn=1.31),
        ],
    ),
    "KSP.IR": (
        "Kingspan Group plc",
        [
            YearProjection(year=2021, revenue_bn=4.58, operating_margin_pct=10.45, net_income_bn=0.38),
            YearProjection(year=2022, revenue_bn=8.34, operating_margin_pct=9.98, net_income_bn=0.61),
            YearProjection(year=2023, revenue_bn=8.09, operating_margin_pct=10.85, net_income_bn=0.65),
        ],
    ),
    "KRZ.IR": (
        "Kerry Group plc",
        [
            YearProjection(year=2021, revenue_bn=7.35, operating_margin_pct=9.54, net_income_bn=0.76),
            YearProjection(year=2022, revenue_bn=8.77, operating_margin_pct=8.82, net_income_bn=0.60),
            YearProjection(year=2023, revenue_bn=8.02, operating_margin_pct=10.23, net_income_bn=0.72),
        ],
    ),
    "AAPL": (
        "Apple Inc.",
        [
            YearProjection(year=2021, revenue_bn=365.817, operating_margin_pct=29.78, net_income_bn=94.680),
            YearProjection(year=2022, revenue_bn=394.328, operating_margin_pct=30.29, net_income_bn=99.803),
            YearProjection(year=2023, revenue_bn=383.285, operating_margin_pct=29.82, net_income_bn=96.995),
        ],
    ),
    "MSFT": (
        "Microsoft Corporation",
        [
            YearProjection(year=2021, revenue_bn=168.08, operating_margin_pct=41.59, net_income_bn=61.27),
            YearProjection(year=2022, revenue_bn=198.27, operating_margin_pct=42.05, net_income_bn=72.73),
            YearProjection(year=2023, revenue_bn=211.91, operating_margin_pct=41.77, net_income_bn=72.36),
        ],
    ),
    "NVDA": (
        "NVIDIA Corporation",
        [
            YearProjection(year=2021, revenue_bn=16.67, operating_margin_pct=27.18, net_income_bn=4.33),
            YearProjection(year=2022, revenue_bn=26.91, operating_margin_pct=37.30, net_income_bn=9.75),
            YearProjection(year=2023, revenue_bn=26.97, operating_margin_pct=33.35, net_income_bn=4.36),
        ],
    ),
}
_HARDCODED_DATA["DEMO"] = _HARDCODED_DATA["RYA.IR"]


def fetch_historical_financials(ticker: str) -> tuple[str, list[YearProjection]]:
    ticker_upper = ticker.upper()
    if ticker_upper in _HARDCODED_DATA:
        logger.info(f"[DataIngestion] Using hardcoded data for {ticker_upper}")
        return _HARDCODED_DATA[ticker_upper]

    try:
        stock = yf.Ticker(ticker)

        info: dict = {}
        info_errors: list = []

        def _fetch_info():
            try:
                info.update(stock.info)
            except Exception as e:
                info_errors.append(e)

        t = threading.Thread(target=_fetch_info, daemon=True)
        t.start()
        t.join(timeout=5)

        if info_errors:
            raise ValueError(f"yfinance info error for {ticker}: {info_errors[0]}")
        if not info:
            logger.warning(f"stock.info timed out for {ticker} — proceeding without company name")

        company_name = info.get("longName") or info.get("shortName") or ticker

        financials = stock.financials
        if financials is None or financials.empty:
            raise ValueError(f"No financial data found for {ticker}")

        financials = financials.T.sort_index()

        projections = []
        for date, row in financials.tail(3).iterrows():
            year = date.year
            revenue = _safe_get(row, ["Total Revenue", "Revenue"])
            operating_income = _safe_get(row, ["Operating Income", "EBIT"])
            net_income = _safe_get(row, ["Net Income", "Net Income Common Stockholders"])

            if revenue is None or revenue == 0:
                logger.warning(f"Skipping year {year} — no revenue data")
                continue

            op_margin = (operating_income / revenue * 100) if operating_income else 0.0
            net_income_bn = (net_income / 1e9) if net_income else 0.0

            projections.append(YearProjection(
                year=year,
                revenue_bn=round(revenue / 1e9, 3),
                operating_margin_pct=round(op_margin, 2),
                net_income_bn=round(net_income_bn, 3),
            ))

        if len(projections) < 2:
            raise ValueError(f"Insufficient historical data for {ticker} — need at least 2 years")

        logger.info(f"Fetched {len(projections)} years for {company_name} ({ticker})")
        return company_name, projections

    except Exception as e:
        if "No data found" in str(e) or "404" in str(e):
            raise ValueError(f"Ticker '{ticker}' not found. Try AAPL, MSFT, NVDA, RYA.IR or DEMO.")
        raise


def compute_cagr(projections: list[YearProjection]) -> float:
    if len(projections) < 2:
        return 0.05
    start = projections[0].revenue_bn
    end = projections[-1].revenue_bn
    years = projections[-1].year - projections[0].year
    if years == 0 or start <= 0:
        return 0.05
    return (end / start) ** (1 / years) - 1


def compute_avg_margin(projections: list[YearProjection]) -> float:
    if not projections:
        return 15.0
    return sum(p.operating_margin_pct for p in projections) / len(projections)


def _safe_get(row: pd.Series, keys: list[str]) -> float | None:
    for key in keys:
        if key in row.index and pd.notna(row[key]):
            return float(row[key])
    return None
