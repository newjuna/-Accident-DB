/* ============================================================
 *  산업재해 현황 분석 대시보드 v4.0 — 클라이언트
 *
 *  ■ Apps Script 배포 URL을 아래 API_URL에 붙여넣으세요.
 *  ■ google.script.run 대신 fetch()로 API 호출
 * ============================================================ */

// ★★★ 여기에 Apps Script 배포 URL을 붙여넣으세요 ★★★
const API_URL = 'https://script.google.com/macros/s/AKfycbxMAPXygmi8TKEoHO09LYI8LZbS5PY_wodfmheb3_QMCjBYDRZ7BNfP3gt79KpS4jUhvg/exec';

/* ============ 상태 관리 ============ */

const state = {
  division: null,
  year: null,
  month: '전체',
  charts: { type: null, dept: null, team: null },
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
  $('loadingOverlay').classList.remove('hidden');
  if (msg) document.querySelector('.loader-title').textContent = msg;
}

function hideLoading() {
  $('loadingOverlay').classList.add('hidden');
}

/**
 * Apps Script API 호출
 * @param {Object} params - 쿼리 파라미터 객체 { action, division, year, ... }
 * @returns {Promise<Object>} JSON 응답
 */
async function callAPI(params) {
  const query = new URLSearchParams(params).toString();
  const url = API_URL + '?' + query;

  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error('서버 응답 오류: HTTP ' + response.status);
  }
  const data = await response.json();
  if (data && data.ok === false && data.message) {
    throw new Error(data.message);
  }
  return data;
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"]/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])
  );
}

function escapeAttr(v) {
  return esc(v).replace(/'/g, '&#39;');
}

function shorten(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function formatDiff(n) {
  n = Number(n || 0);
  if (n > 0) return '▲ ' + n + '건';
  if (n < 0) return '▼ ' + Math.abs(n) + '건';
  return '0건';
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
    op.value = v;
    op.textContent = v;
    if (String(v) === String(selected)) op.selected = true;
    sel.appendChild(op);
  });
}

function fillSelectWithAll(sel, arr) {
  const cur = sel.value;
  sel.innerHTML = '<option value="전체">전체</option>';
  (arr || []).forEach(v => {
    const op = document.createElement('option');
    op.value = v;
    op.textContent = v;
    sel.appendChild(op);
  });
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
}

/* ============ 이벤트 바인딩 ============ */

window.addEventListener('load', () => {
  // 로그인
  $('loginBtn').addEventListener('click', login);
  $('loginPassword').addEventListener('keydown', e => {
    if (e.key === 'Enter') login();
  });

  // 로그아웃
  $('logoutBtn').addEventListener('click', () => location.reload());

  // 대시보드 조회
  $('dashSearchBtn').addEventListener('click', loadDashboard);

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
  document.querySelectorAll('.modalClose').forEach(btn =>
    btn.addEventListener('click', closeModals)
  );

  // 네비게이션
  document.querySelectorAll('.nav[data-view]').forEach(btn =>
    btn.addEventListener('click', () => switchView(btn.dataset.view))
  );
});

/* ============ 로그인 ============ */

async function login() {
  const division = $('loginDivision').value;
  const password = $('loginPassword').value;
  $('loginError').textContent = '';
  showLoading('로그인 확인 중입니다');

  try {
    const res = await callAPI({ action: 'login', division, password });
    state.division = res.division;
    $('sideDivision').textContent = state.division;
    $('loginView').classList.add('hidden');
    $('appView').classList.remove('hidden');
    await initAfterLogin();
  } catch (err) {
    $('loginError').textContent = err.message || String(err);
  } finally {
    hideLoading();
  }
}

/* ============ 로그인 후 초기화 ============ */

