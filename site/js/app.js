// ============================================================
// 버핏식 수급 뷰어 - 프론트엔드 로직 v3
// ============================================================
'use strict';

const state = {
  market: 'KOSPI',
  period: 1,
  investor: '기관합계',
  flow: 'net_buy',     // 'net_buy' | 'net_sell' | 'combined'
  manifest: null,
  flowCache: {},
  fundamentals: null,
};

const DATA_BASE = './data';
const FLOW_LABELS = {
  net_buy:  { ko: '순매수', icon: '📈', col: '순매수<br>(억원)', kind: 'buy' },
  net_sell: { ko: '순매도', icon: '📉', col: '순매도<br>(억원)', kind: 'sell' },
  combined: { ko: '통합',   icon: '⚖️', col: '순매수/매도<br>(억원)', kind: 'mixed' },
};
const HOT_RISE_THRESHOLD = 6.0;  // +6% 이상 강조

// ============================================================
// 부팅
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  bindTabs();
  bindModal();
  try {
    await loadManifest();
    await loadFundamentals();
    await renderTable();
  } catch (e) {
    console.error(e);
    document.getElementById('ranking-tbody').innerHTML =
      `<tr><td colspan="7" class="empty-state">⚠️ 아직 데이터가 생성되지 않았을 수 있습니다.<br>GitHub Actions 가 처음 실행될 때까지 잠시 기다려주세요.<br><br><small>오류: ${escapeHtml(e.message)}</small></td></tr>`;
  }
});

// ============================================================
// 데이터 로드
// ============================================================
async function loadManifest() {
  const res = await fetch(`${DATA_BASE}/manifest.json?t=${Date.now()}`);
  if (!res.ok) throw new Error(`manifest.json 로드 실패 (${res.status})`);
  state.manifest = await res.json();
  document.getElementById('meta-base-date').textContent =
    `기준 영업일: ${state.manifest.base_date || '—'}`;
  document.getElementById('meta-generated').textContent =
    `갱신: ${formatGenerated(state.manifest.generated_at)}`;
}

async function loadFundamentals() {
  const res = await fetch(`${DATA_BASE}/fundamentals.json?t=${Date.now()}`);
  if (!res.ok) throw new Error(`fundamentals.json 로드 실패 (${res.status})`);
  state.fundamentals = await res.json();
}

async function loadFlow(market, period) {
  const key = `${market}_${period}`;
  if (state.flowCache[key]) return state.flowCache[key];
  const path = `${DATA_BASE}/flow_${market}_${period}d.json?t=${Date.now()}`;
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} 로드 실패 (${res.status})`);
  const data = await res.json();
  state.flowCache[key] = data;
  return data;
}

function formatGenerated(isoStr) {
  if (!isoStr || isoStr === '—') return '—';
  try {
    const d = new Date(isoStr);
    const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    return `${y}-${m}-${day} ${hh}:${mm} KST`;
  } catch (e) {
    return isoStr;
  }
}

// ============================================================
// 탭 처리
// ============================================================
function bindTabs() {
  ['market', 'period', 'investor', 'flow'].forEach(cat => {
    document.querySelectorAll(`#tabs-${cat} .tab`).forEach(btn => {
      btn.addEventListener('click', () => switchTab(cat, btn));
    });
  });
}

async function switchTab(category, btn) {
  btn.parentElement.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  if (category === 'market')   state.market = btn.dataset.market;
  if (category === 'period')   state.period = parseInt(btn.dataset.period, 10);
  if (category === 'investor') state.investor = btn.dataset.investor;
  if (category === 'flow')     state.flow = btn.dataset.flow;

  // 컬럼 헤더 라벨 동적 갱신
  const th = document.getElementById('th-flow');
  if (th) th.innerHTML = FLOW_LABELS[state.flow].col;

  await renderTable();
}

// ============================================================
// 표 렌더링
// ============================================================
async function renderTable() {
  const tbody = document.getElementById('ranking-tbody');
  tbody.innerHTML = `<tr><td colspan="7" class="loading">⏳ 로딩 중...</td></tr>`;

  let flowData;
  try {
    flowData = await loadFlow(state.market, state.period);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">⚠️ ${escapeHtml(e.message)}</td></tr>`;
    return;
  }

  const inv = flowData.investors?.[state.investor];
  if (!inv) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">선택한 투자자 정보를 찾을 수 없습니다.</td></tr>`;
    return;
  }

  // 현재 탭에 맞는 rows 결정
  let rows = [];
  let kindForRow = state.flow;  // 각 행의 종류 (combined일 때 자동 결정)
  if (state.flow === 'combined') {
    rows = buildCombined(inv.rankings);
  } else {
    rows = (inv.rankings?.[state.flow] || []).map(r => ({...r, _kind: state.flow}));
  }

  if (rows.length === 0) {
    let msg = `📭 <b>${inv.label}</b>의 ${FLOW_LABELS[state.flow].ko} 상위 데이터가 없습니다.`;
    if (state.period === 1) {
      msg += '<br><br>👉 1일(당일) 데이터는 장 마감 후(약 19시) 갱신됩니다. 5일/20일 탭을 시도해보세요.';
    }
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">${msg}</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(row => renderRow(row)).join('');
  tbody.querySelectorAll('tr[data-ticker]').forEach(tr => {
    tr.addEventListener('click', () => openDetail(tr.dataset.ticker));
  });
}

