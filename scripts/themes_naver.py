# -*- coding: utf-8 -*-
"""
네이버 금융 테마 크롤러

목적
- 종목별 시장 테마(반도체, HBM, AI, 2차전지 등) 정보를 수집한다.
- 결과: { "005930": ["반도체", "HBM", "AI", ...], ... }

특징
- KRX 회원 인증과 무관 (네이버 금융 페이지 스크래핑)
- 차단 위험 완화: User-Agent 설정, 요청 간 sleep, 재시도
- 실패해도 빈 dict 반환 → 앱은 폴백으로 KRX 업종 사용

참고
- 테마 목록: https://finance.naver.com/sise/theme.naver
- 테마 상세: https://finance.naver.com/sise/sise_group_detail.naver?type=theme&no={id}
"""
from __future__ import annotations

import re
import sys
import time
from typing import Optional

import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

BASE = "https://finance.naver.com"


def _get(url: str, retries: int = 3, sleep_after: float = 0.35) -> Optional[str]:
    """네이버 페이지를 가져온다. EUC-KR 인코딩이라 명시적으로 디코딩."""
    last_exc = None
    for i in range(retries):
        try:
            r = requests.get(url, headers=HEADERS, timeout=12)
            r.raise_for_status()
            text = r.content.decode("euc-kr", errors="replace")
            time.sleep(sleep_after)
            return text
        except Exception as e:
            last_exc = e
            time.sleep(0.8 * (i + 1))
    print(f"  ⚠️ GET 실패: {url} ({last_exc})", file=sys.stderr)
    return None


def fetch_theme_list(max_pages: int = 12) -> list[tuple[str, str]]:
    """
    네이버 금융의 모든 테마 목록을 가져온다.
    반환: [(theme_id, theme_name), ...]
    """
    themes: list[tuple[str, str]] = []
    seen: set[str] = set()
    for page in range(1, max_pages + 1):
        url = f"{BASE}/sise/theme.naver?&page={page}"
        html = _get(url)
        if not html:
            break

        soup = BeautifulSoup(html, "html.parser")
        page_count_before = len(themes)
        for a in soup.select('a[href*="sise_group_detail.naver"]'):
            href = a.get("href", "")
            m = re.search(r"no=(\d+)", href)
            if not m:
                continue
            tid = m.group(1)
            if tid in seen:
                continue
            name = a.get_text(strip=True)
            if not name or len(name) > 30:  # 이상한 텍스트 필터
                continue
            seen.add(tid)
            themes.append((tid, name))

        # 더 이상 새 테마가 없으면 종료
        if len(themes) == page_count_before:
            break

    return themes


def fetch_theme_stocks(theme_id: str) -> list[str]:
    """특정 테마에 속한 6자리 종목코드 리스트."""
    url = f"{BASE}/sise/sise_group_detail.naver?type=theme&no={theme_id}"
    html = _get(url)
    if not html:
        return []

    soup = BeautifulSoup(html, "html.parser")
    tickers: set[str] = set()
    for a in soup.select('a[href*="code="]'):
        href = a.get("href", "")
        m = re.search(r"code=(\d{6})", href)
        if m:
            tickers.add(m.group(1))
    return sorted(tickers)


def build_ticker_theme_map(
    blacklist_themes: Optional[set[str]] = None,
    min_stocks: int = 3,
    max_stocks_per_theme: int = 60,
) -> dict[str, list[str]]:
    """
    종목코드 → 테마 리스트 매핑을 생성.

    - blacklist_themes: 너무 범용적이거나 제외할 테마 (예: "시가총액 상위", "코스피200")
    - min_stocks: 종목 수가 이 미만인 테마는 너무 niche 라 제외
    - max_stocks_per_theme: 종목 수가 이 초과인 테마는 너무 범용적이라 제외
    """
    if blacklist_themes is None:
        blacklist_themes = {
            "코스피200", "코스피100", "코스피50",
            "코스닥150", "KRX100",
            "시가총액 상위", "거래량 상위", "거래대금 상위",
            "외국인 보유 상위", "기관매수 상위",
        }

    print("📡 네이버 금융 테마 목록 수집 중...")
    theme_list = fetch_theme_list()
    print(f"  ✓ 테마 {len(theme_list)} 개 발견")

    if not theme_list:
        print("  ⚠️ 테마 목록을 가져오지 못함 (네트워크 또는 차단)")
        return {}

    ticker_to_themes: dict[str, list[str]] = {}
    skipped_too_broad = 0
    skipped_too_narrow = 0
    skipped_blacklist = 0
    success = 0

    for idx, (tid, tname) in enumerate(theme_list, 1):
        if tname in blacklist_themes:
            skipped_blacklist += 1
            continue

        stocks = fetch_theme_stocks(tid)
        if len(stocks) < min_stocks:
            skipped_too_narrow += 1
            continue
        if len(stocks) > max_stocks_per_theme:
            skipped_too_broad += 1
            continue

        for tk in stocks:
            ticker_to_themes.setdefault(tk, []).append(tname)
        success += 1

        if idx % 30 == 0:
            print(f"  진행: {idx}/{len(theme_list)} 테마 처리됨 "
                  f"(성공={success}, blacklist={skipped_blacklist}, "
                  f"too_narrow={skipped_too_narrow}, too_broad={skipped_too_broad})")

    print(f"\n  ✓ 테마 매핑 완료: {len(ticker_to_themes)} 종목, "
          f"{success} 테마 사용 (blacklist {skipped_blacklist}, "
          f"좁음 {skipped_too_narrow}, 범용 {skipped_too_broad})")

    return ticker_to_themes


if __name__ == "__main__":
    # 단독 실행 시 테마 매핑을 JSON 으로 출력 (디버그용)
    import json
    m = build_ticker_theme_map()
    print(f"\n샘플:")
    for tk in ["005930", "000660", "005380", "373220"]:
        print(f"  {tk}: {m.get(tk, [])[:5]}")
    print(f"\n전체 종목 수: {len(m)}")