async function initAfterLogin() {
  showLoading('초기 데이터를 불러오는 중입니다');

  const init = await callAPI({ action: 'init', division: state.division });

  const years = init.years && init.years.length
    ? init.years
    : [String(new Date().getFullYear())];

  const months = ['전체', '1월', '2월', '3월', '4월', '5월', '6월',
                  '7월', '8월', '9월', '10월', '11월', '12월'];

  // 대시보드 필터 초기화
  fillSelect($('dashYear'), years, init.defaultYear);
  fillSelect($('dashMonth'), months, '전체');

  // 데이터 조회 필터 초기화 (독립)
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
  const k = data.kpi || {
    total: 0, yoyDiff: 0, yoyBase: 0,
    prevDiff: null, prevBase: null,
    topType: '-', topTypeCount: 0
  };

  // 총 재해 건수
  $('kpiTotal').textContent = (k.total || 0) + '건';

  // 전년 동월 대비
  const yoyEl = $('kpiYoy');
  yoyEl.textContent = formatDiff(k.yoyDiff);
  yoyEl.className = getDiffClass(k.yoyDiff);
  $('kpiYoyBase').textContent = '전년 기준 ' + (k.yoyBase || 0) + '건';

  // 전월 대비
  const prevEl = $('kpiPrev');
  if (k.prevDiff === null) {
    prevEl.textContent = '-';
    prevEl.className = '';
    $('kpiPrevBase').textContent = '전체 선택 시 제외';
  } else {
    prevEl.textContent = formatDiff(k.prevDiff);
    prevEl.className = getDiffClass(k.prevDiff);
    $('kpiPrevBase').textContent = '전월 기준 ' + (k.prevBase || 0) + '건';
  }

  // 최다 재해유형
  $('kpiTopType').textContent = k.topType || '-';
  $('kpiTopTypeCount').textContent = (k.topTypeCount || 0) + '건';

  // 빈 데이터 메시지
  $('emptyDashboard').classList.toggle('hidden', !!data.hasData);

  // 차트 렌더링
  const charts = data.charts || { typeCounts: [], deptCounts: [], teamTop3: [] };
  drawBarChart('typeChart', 'type', charts.typeCounts, false);
  drawBarChart('deptChart', 'dept', charts.deptCounts, true);
  drawBarChart('teamChart', 'team', charts.teamTop3, true);

  // 반복사고 매장
  state.repeatRows = data.repeatStores || [];
  state.repeatPage = 1;
  renderRepeatList();
  renderRepeatFull();
}

/* ============ 차트 (버그 수정 완료) ============ */

function drawBarChart(canvasId, chartKey, rows, horizontal) {
  const ctx = $(canvasId).getContext('2d');

  // 기존 차트 파괴
  if (state.charts[chartKey]) {
    state.charts[chartKey].destroy();
    state.charts[chartKey] = null;
  }

  const labels = (rows || []).map(r => r.label);
  const counts = (rows || []).map(r => r.count);

  state.charts[chartKey] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '건수',
        data: counts,
        backgroundColor: '#002B6D',
        borderRadius: 6
      }]
    },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(c) { return ' ' + c.raw + '건'; }
          }
        }
      },
      scales: {
        x: {
          ticks: { autoSkip: false, font: { size: 12 } }
        },
        y: {
          beginAtZero: true,
          ticks: { precision: 0, font: { size: 12 } }
        }
      },
      // ★ onClick은 options 레벨에 위치해야 함 (scales 안이 아님!)
      onClick: function(e, elements) {
        if (!elements || !elements.length) return;
        var idx = elements[0].index;
        openChartList(chartKey, labels[idx]);
      }
    }
  });
}

/* ============ 그래프 클릭 → 사고 리스트 팝업 ============ */

async function openChartList(chartType, label) {
  showLoading('사고 리스트를 불러오는 중입니다');
  try {
    const res = await callAPI({
      action: 'chartRecords',
      division: state.division,
      chartType: chartType,
      label: label,
      year: state.year,
      month: state.month
    });
    state.listRows = (res && res.rows) || [];
    state.listPage = 1;
    $('listModalTitle').textContent =
      (label || '') + ' 사고 리스트 (' + state.listRows.length + '건)';
    renderListModalPage();
    $('listModal').classList.remove('hidden');
  } catch (err) {
    alert('사고 리스트 조회 오류: ' + (err.message || err));
  } finally {
    hideLoading();
  }
}

// 전역 함수로 노출 (onclick 속성에서 호출)
window.openChartList = openChartList;

function renderListModalPage() {
  const max = Math.max(1, Math.ceil(state.listRows.length / PAGE_SIZE_MODAL));
  if (state.listPage > max) state.listPage = max;
  const start = (state.listPage - 1) * PAGE_SIZE_MODAL;
  const pageRows = state.listRows.slice(start, start + PAGE_SIZE_MODAL);
  $('listPageInfo').textContent = state.listPage + ' / ' + max;
  $('listModalBody').innerHTML = makeRecordTable(pageRows, true);
}