// 통합 탭: 순매수 + 순매도를 합쳐 절댓값 기준 상위 20개
function buildCombined(rankings) {
  const buy  = (rankings?.net_buy  || []).map(r => ({...r, _kind: 'net_buy'}));
  const sell = (rankings?.net_sell || []).map(r => ({...r, _kind: 'net_sell'}));
  const merged = [...buy, ...sell];
  // 절댓값(=net_value_eok, 둘 다 양수로 저장됨) 기준 내림차순
  merged.sort((a, b) => b.net_value_eok - a.net_value_eok);
  // 순위 재부여
  return merged.slice(0, 20).map((r, i) => ({...r, rank: i + 1}));
}

function renderRow(row) {
  const fund = state.fundamentals?.[row.ticker];
  const scoreHtml = fund?.score
    ? renderScorePill(fund.score.normalized, fund.score.grade)
    : '<span class="score-pill none">—</span>';

  // 섹터/테마
  let categoryText = '';
  if (fund?.themes && fund.themes.length > 0) {
    categoryText = fund.themes.slice(0, 5).join(' · ');
  } else if (fund?.sector) {
    categoryText = fund.sector;
  }
  const categoryHtml = categoryText ? ` · ${escapeHtml(categoryText)}` : '';

  // 종류별 색 (net_buy = 빨강, net_sell = 파랑)
  const kindCls = row._kind === 'net_buy' ? 'value-pos' : 'value-neg';
  const kindLabel = row._kind === 'net_buy' ? '순매수' : '순매도';
  const kindSign = row._kind === 'net_buy' ? '+' : '−';

  // 현재가
  const priceText = (fund?.close_price != null)
    ? fund.close_price.toLocaleString('ko-KR') : '—';

  // 대비(원)
  const chgAmt = fund?.daily_change_amount;
  let chgAmtHtml = '—';
  if (chgAmt != null && !isNaN(chgAmt)) {
    const cls = chgAmt > 0 ? 'value-pos' : chgAmt < 0 ? 'value-neg' : '';
    const sign = chgAmt > 0 ? '+' : '';
    chgAmtHtml = `<span class="${cls}">${sign}${chgAmt.toLocaleString('ko-KR')}</span>`;
  }

  // 등락률
  const chg = fund?.daily_change_pct;
  let chgPctHtml = '<span class="change-neutral">—</span>';
  let hotMark = '';
  let rowExtraCls = '';
  if (chg != null && !isNaN(chg)) {
    const cls = chg > 0 ? 'change-pos' : chg < 0 ? 'change-neg' : 'change-neutral';
    const sign = chg > 0 ? '+' : '';
    const arrow = chg > 0 ? '▲ ' : chg < 0 ? '▼ ' : '';
    chgPctHtml = `<span class="${cls}">${arrow}${sign}${chg.toFixed(2)}%</span>`;
    if (chg >= HOT_RISE_THRESHOLD) {
      hotMark = '<span class="hot-mark" title="등락률 +6% 이상 강세">🔥</span> ';
      rowExtraCls = 'hot-rise';
    }
  }

  return `
    <tr data-ticker="${escapeHtml(row.ticker)}" class="${rowExtraCls}">
      <td class="col-rank" data-label="순위">${row.rank}</td>
      <td class="col-name" data-label="종목">
        <div class="ticker-cell">
          <span class="name">${hotMark}${escapeHtml(row.name)}</span>
          <span class="ticker">${escapeHtml(row.ticker)}${categoryHtml}</span>
        </div>
      </td>
      <td class="col-num col-price" data-label="현재가">${priceText}</td>
      <td class="col-num col-flow-amount ${kindCls}" data-label="${kindLabel}">
        <span class="flow-label">${kindLabel}</span>
        ${kindSign}${fmtNum(row.net_value_eok)}
      </td>
      <td class="col-num col-change-amt" data-label="대비(원)">${chgAmtHtml}</td>
      <td class="col-change" data-label="등락률">${chgPctHtml}</td>
      <td class="col-score" data-label="점수">${scoreHtml}</td>
    </tr>
  `;
}

function renderScorePill(normalized, grade) {
  let cls = 'grade-d';
  if (grade?.includes('정밀검토'))    cls = 'grade-a';
  else if (grade?.includes('조건부')) cls = 'grade-b';
  else if (grade?.includes('보수적')) cls = 'grade-c';
  return `<span class="score-pill ${cls}" title="${escapeHtml(grade || '')}">${normalized.toFixed(0)}</span>`;
}

function fmtNum(v) {
  if (v == null || isNaN(v)) return '—';
  return v.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
}

// ============================================================
// 종목 상세 모달
// ============================================================
function bindModal() {
  document.querySelectorAll('[data-close="modal"]').forEach(el => {
    el.addEventListener('click', closeDetail);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDetail();
  });
}

