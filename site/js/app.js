// ============================================================
// 버핏식 수급 뷰어 - 프론트엔드 로직
// ============================================================
'use strict';

const state = {
  market: 'KOSPI',
  period: 1,
  investor: '기관합계',
  flow: 'net_buy',   // net_buy | buy | sell
  manifest: null,
  flowCache: {},     // key: "KOSPI_1" -> flow JSON
  fundamentals: null,
};

const DATA_BASE = './data';
const FLOW_LABELS = { net_buy: '순매수', buy: '매수', sell: '매도' };

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
    showBanner(`데이터를 불러오는 중 오류가 발생했습니다: ${e.message}`, 'error');
    document.getElementById('ranking-tbody').innerHTML =
      `<tr><td colspan="6" class="empty-state">⚠️ 아직 데이터가 생성되지 않았을 수 있습니다.<br>GitHub Actions 가 처음 실행될 때까지 잠시 기다려주세요.</td></tr>`;
  }
});

// ============================================================
// 데이터 로드
// ============================================================
async function loadManifest() {
  const res = await fetch(`${DATA_BASE}/manifest.json?t=${Date.now()}`);
  if (!res.ok) throw new Error(`manifest.json 로드 실패 (${res.status})`);
  state.manifest = await res.json();

  // 헤더 메타 표시
  const baseDate = state.manifest.base_date || '—';
  const generated = state.manifest.generated_at || '—';
  document.getElementById('meta-base-date').textContent = `기준 영업일: ${baseDate}`;
  document.getElementById('meta-generated').textContent =
    `갱신: ${formatGenerated(generated)}`;
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
  document.querySelectorAll('#tabs-market .tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab('market', btn));
  });
  document.querySelectorAll('#tabs-period .tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab('period', btn));
  });
  document.querySelectorAll('#tabs-investor .tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab('investor', btn));
  });
  document.querySelectorAll('#tabs-flow .tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab('flow', btn));
  });
}

async function switchTab(category, btn) {
  // active 토글
  btn.parentElement.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  // state 업데이트
  if (category === 'market')   state.market = btn.dataset.market;
  if (category === 'period')   state.period = parseInt(btn.dataset.period, 10);
  if (category === 'investor') state.investor = btn.dataset.investor;
  if (category === 'flow')     state.flow = btn.dataset.flow;

  await renderTable();
}

// ============================================================
// 표 렌더링
// ============================================================
async function renderTable() {
  const tbody = document.getElementById('ranking-tbody');
  tbody.innerHTML = `<tr><td colspan="6" class="loading">⏳ 로딩 중...</td></tr>`;
  hideBanner();

  let flowData;
  try {
    flowData = await loadFlow(state.market, state.period);
  } catch (e) {
    tbody.innerHTML =
      `<tr><td colspan="6" class="empty-state">⚠️ ${escapeHtml(e.message)}</td></tr>`;
    return;
  }

  const inv = flowData.investors?.[state.investor];
  if (!inv) {
    tbody.innerHTML =
      `<tr><td colspan="6" class="empty-state">선택한 투자자 정보를 찾을 수 없습니다.</td></tr>`;
    return;
  }

  const rows = inv.rankings?.[state.flow] || [];
  if (rows.length === 0) {
    let msg = `📭 <b>${inv.label}</b>의 ${FLOW_LABELS[state.flow]} 상위 데이터가 없습니다.`;
    if (state.period === 1) {
      msg += '<br><br>👉 1일(당일) 데이터는 장 마감 후(약 19시) 갱신됩니다. 5일/20일 탭을 시도해보세요.';
    }
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">${msg}</td></tr>`;
    return;
  }

  // 현재 정렬 컬럼 강조 (CSS 클래스로 처리 가능)
  tbody.innerHTML = rows.map(row => renderRow(row)).join('');

  // 행 클릭 이벤트
  tbody.querySelectorAll('tr[data-ticker]').forEach(tr => {
    tr.addEventListener('click', () => openDetail(tr.dataset.ticker));
  });
}

