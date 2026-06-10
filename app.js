/* ============================================================
 *  산업재해 현황 분석 대시보드 v4.1 — 클라이언트
 *
 *  ■ Apps Script 배포 URL을 아래 API_URL에 붙여넣으세요.
 *  ■ 변경사항 v4.1:
 *    - 드롭다운 변경 시 자동 조회 (조회 버튼 제거)
 *    - KPI 3개 (총 재해, 전년대비, 최다유형)
 *    - 차트 색상: 1위 RED, 2위 BLUE, 3위이하 GRAY
 *    - 3개년 월별 추이 라인 차트 추가
 *    - 미분류 필터링
 * ============================================================ */

// ★★★ 여기에 Apps Script 배포 URL을 붙여넣으세요 ★★★
const API_URL = 'https://script.google.com/macros/s/AKfycbxMAPXygmi8TKEoHO09LYI8LZbS5PY_wodfmheb3_QMCjBYDRZ7BNfP3gt79KpS4jUhvg/exec';

/* ============ CI 컬러 ============ */
const CI_RED  = '#E60033';
const CI_BLUE = '#002B6D';
const CI_DEEP = '#13245A';
const CI_GRAY = '#919191';

/* ============ 상태 관리 ============ */

const state = {
  division: null,
  year: null,
  month: '전체',
  charts: { type: null, dept: null, team: null, trend: null },
  repeatRows: [],
  repeatPage: 1,
  listRows: [],
  listPage: 1,
  currentView: 'dashboard'
};

const PAGE_SIZE_MODAL = 5;
const PAGE_SIZE_REPEAT = 5;

/* ============ 유틸리티 ============ */

function $(id) { return document.getElementById(id); }

function showLoading(msg) {
  const overlay = $('loadingOverlay');
  if (overlay) overlay.classList.remove('hidden');
  const loaderTitle = document.querySelector('.loader-title');
  if (loaderTitle && msg) loaderTitle.textContent = msg;
}

function hideLoading() {
  const overlay = $('loadingOverlay');
  if (overlay) overlay.classList.add('hidden');
}