function openDetail(ticker) {
  const fund = state.fundamentals?.[ticker];
  if (!fund) { alert('해당 종목의 펀더멘털 정보가 없습니다.'); return; }
  const modal = document.getElementById('detail-modal');
  document.getElementById('detail-title').textContent = fund.name;

  const score = fund.score || {};
  const gradeClass =
    score.grade?.includes('정밀검토') ? 'grade-a' :
    score.grade?.includes('조건부')   ? 'grade-b' :
    score.grade?.includes('보수적')   ? 'grade-c' : 'grade-d';
  const gradeColors = {
    'grade-a': 'var(--grade-a)', 'grade-b': 'var(--grade-b)',
    'grade-c': 'var(--grade-c)', 'grade-d': 'var(--grade-d)',
  };

  const fmtV = (v, suf = '') => {
    if (v == null || isNaN(v)) return '—';
    if (typeof v === 'number') return v.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + suf;
    return String(v) + suf;
  };

  const capStr = fund.market_cap_eok
    ? fund.market_cap_eok.toLocaleString('ko-KR', { maximumFractionDigits: 0 }) + ' 억원' : '—';

  // 현재가 & 대비
  const priceStr = fund.close_price != null ? fund.close_price.toLocaleString('ko-KR') + ' 원' : '—';
  const chg = fund.daily_change_pct;
  const chgAmt = fund.daily_change_amount;
  let chgValueHtml = '—';
  if (chg != null && !isNaN(chg)) {
    const cls = chg > 0 ? 'change-pos' : chg < 0 ? 'change-neg' : '';
    const sign = chg > 0 ? '+' : '';
    const amtStr = (chgAmt != null) ? ` (${sign}${chgAmt.toLocaleString('ko-KR')}원)` : '';
    chgValueHtml = `<span class="${cls}">${sign}${chg.toFixed(2)}%${amtStr}</span>`;
  }

  // 테마 뱃지
  let badgeHtml = '';
  if (fund.themes && fund.themes.length > 0) {
    badgeHtml = fund.themes.slice(0, 5).map(t =>
      `<span class="sector-badge">${escapeHtml(t)}</span>`).join(' ');
  } else if (fund.sector) {
    badgeHtml = `<span class="sector-badge">${escapeHtml(fund.sector)}</span>`;
  }
  const sectorBadge = badgeHtml ? ` ${badgeHtml}` : '';

  const itemsHtml = (score.items || []).map(it => `
    <tr class="${it.auto ? 'auto-row' : 'manual-row'}">
      <td class="col-type">${it.auto ? '✅ 자동' : '📝 수동'}</td>
      <td>${escapeHtml(it.name)}</td>
      <td class="col-score">${it.score.toFixed(1)} / ${it.max}</td>
      <td class="col-detail">${escapeHtml(it.detail)}</td>
    </tr>`).join('');

  document.getElementById('detail-content').innerHTML = `
    <div class="detail-ticker">티커: ${escapeHtml(ticker)}${sectorBadge}</div>

    <div class="metrics-grid">
      <div class="metric-box"><div class="label">현재가</div><div class="value">${priceStr}</div></div>
      <div class="metric-box"><div class="label">등락률</div><div class="value">${chgValueHtml}</div></div>
      <div class="metric-box"><div class="label">PER</div><div class="value">${fmtV(fund.per)}</div></div>
      <div class="metric-box"><div class="label">PBR</div><div class="value">${fmtV(fund.pbr)}</div></div>
      <div class="metric-box"><div class="label">배당수익률</div><div class="value">${fmtV(fund.div_yield, '%')}</div></div>
      <div class="metric-box"><div class="label">시가총액</div><div class="value">${capStr}</div></div>
    </div>

    <div class="score-summary">
      <div>
        <div class="score-num">${(score.normalized ?? 0).toFixed(1)} <small>/ 100</small></div>
        <div class="score-detail">자동 채점: ${score.auto_total ?? 0} / ${score.auto_max ?? 0}점</div>
      </div>
      <div>
        <span class="grade-badge" style="background:${gradeColors[gradeClass]};">${escapeHtml(score.grade || '—')}</span>
      </div>
    </div>

    <div class="score-list">
      <table>
        <thead><tr><th>구분</th><th>항목</th><th class="col-score">점수</th><th>근거</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
    </div>

    <p style="font-size:11px;color:var(--text-muted);margin-top:10px;">
      📝 수동 항목은 DART 전자공시(사업보고서)에서 직접 확인이 필요합니다.
    </p>
    <a class="dart-link" href="https://dart.fss.or.kr/dsab007/main.do?textCrpNm=${encodeURIComponent(fund.name)}"
       target="_blank" rel="noopener">
      🔍 DART 에서 ${escapeHtml(fund.name)} 공시 보기 →
    </a>
  `;

  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  document.getElementById('detail-modal').hidden = true;
  document.body.style.overflow = '';
}

// ============================================================
// 유틸
// ============================================================
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