function renderRow(row) {
  const fund = state.fundamentals?.[row.ticker];
  const scoreHtml = fund?.score
    ? renderScorePill(fund.score.normalized, fund.score.grade)
    : '<span class="score-pill none">—</span>';

  const buyCls  = row.buy_value_eok  > 0 ? 'value-pos' : '';
  const sellCls = row.sell_value_eok > 0 ? 'value-neg' : '';
  const netCls  = row.net_value_eok  > 0 ? 'value-pos'
                : row.net_value_eok  < 0 ? 'value-neg' : '';

  return `
    <tr data-ticker="${escapeHtml(row.ticker)}">
      <td class="col-rank">${row.rank}</td>
      <td class="col-name">
        <div class="ticker-cell">
          <span class="name">${escapeHtml(row.name)}</span>
          <span class="ticker">${escapeHtml(row.ticker)}</span>
        </div>
      </td>
      <td class="col-num ${buyCls}">${fmtNum(row.buy_value_eok)}</td>
      <td class="col-num ${sellCls}">${fmtNum(row.sell_value_eok)}</td>
      <td class="col-num ${netCls}">${fmtNum(row.net_value_eok, true)}</td>
      <td class="col-score">${scoreHtml}</td>
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

function fmtNum(v, withSign = false) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  const sign = withSign && v > 0 ? '+' : '';
  return sign + v.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
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
  if (!fund) {
    alert('해당 종목의 펀더멘털 정보가 없습니다.');
    return;
  }
  const modal = document.getElementById('detail-modal');
  document.getElementById('detail-title').textContent = fund.name;

  const score = fund.score || {};
  const gradeClass =
    score.grade?.includes('정밀검토') ? 'grade-a' :
    score.grade?.includes('조건부')   ? 'grade-b' :
    score.grade?.includes('보수적')   ? 'grade-c' : 'grade-d';

  const gradeColors = {
    'grade-a': 'var(--grade-a)',
    'grade-b': 'var(--grade-b)',
    'grade-c': 'var(--grade-c)',
    'grade-d': 'var(--grade-d)',
  };

  const fmtV = (v, suf = '') => {
    if (v === null || v === undefined || isNaN(v)) return '—';
    if (typeof v === 'number') return v.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + suf;
    return String(v) + suf;
  };

  const capStr = fund.market_cap_eok
    ? fund.market_cap_eok.toLocaleString('ko-KR', { maximumFractionDigits: 0 }) + ' 억원'
    : '—';

  const itemsHtml = (score.items || []).map(it => `
    <tr class="${it.auto ? 'auto-row' : 'manual-row'}">
      <td class="col-type">${it.auto ? '✅ 자동' : '📝 수동'}</td>
      <td>${escapeHtml(it.name)}</td>
      <td class="col-score">${it.score.toFixed(1)} / ${it.max}</td>
      <td class="col-detail">${escapeHtml(it.detail)}</td>
    </tr>
  `).join('');

  document.getElementById('detail-content').innerHTML = `
    <div class="detail-ticker">티커: ${escapeHtml(ticker)}</div>

    <div class="metrics-grid">
      <div class="metric-box"><div class="label">PER</div><div class="value">${fmtV(fund.per)}</div></div>
      <div class="metric-box"><div class="label">PBR</div><div class="value">${fmtV(fund.pbr)}</div></div>
      <div class="metric-box"><div class="label">배당수익률</div><div class="value">${fmtV(fund.div_yield, '%')}</div></div>
      <div class="metric-box"><div class="label">EPS</div><div class="value">${fmtV(fund.eps)}</div></div>
      <div class="metric-box"><div class="label">BPS</div><div class="value">${fmtV(fund.bps)}</div></div>
      <div class="metric-box"><div class="label">시가총액</div><div class="value">${capStr}</div></div>
    </div>

    <div class="score-summary">
      <div>
        <div class="score-num">${(score.normalized ?? 0).toFixed(1)} <small>/ 100</small></div>
        <div class="score-detail">
          자동 채점: ${score.auto_total ?? 0} / ${score.auto_max ?? 0}점
          (자동 채점 가능 항목만 100점 환산)
        </div>
      </div>
      <div>
        <span class="grade-badge" style="background:${gradeColors[gradeClass]};">
          ${escapeHtml(score.grade || '—')}
        </span>
      </div>
    </div>

    <div class="score-list">
      <table>
        <thead>
          <tr>
            <th>구분</th>
            <th>항목</th>
            <th class="col-score">점수</th>
            <th>근거</th>
          </tr>
        </thead>
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
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function showBanner(text, cls = '') {
  const b = document.getElementById('info-banner');
  b.className = 'info-banner' + (cls ? ' ' + cls : '');
  b.innerHTML = text;
  b.hidden = false;
}

function hideBanner() {
  document.getElementById('info-banner').hidden = true;
}