async function callAPI(params) {
  const query = new URLSearchParams(params).toString();
  const url = API_URL + '?' + query;
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error('서버 응답 오류: HTTP ' + response.status);
  const data = await response.json();
  if (data && data.ok === false && data.message) throw new Error(data.message);
  return data;
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"]/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])
  );
}
function escapeAttr(v) { return esc(v).replace(/'/g, '&#39;'); }
function shorten(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }

function formatDiff(n) {
  n = Number(n || 0);
  if (n > 0) return '▲ ' + n + '건';
  if (n < 0) return '▼ ' + Math.abs(n) + '건';
  return '동일';
}

function getDiffClass(n) {
  n = Number(n || 0);
  if (n > 0) return 'kpi-up';
  if (n < 0) return 'kpi-down';
  return 'kpi-zero';
}

function fillSelect(sel, arr, selected) {
  sel.innerHTML = '';
  arr.forEach(v => {
    const op = document.createElement('option');
    op.value = v; op.textContent = v;
    if (String(v) === String(selected)) op.selected = true;
    sel.appendChild(op);
  });
}

function fillSelectWithAll(sel, arr) {
  const cur = sel.value;
  sel.innerHTML = '<option value="전체">전체</option>';
  (arr || []).forEach(v => {
    const op = document.createElement('option');
    op.value = v; op.textContent = v; sel.appendChild(op);
  });
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
}

/**
 * 순위별 색상 배열 생성 (CI 기준)
 * 1위: RED, 2위: BLUE, 3위이하: GRAY
 */
function rankColors(count) {
  const colors = [];
  for (let i = 0; i < count; i++) {
    if (i === 0)      colors.push(CI_RED);
    else if (i === 1) colors.push(CI_BLUE);
    else              colors.push(CI_GRAY);
  }
  return colors;
}

/* ============ 이벤트 바인딩 ============ */

window.addEventListener('load', () => {
  // 로그인
  $('loginBtn').addEventListener('click', login);
  $('loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });

  // 로그아웃
  $('logoutBtn').addEventListener('click', () => location.reload());

  // ★ 대시보드 드롭다운 변경 시 자동 조회
  $('dashYear').addEventListener('change', loadDashboard);
  $('dashMonth').addEventListener('change', loadDashboard);

  // 데이터 조회
  $('dataSearchBtn').addEventListener('click', loadDataTable);
  $('filterDept').addEventListener('change', () => updateCascade('dept'));
  $('filterTeam').addEventListener('change', () => updateCascade('team'));

  // 반복사고 페이지네이션
  $('repeatPrev').addEventListener('click', () => {
    if (state.repeatPage > 1) { state.repeatPage--; renderRepeatList(); }
  });
  $('repeatNext').addEventListener('click', () => {
    const max = Math.max(1, Math.ceil(state.repeatRows.length / PAGE_SIZE_REPEAT));
    if (state.repeatPage < max) { state.repeatPage++; renderRepeatList(); }
  });

  // 리스트 모달 페이지네이션
  $('listPrev').addEventListener('click', () => {
    if (state.listPage > 1) { state.listPage--; renderListModalPage(); }
  });
  $('listNext').addEventListener('click', () => {
    const max = Math.max(1, Math.ceil(state.listRows.length / PAGE_SIZE_MODAL));
    if (state.listPage < max) { state.listPage++; renderListModalPage(); }
  });

  // 모달 닫기
  document.querySelectorAll('.modalClose').forEach(btn => btn.addEventListener('click', closeModals));

  // 네비게이션
  document.querySelectorAll('.nav[data-view]').forEach(btn =>
    btn.addEventListener('click', () => switchView(btn.dataset.view))
  );
});

/* ============ 로그인 ============ */

async function login() {
  const division = $('loginDivision').value;
  const password = $('loginPassword').value;
  const loginError = $('loginError');
  if (loginError) loginError.textContent = '';
  showLoading('로그인 확인 중입니다');
  try {
    const res = await callAPI({ action: 'login', division, password });
    state.division = res.division;
    const sideDiv = $('sideDivision');
    if (sideDiv) sideDiv.textContent = state.division;
    $('loginView').classList.add('hidden');
    $('appView').classList.remove('hidden');
    await initAfterLogin();
  } catch (err) {
    if (loginError) loginError.textContent = err.message || String(err);
  } finally {
    hideLoading();
  }
}

/* ============ 로그인 후 초기화 ============ */

async function initAfterLogin() {
  showLoading('초기 데이터를 불러오는 중입니다');
  const init = await callAPI({ action: 'init', division: state.division });

  const years = init.years && init.years.length ? init.years : [String(new Date().getFullYear())];
  const months = ['전체', '1월', '2월', '3월', '4월', '5월', '6월',
                  '7월', '8월', '9월', '10월', '11월', '12월'];

  fillSelect($('dashYear'), years, init.defaultYear);
  fillSelect($('dashMonth'), months, '전체');
  fillSelect($('dataYear'), years, init.defaultYear);
  fillSelect($('dataMonth'), months, '전체');

  state.year = $('dashYear').value;
  state.month = $('dashMonth').value;

  await updateCascade();
  await loadDashboard();
}

/* ============ 대시보드 ============ */

async function loadDashboard() {
  state.year = $('dashYear').value;
  state.month = $('dashMonth').value;
  showLoading('대시보드를 불러오는 중입니다');
  try {
    const data = await callAPI({
      action: 'dashboard',
      division: state.division,
      year: state.year,
      month: state.month
    });
    renderDashboard(data || {});
  } catch (err) {
    alert('대시보드 조회 오류: ' + (err.message || err));
  } finally {
    hideLoading();
  }
}

function renderDashboard(data) {
  const k = data.kpi || { total: 0, yoyDiff: 0, yoyBase: 0, topType: '-', topTypeCount: 0 };

  // 총 재해 건수
  const kpiTotal = $('kpiTotal');
  if (kpiTotal) kpiTotal.textContent = (k.total || 0) + '건';

  // 전년 대비 (간결하게)
  const yoyEl = $('kpiYoy');
  if (yoyEl) {
    yoyEl.textContent = formatDiff(k.yoyDiff);
    yoyEl.className = getDiffClass(k.yoyDiff);
  }
  const kpiYoySub = $('kpiYoySub');
  if (kpiYoySub) kpiYoySub.textContent = '전년 ' + (k.yoyBase || 0) + '건 → 금년 ' + (k.total || 0) + '건';

  // 최다 재해유형
  const kpiTopType = $('kpiTopType');
  if (kpiTopType) kpiTopType.textContent = k.topType || '-';
  const kpiTopTypeCount = $('kpiTopTypeCount');
  if (kpiTopTypeCount) kpiTopTypeCount.textContent = (k.topTypeCount || 0) + '건';

  // 빈 데이터 메시지
  const emptyDashboard = $('emptyDashboard');
  if (emptyDashboard) emptyDashboard.classList.toggle('hidden', !!data.hasData);

  // 차트 렌더링 (미분류 제외)
  const charts = data.charts || { typeCounts: [], deptCounts: [], teamTop3: [] };
  const filteredTypes = (charts.typeCounts || []).filter(r => r.label !== '미분류');

  drawRankedBarChart('typeChart', 'type', filteredTypes, false);
  drawRankedBarChart('deptChart', 'dept', charts.deptCounts || [], true);
  drawRankedBarChart('teamChart', 'team', charts.teamTop3 || [], true);

  // 3개년 월별 추이
  drawTrendChart(data.yearlyTrend || []);

  // 반복사고 매장
  state.repeatRows = data.repeatStores || [];
  state.repeatPage = 1;
  renderRepeatList();
  renderRepeatFull();
}

/* ============ 차트: 순위별 색상 막대 ============ */

function drawRankedBarChart(canvasId, chartKey, rows, horizontal) {
  const canvas = $(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (state.charts[chartKey]) { state.charts[chartKey].destroy(); state.charts[chartKey] = null; }

  const labels = (rows || []).map(r => r.label);
  const counts = (rows || []).map(r => r.count);
  const colors = rankColors(labels.length);

  state.charts[chartKey] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '건수',
        data: counts,
        backgroundColor: colors,
        borderRadius: 6
      }]
    },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ' ' + c.raw + '건' } }
      },
      scales: {
        x: { ticks: { autoSkip: false, font: { size: 12 } } },
        y: { beginAtZero: true, ticks: { precision: 0, font: { size: 12 } } }
      },
      onClick: function(e, elements) {
        if (!elements || !elements.length) return;
        const idx = elements[0].index;
        openChartList(chartKey, labels[idx]);
      }
    }
  });
}

