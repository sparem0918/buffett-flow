# -*- coding: utf-8 -*-
"""
버핏식 간이 점수 계산
JSON 직렬화 친화적으로 dict 반환
"""
from __future__ import annotations
import math


def _safe(v):
    if v is None:
        return None
    try:
        f = float(v)
        if math.isnan(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


def _score_roe(roe_est):
    if roe_est is None:
        return {"name": "ROE·ROIC (PBR/PER 추정)", "max": 15, "score": 0,
                "auto": True, "detail": "데이터 없음"}
    if roe_est >= 20:
        s = 15; msg = "매우 우수 (20% 이상)"
    elif roe_est >= 15:
        s = 13; msg = "우수 (15~20%)"
    elif roe_est >= 10:
        s = 10; msg = "양호 (10~15%)"
    elif roe_est >= 5:
        s = 6;  msg = "보통 (5~10%)"
    elif roe_est > 0:
        s = 3;  msg = "낮음 (0~5%)"
    else:
        s = 0;  msg = "마이너스 또는 데이터 이상"
    return {"name": "ROE·ROIC (PBR/PER 추정)", "max": 15, "score": s,
            "auto": True, "detail": f"{msg} | 추정 ROE = {roe_est:.2f}%"}


def _score_per(per):
    if per is None:
        return {"name": "PER 평가", "max": 5, "score": 0, "auto": True, "detail": "데이터 없음"}
    if per <= 0:
        return {"name": "PER 평가", "max": 5, "score": 0, "auto": True,
                "detail": f"적자 또는 음수 PER ({per:.2f})"}
    if per <= 8:    s, msg = 5, "매우 저평가 (PER 8 이하)"
    elif per <= 12: s, msg = 4, "저평가 (PER 8~12)"
    elif per <= 18: s, msg = 3, "보통 (PER 12~18)"
    elif per <= 25: s, msg = 2, "다소 고평가 (PER 18~25)"
    elif per <= 40: s, msg = 1, "고평가 (PER 25~40)"
    else:           s, msg = 0, "과열 가능 (PER 40 이상)"
    return {"name": "PER 평가", "max": 5, "score": s, "auto": True,
            "detail": f"{msg} | PER = {per:.2f}"}


def _score_pbr(pbr):
    if pbr is None:
        return {"name": "PBR 평가", "max": 5, "score": 0, "auto": True, "detail": "데이터 없음"}
    if pbr <= 0:
        return {"name": "PBR 평가", "max": 5, "score": 0, "auto": True,
                "detail": f"이상치 ({pbr:.2f})"}
    if pbr <= 1.0:  s, msg = 5, "장부가 이하 (PBR 1.0 이하)"
    elif pbr <= 1.5: s, msg = 4, "저평가 (PBR 1.0~1.5)"
    elif pbr <= 2.5: s, msg = 3, "보통 (PBR 1.5~2.5)"
    elif pbr <= 4.0: s, msg = 2, "다소 고평가 (PBR 2.5~4.0)"
    elif pbr <= 7.0: s, msg = 1, "고평가 (PBR 4.0~7.0)"
    else:            s, msg = 0, "과열 가능 (PBR 7.0 이상)"
    return {"name": "PBR 평가", "max": 5, "score": s, "auto": True,
            "detail": f"{msg} | PBR = {pbr:.2f}"}


def _score_div(div):
    if div is None:
        return {"name": "주주환원 (배당수익률)", "max": 10, "score": 0, "auto": True, "detail": "데이터 없음"}
    if div >= 5.0:   s, msg = 10, "매우 매력적 (5% 이상)"
    elif div >= 3.5: s, msg = 8,  "매력적 (3.5~5%)"
    elif div >= 2.0: s, msg = 6,  "양호 (2.0~3.5%)"
    elif div >= 1.0: s, msg = 4,  "보통 (1.0~2.0%)"
    elif div > 0:    s, msg = 2,  "낮음 (0~1.0%)"
    else:            s, msg = 0,  "무배당"
    return {"name": "주주환원 (배당수익률)", "max": 10, "score": s, "auto": True,
            "detail": f"{msg} | 배당수익률 = {div:.2f}%"}


def _score_cap(cap_eok):
    if cap_eok is None:
        return {"name": "규모 안정성 (시가총액)", "max": 10, "score": 0, "auto": True, "detail": "데이터 없음"}
    if cap_eok >= 100000:  s, msg = 10, "초대형주 (10조 이상)"
    elif cap_eok >= 30000: s, msg = 8,  "대형주 (3~10조)"
    elif cap_eok >= 10000: s, msg = 6,  "중대형주 (1~3조)"
    elif cap_eok >= 3000:  s, msg = 4,  "중형주 (3천억~1조)"
    elif cap_eok >= 1000:  s, msg = 2,  "소형주 (1천억~3천억)"
    else:                  s, msg = 1,  "초소형주"
    return {"name": "규모 안정성 (시가총액)", "max": 10, "score": s, "auto": True,
            "detail": f"{msg} | 시총 = {cap_eok:,.0f} 억원"}


_MANUAL_ITEMS = [
    {"name": "사업 이해도", "max": 10, "score": 0, "auto": False,
     "detail": "사업보고서로 매출 구조를 직접 설명할 수 있는지 확인"},
    {"name": "장기 매출 성장성", "max": 10, "score": 0, "auto": False,
     "detail": "DART 에서 최근 5년 매출 추이 확인"},
    {"name": "영업이익 안정성", "max": 10, "score": 0, "auto": False,
     "detail": "DART 에서 최근 5년 영업이익률 추이 확인"},
    {"name": "현금흐름 (영업CF/FCF)", "max": 15, "score": 0, "auto": False,
     "detail": "현금흐름표에서 영업CF ≥ 순이익 여부, FCF 양수 여부 확인"},
    {"name": "부채 안정성", "max": 10, "score": 0, "auto": False,
     "detail": "부채비율, 이자보상배율, 순차입금 확인"},
    {"name": "해자·경쟁력", "max": 10, "score": 0, "auto": False,
     "detail": "브랜드/비용우위/네트워크/독점력 등 정성 평가"},
]


def calc_score(per, pbr, div, cap, roe_est):
    """JSON 직렬화 가능한 dict 반환"""
    items = [_score_roe(roe_est), _score_per(per), _score_pbr(pbr),
             _score_div(div), _score_cap(cap)] + _MANUAL_ITEMS

    auto_items = [i for i in items if i["auto"]]
    auto_total = sum(i["score"] for i in auto_items)
    auto_max = sum(i["max"] for i in auto_items)
    normalized = round(auto_total / auto_max * 100, 1) if auto_max else 0.0

    if normalized >= 80:   grade = "우선 정밀검토 후보"
    elif normalized >= 65: grade = "조건부 검토"
    elif normalized >= 50: grade = "보수적 접근"
    else:                  grade = "버핏식 기준 부적합 가능성"

    return {
        "auto_total": auto_total,
        "auto_max": auto_max,
        "normalized": normalized,
        "grade": grade,
        "items": items,
    }
