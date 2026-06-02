# -*- coding: utf-8 -*-
"""
GitHub Actions 가 매일 실행하는 데이터 수집 스크립트.

- 코스피/코스닥 × 1일/5일/20일 × 4명 투자자(기관/연기금/외국인/사모)
  × 3종 정렬(순매수/매수/매도) 상위 20개를 모두 수집
- 등장하는 모든 종목의 펀더멘털(PER/PBR/배당/시총)도 수집
- 버핏식 간이 점수 계산
- site/data/*.json 으로 저장

KRX 가 회원제로 전환된 이후, 환경변수 KRX_ID / KRX_PW 가 필요하다.
GitHub Actions 에서는 Repository Secrets 로 주입한다.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
import time
from pathlib import Path
from typing import Callable, TypeVar

import pandas as pd
from pykrx import stock

from buffett_score import calc_score

# ---------------------------------------------------------------------------
# 설정
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "site" / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)

MARKETS = ["KOSPI", "KOSDAQ"]
PERIODS = [1, 5, 20]
INVESTORS = ["기관합계", "연기금", "외국인", "사모"]

INVESTOR_LABEL = {
    "기관합계": "기관 (전체)",
    "연기금": "연기금",
    "외국인": "외국인",
    "사모": "사모펀드",
}

TOP_N = 20

T = TypeVar("T")


# ---------------------------------------------------------------------------
# KRX 호출 유틸 — 재시도 + 영업일 캘린더
# ---------------------------------------------------------------------------
def _ymd(d: dt.date) -> str:
    return d.strftime("%Y%m%d")


def _retry(fn: Callable[[], T], retries: int = 4, delay: float = 1.0) -> T:
    last = None
    for i in range(retries):
        try:
            return fn()
        except Exception as e:
            last = e
            if i < retries - 1:
                time.sleep(delay * (i + 1))
    raise last  # type: ignore


_BDAY_CACHE: list[dt.date] = []


def _refresh_bdays(ref: dt.date) -> list[dt.date]:
    global _BDAY_CACHE
    if _BDAY_CACHE:
        return _BDAY_CACHE
    start = ref - dt.timedelta(days=120)
    try:
        df = _retry(lambda: stock.get_market_ohlcv(_ymd(start), _ymd(ref), "005930"))
        if df is not None and not df.empty:
            _BDAY_CACHE = [d.date() for d in df.index]
            return _BDAY_CACHE
    except Exception:
        pass
    # 폴백
    cal, d = [], start
    while d <= ref:
        if d.weekday() < 5:
            cal.append(d)
        d += dt.timedelta(days=1)
    _BDAY_CACHE = cal
    return _BDAY_CACHE


def get_latest_bday(ref: dt.date) -> dt.date:
    cal = _refresh_bdays(ref)
    cand = [d for d in cal if d <= ref]
    return cand[-1] if cand else (cal[-1] if cal else ref)


def get_prev_bday(from_d: dt.date, n: int) -> dt.date:
    cal = _refresh_bdays(from_d)
    cand = [d for d in cal if d <= from_d]
    if not cand:
        return from_d - dt.timedelta(days=n)
    idx = cand.index(from_d) if from_d in cand else len(cand) - 1
    return cand[max(idx - n, 0)]


# ---------------------------------------------------------------------------
# 데이터 변환
# ---------------------------------------------------------------------------
def _df_to_rankings(df: pd.DataFrame, sort_by: str, ascending: bool) -> list[dict]:
    """
    pykrx DataFrame 을 정렬 후 상위 N개 dict 리스트로 변환.
    각 행: {rank, ticker, name, buy_value_eok, sell_value_eok, net_value_eok}
    """
    if df is None or df.empty:
        return []
    work = df.reset_index().copy()
    # 컬럼 이름 통일
    if "티커" not in work.columns:
        work = work.rename(columns={work.columns[0]: "티커"})
    if sort_by not in work.columns:
        return []
    work = work.sort_values(sort_by, ascending=ascending).head(TOP_N).reset_index(drop=True)

    rows = []
    for i, r in work.iterrows():
        rows.append({
            "rank": i + 1,
            "ticker": str(r.get("티커", "")).zfill(6),
            "name": str(r.get("종목명", "")),
            "buy_value_eok":  round(float(r.get("매수거래대금", 0)) / 1e8, 1),
            "sell_value_eok": round(float(r.get("매도거래대금", 0)) / 1e8, 1),
            "net_value_eok":  round(float(r.get("순매수거래대금", 0)) / 1e8, 1),
        })
    return rows


def fetch_flow(market: str, period: int, end_bday: dt.date) -> tuple[dict, set[str]]:
    """
    한 (market, period) 조합에 대해 4명 투자자 × 3종 정렬을 모두 수집.
    반환: (flow_data_dict, 등장한 ticker 집합)
    """
    start_bday = end_bday if period <= 1 else get_prev_bday(end_bday, period - 1)
    flow = {
        "market": market,
        "period_days": period,
        "base_date": end_bday.isoformat(),
        "start_date": start_bday.isoformat(),
        "investors": {},
    }
    seen_tickers: set[str] = set()

    for inv in INVESTORS:
        try:
            df = _retry(lambda i=inv: stock.get_market_net_purchases_of_equities(
                _ymd(start_bday), _ymd(end_bday), market, i
            ))
        except Exception as e:
            print(f"  ⚠️ {inv} 조회 실패: {e}", file=sys.stderr)
            df = pd.DataFrame()

        if df is None or df.empty:
            print(f"  ⚠️ {market}/{period}d/{inv} 데이터 없음")
            flow["investors"][inv] = {
                "label": INVESTOR_LABEL[inv],
                "rankings": {"net_buy": [], "buy": [], "sell": []},
            }
            continue

        net_top  = _df_to_rankings(df, "순매수거래대금", ascending=False)
        buy_top  = _df_to_rankings(df, "매수거래대금",   ascending=False)
        sell_top = _df_to_rankings(df, "매도거래대금",   ascending=False)

        for rows in (net_top, buy_top, sell_top):
            for r in rows:
                if r["ticker"]:
                    seen_tickers.add(r["ticker"])

        flow["investors"][inv] = {
            "label": INVESTOR_LABEL[inv],
            "rankings": {"net_buy": net_top, "buy": buy_top, "sell": sell_top},
        }
        print(f"  ✓ {market}/{period}d/{inv}: net={len(net_top)} buy={len(buy_top)} sell={len(sell_top)}")
        time.sleep(0.3)  # KRX 부하 완화

    return flow, seen_tickers


def _load_sector_map() -> dict:
    """
    FinanceDataReader 로 종목별 섹터 정보를 받아온다.
    KRX 회원 인증과 무관한 외부 소스라 별도 자격증명이 필요 없다.
    실패하면 빈 dict 반환 (앱은 섹터 없이 정상 동작).
    """
    try:
        import FinanceDataReader as fdr
    except Exception as e:
        print(f"  ⚠️ FinanceDataReader import 실패: {e}", file=sys.stderr)
        return {}

    try:
        df = fdr.StockListing('KRX')
    except Exception as e:
        print(f"  ⚠️ FinanceDataReader StockListing 실패: {e}", file=sys.stderr)
        return {}

    if df is None or df.empty:
        return {}

    # 컬럼 이름은 버전마다 다를 수 있으므로 가장 일반적인 후보를 시도
    code_col = next((c for c in ['Code', 'Symbol', 'code', '종목코드'] if c in df.columns), None)
    sector_col = next((c for c in ['Sector', 'sector', '섹터', '업종'] if c in df.columns), None)
    industry_col = next((c for c in ['Industry', 'industry', '세부업종'] if c in df.columns), None)

    if not code_col:
        print(f"  ⚠️ FDR 결과에 종목코드 컬럼 없음. cols={list(df.columns)[:10]}", file=sys.stderr)
        return {}

    sector_map = {}
    for _, row in df.iterrows():
        code = str(row.get(code_col, '')).zfill(6)
        if not code:
            continue
        sector = ''
        if sector_col:
            v = row.get(sector_col)
            if v and str(v).strip() and str(v).lower() != 'nan':
                sector = str(v).strip()
        if not sector and industry_col:
            v = row.get(industry_col)
            if v and str(v).strip() and str(v).lower() != 'nan':
                sector = str(v).strip()
        if sector:
            sector_map[code] = sector

    print(f"  ✓ 섹터 매핑 로드: {len(sector_map)} 종목")
    return sector_map


def fetch_fundamentals(tickers: set[str], ref_bday: dt.date) -> dict:
    """등장한 종목의 펀더멘털 + 등락률 + 섹터 + 테마 + 버핏식 점수."""
    ymd = _ymd(ref_bday)
    out = {}

    # 시장 전체 fundamental / 시가총액 / 등락률 한 방에 받기
    print(f"\n📊 펀더멘털·등락률 일괄 조회 ({ref_bday})...")
    fund_all = {}
    cap_all = {}
    change_all = {}

    for market in MARKETS:
        try:
            df_f = _retry(lambda m=market: stock.get_market_fundamental(ymd, market=m))
            if df_f is not None and not df_f.empty:
                for t, row in df_f.iterrows():
                    fund_all[str(t).zfill(6)] = row
        except Exception as e:
            print(f"  ⚠️ {market} 펀더멘털 실패: {e}", file=sys.stderr)
        try:
            df_c = _retry(lambda m=market: stock.get_market_cap(ymd, market=m))
            if df_c is not None and not df_c.empty:
                for t, row in df_c.iterrows():
                    cap_all[str(t).zfill(6)] = float(row["시가총액"])
        except Exception as e:
            print(f"  ⚠️ {market} 시가총액 실패: {e}", file=sys.stderr)
        # 등락률 (시장 전체 OHLCV 의 '등락률' 컬럼)
        try:
            df_o = _retry(lambda m=market: stock.get_market_ohlcv(ymd, market=m))
            if df_o is not None and not df_o.empty and "등락률" in df_o.columns:
                for t, row in df_o.iterrows():
                    try:
                        change_all[str(t).zfill(6)] = float(row["등락률"])
                    except (TypeError, ValueError):
                        pass
        except Exception as e:
            print(f"  ⚠️ {market} 등락률 실패: {e}", file=sys.stderr)
        time.sleep(0.3)

    print(f"  ✓ 펀더멘털 {len(fund_all)} / 시가총액 {len(cap_all)} / 등락률 {len(change_all)} 종목")

    # 섹터 매핑 (FinanceDataReader, 폴백용)
    sector_map = _load_sector_map()

    # 테마 매핑 (네이버 금융 크롤링, 우선 표시용)
    try:
        from themes_naver import build_ticker_theme_map
        theme_map = build_ticker_theme_map()
    except Exception as e:
        print(f"  ⚠️ 네이버 테마 크롤링 실패: {e}", file=sys.stderr)
        theme_map = {}

    name_cache = {}
    for tk in sorted(tickers):
        per = pbr = div = roe_est = cap_eok = eps = bps = dps = None
        if tk in fund_all:
            r = fund_all[tk]
            try: per = float(r.get("PER", 0)) or None
            except Exception: pass
            try: pbr = float(r.get("PBR", 0)) or None
            except Exception: pass
            try: div = float(r.get("DIV", 0))
            except Exception: pass
            try: eps = float(r.get("EPS", 0)) or None
            except Exception: pass
            try: bps = float(r.get("BPS", 0)) or None
            except Exception: pass
            try: dps = float(r.get("DPS", 0))
            except Exception: pass
        if tk in cap_all:
            cap_eok = round(cap_all[tk] / 1e8, 0)
        if per and pbr and per != 0:
            roe_est = round(pbr / per * 100, 2)

        try:
            name = name_cache.get(tk) or stock.get_market_ticker_name(tk)
            name_cache[tk] = name
        except Exception:
            name = tk

        # 테마 (최대 5개), 없으면 빈 리스트
        themes = theme_map.get(tk, [])[:5]

        score = calc_score(per, pbr, div, cap_eok, roe_est)
        out[tk] = {
            "name": name,
            "per": per,
            "pbr": pbr,
            "eps": eps,
            "bps": bps,
            "div_yield": div,
            "dps": dps,
            "market_cap_eok": cap_eok,
            "roe_est": roe_est,
            "daily_change_pct": change_all.get(tk),
            "sector": sector_map.get(tk, ""),
            "themes": themes,
            "score": score,
        }

    return out


# ---------------------------------------------------------------------------
# 메인
# ---------------------------------------------------------------------------
def main() -> int:
    # KRX 자격증명 확인 (GitHub Secrets 로 주입됨)
    if not (os.environ.get("KRX_ID") and os.environ.get("KRX_PW")):
        print("ERROR: KRX_ID / KRX_PW 환경변수가 설정되지 않았습니다.", file=sys.stderr)
        print("       GitHub Actions: Settings → Secrets and variables → Actions 에서 등록.", file=sys.stderr)
        return 1

    today = dt.date.today()
    ref_bday = get_latest_bday(today)
    print(f"🗓️ 기준 영업일: {ref_bday}")

    all_tickers: set[str] = set()

    # 1) 시장 × 기간별 flow 수집
    for market in MARKETS:
        for period in PERIODS:
            print(f"\n📥 {market} / {period}일 수집 중...")
            flow, tickers = fetch_flow(market, period, ref_bday)
            all_tickers |= tickers
            out_path = OUT_DIR / f"flow_{market}_{period}d.json"
            out_path.write_text(
                json.dumps(flow, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            print(f"  💾 저장: {out_path.relative_to(ROOT)}")

    # 2) 펀더멘털 + 점수 수집
    fundamentals = fetch_fundamentals(all_tickers, ref_bday)
    fund_path = OUT_DIR / "fundamentals.json"
    fund_path.write_text(
        json.dumps(fundamentals, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n💾 펀더멘털 저장: {fund_path.relative_to(ROOT)} ({len(fundamentals)} 종목)")

    # 3) manifest
    manifest = {
        "generated_at": dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).isoformat(),
        "base_date": ref_bday.isoformat(),
        "markets": MARKETS,
        "periods": PERIODS,
        "investors": [{"key": k, "label": INVESTOR_LABEL[k]} for k in INVESTORS],
        "top_n": TOP_N,
        "ticker_count": len(fundamentals),
    }
    (OUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"💾 manifest 저장. 완료!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