/* ============ 차트: 3개년 월별 추이 (라인) ============ */

function drawTrendChart(trendData) {
  const canvas = $('trendChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (state.charts.trend) { state.charts.trend.destroy(); state.charts.trend = null; }

  if (!trendData || !trendData.length) return;

  const monthLabels = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const lineColors = [CI_GRAY, CI_BLUE, CI_RED];  // 오래된 순 → 최신 순
  const lineWidths = [2, 2.5, 3.5];

  const datasets = trendData.map((item, i) => ({
    label: item.year + '년 (총 ' + item.total + '건)',
    data: item.months,
    borderColor: lineColors[i] || CI_GRAY,
    backgroundColor: lineColors[i] || CI_GRAY,
    borderWidth: lineWidths[i] || 2,
    pointRadius: 4,
    pointHoverRadius: 7,
    fill: false,
    tension: 0.3
  }));

  state.charts.trend = new Chart(ctx, {
    type: 'line',
    data: { labels: monthLabels, datasets: datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { font: { size: 13, weight: 'bold' }, padding: 20 }
        },
        tooltip: {
          callbacks: { label: c => ' ' + c.dataset.label.split(' ')[0] + ': ' + c.raw + '건' }
        }
      },
      scales: {
        x: { ticks: { font: { size: 12 } } },
        y: { beginAtZero: true, ticks: { precision: 0, font: { size: 12 } } }
      }
    }
  });
}