function makeRecordTable(rows, clickable) {
  if (!rows || !rows.length) {
    return '<div class="empty-message">조회된 사고가 없습니다.</div>';
  }

  let html = '<div class="table-wrap"><table><thead><tr>' +
    '<th>재해일자</th><th>영업부</th><th>팀</th><th>매장</th>' +
    '<th>재해유형</th><th>사고내용</th></tr></thead><tbody>';

  rows.forEach(r => {
    const click = clickable
      ? ' class="clickable" onclick="openDetail(\'' + escapeAttr(r.recordId) + '\')"'
      : '';
    html += '<tr' + click + '>' +
      '<td>' + esc(r.accidentDate) + '</td>' +
      '<td>' + esc(r.stdDept) + '</td>' +
      '<td>' + esc(r.stdTeam) + '</td>' +
      '<td>' + esc(r.store) + '</td>' +
      '<td>' + esc(r.accidentType) + '</td>' +
      '<td class="content-cell">' + esc(shorten(r.accidentContent, 90)) + '</td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  return html;
}

/* ============ 사고 상세 팝업 ============ */

async function openDetail(recordId) {
  showLoading('사고 상세를 불러오는 중입니다');
  try {
    const res = await callAPI({
      action: 'detail',
      division: state.division,
      recordId: recordId
    });
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
  } finally {
    hideLoading();
  }
}

// 전역 함수로 노출
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

  $('repeatPageInfo').textContent = state.repeatPage + ' / ' + max;
  const start = (state.repeatPage - 1) * PAGE_SIZE_REPEAT;
  const page = rows.slice(start, start + PAGE_SIZE_REPEAT);

  if (!page.length) {
    $('repeatList').innerHTML = '<div class="empty-message">최근 1년 반복사고 매장이 없습니다.</div>';
    return;
  }

  $('repeatList').innerHTML = page.map(r =>
    '<div class="repeat-item" onclick="openChartList(\'store\',\'' + escapeAttr(r.store) + '\')">' +
      '<div><strong>' + esc(r.store) + '</strong><br>' +
      '<small>' + esc(r.dept) + ' / ' + esc(r.team) + ' / 주요유형: ' + esc(r.topType) + '</small></div>' +
      '<div>' + r.count + '건</div>' +
      '<div>' + esc(r.recentDate) + '</div>' +
    '</div>'
  ).join('');
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
      '<td>' + (i + 1) + '</td>' +
      '<td>' + esc(r.store) + '</td>' +
      '<td>' + r.count + '</td>' +
      '<td>' + esc(r.topType) + '</td>' +
      '<td>' + esc(r.recentDate) + '</td>' +
      '<td>' + esc(r.dept) + '</td>' +
      '<td>' + esc(r.team) + '</td></tr>';
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

/* ============ 데이터 조회 (독립 필터) ============ */

async function updateCascade(level) {
  const f = {
    year: $('dataYear').value,
    month: $('dataMonth').value,
    dept: $('filterDept').value,
    team: $('filterTeam').value
  };

  const res = await callAPI({
    action: 'filterOptions',
    division: state.division,
    filters: JSON.stringify(f)
  });

  if (!level) {
    fillSelectWithAll($('filterDept'), res.departments);
    fillSelectWithAll($('filterTeam'), res.teams);
    fillSelectWithAll($('filterStore'), res.stores);
    fillSelectWithAll($('filterType'), res.accidentTypes);
    return;
  }
  if (level === 'dept') {
    fillSelectWithAll($('filterTeam'), res.teams);
    fillSelectWithAll($('filterStore'), res.stores);
  }
  if (level === 'team') {
    fillSelectWithAll($('filterStore'), res.stores);
  }
}

async function loadDataTable() {
  showLoading('데이터 조회 중입니다');
  try {
    const f = {
      year: $('dataYear').value,
      month: $('dataMonth').value,
      dept: $('filterDept').value,
      team: $('filterTeam').value,
      store: $('filterStore').value,
      type: $('filterType').value,
      storeSearch: $('filterStoreSearch').value
    };

    const res = await callAPI({
      action: 'query',
      division: state.division,
      filters: JSON.stringify(f)
    });

    $('dataResult').innerHTML =
      '<p><b>조회 결과: ' + (res.total || 0) + '건</b></p>' +
      makeRecordTable(res.rows || [], true);
  } catch (err) {
    alert('데이터 조회 오류: ' + (err.message || err));
  } finally {
    hideLoading();
  }
}