/* ============ 그래프 클릭 → 사고 리스트 팝업 ============ */

async function openChartList(chartType, label) {
  showLoading('사고 리스트를 불러오는 중입니다');
  try {
    const res = await callAPI({
      action: 'chartRecords', division: state.division,
      chartType, label, year: state.year, month: state.month
    });
    state.listRows = (res && res.rows) || [];
    state.listPage = 1;
    $('listModalTitle').textContent = (label || '') + ' 사고 리스트 (' + state.listRows.length + '건)';
    renderListModalPage();
    $('listModal').classList.remove('hidden');
  } catch (err) {
    alert('사고 리스트 조회 오류: ' + (err.message || err));
  } finally { hideLoading(); }
}
window.openChartList = openChartList;

function renderListModalPage() {
  const max = Math.max(1, Math.ceil(state.listRows.length / PAGE_SIZE_MODAL));
  if (state.listPage > max) state.listPage = max;
  const start = (state.listPage - 1) * PAGE_SIZE_MODAL;
  const pageRows = state.listRows.slice(start, start + PAGE_SIZE_MODAL);
  const listPageInfo = $('listPageInfo');
  if (listPageInfo) listPageInfo.textContent = state.listPage + ' / ' + max;
  const listModalBody = $('listModalBody');
  if (listModalBody) listModalBody.innerHTML = makeRecordTable(pageRows, true);
}

function makeRecordTable(rows, clickable) {
  if (!rows || !rows.length) return '<div class="empty-message">조회된 사고가 없습니다.</div>';
  let html = '<div class="table-wrap"><table><thead><tr>' +
    '<th>재해일자</th><th>영업부</th><th>팀</th><th>매장</th>' +
    '<th>재해유형</th><th>사고내용</th></tr></thead><tbody>';
  rows.forEach(r => {
    const click = clickable
      ? ' class="clickable" onclick="openDetail(\'' + escapeAttr(r.recordId) + '\')"' : '';
    html += '<tr' + click + '>' +
      '<td>' + esc(r.accidentDate) + '</td>' +
      '<td>' + esc(r.stdDept) + '</td>' +
      '<td>' + esc(r.stdTeam) + '</td>' +
      '<td>' + esc(r.store) + '</td>' +
      '<td>' + esc(r.accidentType) + '</td>' +
      '<td class="content-cell">' + esc(shorten(r.accidentContent, 90)) + '</td></tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

/* ============ 사고 상세 팝업 ============ */

async function openDetail(recordId) {
  showLoading('사고 상세를 불러오는 중입니다');
  try {
    const res = await callAPI({ action: 'detail', division: state.division, recordId });
    const d = res.detail;
    let html = '<dl class="detail-grid">';
    ['재해일자', '영업부', '팀', '매장명', '재해자명', '사번', '재해유형', '기인물'].forEach(k => {
      html += '<dt>' + k + '</dt><dd>' + esc(d[k]) + '</dd>';
    });
    html += '<dt>사고내용</dt><dd class="accident-content">' + esc(d['사고내용']) + '</dd></dl>';
    $('detailBody').innerHTML = html;
    $('detailModal').classList.remove('hidden');
  } catch (err) {
    alert('상세 조회 오류: ' + (err.message || err));
  } finally { hideLoading(); }
}
window.openDetail = openDetail;

function closeModals() {
  $('listModal').classList.add('hidden');
  $('detailModal').classList.add('hidden');
}

/* ============ 반복사고 매장 ============ */

function renderRepeatList() {
  const rows = state.repeatRows || [];
  const max = Math.max(1, Math.ceil(rows.length / PAGE_SIZE_REPEAT));
  if (state.repeatPage > max) state.repeatPage = max;
  const repeatPageInfo = $('repeatPageInfo');
  if (repeatPageInfo) repeatPageInfo.textContent = state.repeatPage + ' / ' + max;
  const start = (state.repeatPage - 1) * PAGE_SIZE_REPEAT;
  const page = rows.slice(start, start + PAGE_SIZE_REPEAT);
  const repeatList = $('repeatList');
  if (repeatList) {
    if (!page.length) {
      repeatList.innerHTML = '<div class="empty-message">최근 1년 반복사고 매장이 없습니다.</div>';
      return;
    }
    repeatList.innerHTML = page.map(r =>
      '<div class="repeat-item" onclick="openChartList(\'store\',\'' + escapeAttr(r.store) + '\')">' +
        '<div><strong>' + esc(r.store) + '</strong><br>' +
        '<small>' + esc(r.dept) + ' / ' + esc(r.team) + ' / 주요유형: ' + esc(r.topType) + '</small></div>' +
        '<div>' + r.count + '건</div>' +
        '<div>' + esc(r.recentDate) + '</div></div>'
    ).join('');
  }
}

function renderRepeatFull() {
  const rows = state.repeatRows || [];
  if (!rows.length) {
    $('repeatFullList').innerHTML = '<div class="empty-message">최근 1년 반복사고 매장이 없습니다.</div>';
    return;
  }
  let html = '<table><thead><tr>' +
    '<th>순위</th><th>매장명</th><th>건수</th><th>주요유형</th>' +
    '<th>최근사고일</th><th>영업부</th><th>팀</th></tr></thead><tbody>';
  rows.forEach((r, i) => {
    html += '<tr class="clickable" onclick="openChartList(\'store\',\'' + escapeAttr(r.store) + '\')">' +
      '<td>' + (i + 1) + '</td><td>' + esc(r.store) + '</td><td>' + r.count + '</td>' +
      '<td>' + esc(r.topType) + '</td><td>' + esc(r.recentDate) + '</td>' +
      '<td>' + esc(r.dept) + '</td><td>' + esc(r.team) + '</td></tr>';
  });
  html += '</tbody></table>';
  $('repeatFullList').innerHTML = html;
}

/* ============ 페이지 전환 ============ */

function switchView(view) {
  state.currentView = view;
  document.querySelectorAll('.nav[data-view]').forEach(b =>
    b.classList.toggle('active', b.dataset.view === view)
  );
  $('dashboardPage').classList.toggle('hidden', view !== 'dashboard');
  $('dataPage').classList.toggle('hidden', view !== 'data');
  $('repeatPage').classList.toggle('hidden', view !== 'repeat');
  if (view === 'data') loadDataTable();
  if (view === 'repeat') renderRepeatFull();
}

/* ============ 데이터 조회 ============ */

async function updateCascade(level) {
  const f = {
    year: $('dataYear').value, month: $('dataMonth').value,
    dept: $('filterDept').value, team: $('filterTeam').value
  };
  const res = await callAPI({ action: 'filterOptions', division: state.division, filters: JSON.stringify(f) });
  if (!level) {
    fillSelectWithAll($('filterDept'), res.departments);
    fillSelectWithAll($('filterTeam'), res.teams);
    fillSelectWithAll($('filterStore'), res.stores);
    fillSelectWithAll($('filterType'), res.accidentTypes);
    return;
  }
  if (level === 'dept') { fillSelectWithAll($('filterTeam'), res.teams); fillSelectWithAll($('filterStore'), res.stores); }
  if (level === 'team') { fillSelectWithAll($('filterStore'), res.stores); }
}

async function loadDataTable() {
  showLoading('데이터 조회 중입니다');
  try {
    const f = {
      year: $('dataYear').value, month: $('dataMonth').value,
      dept: $('filterDept').value, team: $('filterTeam').value,
      store: $('filterStore').value, type: $('filterType').value,
      storeSearch: $('filterStoreSearch').value
    };
    const res = await callAPI({ action: 'query', division: state.division, filters: JSON.stringify(f) });
    $('dataResult').innerHTML = '<p><b>조회 결과: ' + (res.total || 0) + '건</b></p>' +
      makeRecordTable(res.rows || [], true);
  } catch (err) {
    alert('데이터 조회 오류: ' + (err.message || err));
  } finally { hideLoading(); }
}
