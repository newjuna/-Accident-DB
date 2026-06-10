/* ============================================================
 *  산업재해 현황 분석 대시보드 v6.0 — 클라이언트
 *
 *  ■ Apps Script 배포 URL을 아래 API_URL에 붙여넣으세요.
 *  ■ 변경사항 v6.0:
 *    - 기준연도에 '전체' 옵션 신설 및 누적 렌더링 지원
 *    - 서브헤더 설명 문구 제거
 *    - 연도별 전년대비 증감 예외 처리:
 *      * 최하단 연도(예: 2024년): '전년 데이터 없음' 표기 및 단일 막대 차트 처리
 *      * 현재 연도(예: 2026년): 초록색(#00B050)으로 '전년대비 집계중' 표기
 *      * '전체' 연도: '누적 집계 / 전체 연도 총합' 표기 및 단일 막대 차트 처리
 *    - 대시보드 상단 'PPT 캡처 모드' 버튼 추가 및 16:9 비율 캡처 팝업 모달 제공
 *    - 모달 팝업(사고 리스트, 상세 내용) 렌더링 시 전체 로딩 오버레이 생략으로 반응 속도 극대화
 *    - 모달 팝업 내부 데이터 테이블 글귀 색상을 완전한 검정색(#000000)으로 강제 적용
 * ============================================================ */

// ★★★ 여기에 Apps Script 배포 URL을 붙여넣으세요 ★★★
const API_URL = 'https://script.google.com/macros/s/AKfycbwYyY7iT3k_X7jJ7q3q3_X7jJ7q3_X7jJ7q3_X7j/exec'; 

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
  captureCharts: { type: null, dept: null }, // PPT 캡처 전용 차트 객체
  repeatRows: [],
  repeatPage: 1,
  listRows: [],
  listPage: 1,
  
  // 데이터 조회 전용 상태
  dataRows: [],
  dataPage: 1,
  
  // 연도 비교 예외용 상태
  minYear: null,
  currentYear: String(new Date().getFullYear()),
  
  // 캡처용 최신 백업 데이터
  lastDashboardData: null,

  currentView: 'dashboard'
};

const PAGE_SIZE_MODAL = 5;
const PAGE_SIZE_REPEAT = 5;
const PAGE_SIZE_DATA = 10; 

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
  if (n > 0) return '▲ ' + n + '건 상승';
  if (n < 0) return '▼ ' + Math.abs(n) + '건 하락';
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

function rankColors(count) {
  const colors = [];
  for (let i = 0; i < count; i++) {
    if (i === 0)      colors.push(CI_RED);
    else if (i === 1) colors.push(CI_BLUE);
    else              colors.push(CI_GRAY);
  }
  return colors;
}

function cleanDeptName(name) {
  return String(name || '').replace(/영업부/g, '').trim();
}

/* ============ 이벤트 바인딩 ============ */
window.addEventListener('load', () => {
  // 로그인
  $('loginBtn').addEventListener('click', login);
  $('loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });

  // 로그아웃
  $('logoutBtn').addEventListener('click', () => location.reload());

  // 대시보드 드롭다운 변경 시 자동 조회
  $('dashYear').addEventListener('change', loadDashboard);
  $('dashMonth').addEventListener('change', loadDashboard);

  // PPT 캡처 모드 실행/종료
  $('pptCaptureBtn').addEventListener('click', openCaptureMode);
  $('captureCloseBtn').addEventListener('click', closeCaptureMode);

  // 데이터 조회 필터링 및 조작
  $('dataSearchBtn').addEventListener('click', loadDataTable);
  $('filterResetBtn').addEventListener('click', resetFilters);
  $('filterDept').addEventListener('change', () => updateCascade('dept'));
  $('filterTeam').addEventListener('change', () => updateCascade('team'));

  // 데이터 조회 페이지네이션
  $('dataPrev').addEventListener('click', () => {
    if (state.dataPage > 1) { state.dataPage--; renderDataTablePage(); }
  });
  $('dataNext').addEventListener('click', () => {
    const max = Math.max(1, Math.ceil(state.dataRows.length / PAGE_SIZE_DATA));
    if (state.dataPage < max) { state.dataPage++; renderDataTablePage(); }
  });

  // 반복사고 페이지네이션 (미니 목록용)
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

  const years = init.years && init.years.length ? init.years : ['전체', String(new Date().getFullYear())];
  const months = ['전체', '1월', '2월', '3월', '4월', '5월', '6월',
                  '7월', '8월', '9월', '10월', '11월', '12월'];

  fillSelect($('dashYear'), years, init.defaultYear);
  fillSelect($('dashMonth'), months, '전체');
  
  // 데이터 조회 전용 필터 연도 셋업 ('전체' 제외하고 숫자로만 구성)
  const numericYears = years.filter(y => y !== '전체');
  fillSelect($('dataYear'), numericYears, init.defaultYear);
  fillSelect($('dataMonth'), months, '전체');

  state.year = $('dashYear').value;
  state.month = $('dashMonth').value;
  
  // 최하단 연도(가장 오래된 연도) 파악
  if (numericYears.length > 0) {
    state.minYear = numericYears[numericYears.length - 1];
  }

  await updateCascade();
  await loadDashboard();
}

/* ============ 대시보드 불러오기 ============ */
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
    state.lastDashboardData = data; // 캡처용 원본 데이터 복사본 보존
    renderDashboard(data || {});
  } catch (err) {
    alert('대시보드 조회 오류: ' + (err.message || err));
  } finally {
    hideLoading();
  }
}

function renderDashboard(data) {
  const k = data.kpi || { total: 0, yoyDiff: 0, yoyBase: 0, topType: '-', topTypeCount: 0 };

  // 1. 총 재해 건수 + 전년 대비 (연도 필터별 상세 예외 분기)
  const kpiTotal = $('kpiTotal');
  if (kpiTotal) kpiTotal.textContent = (k.total || 0) + '건';

  const yoyEl = $('kpiYoy');
  const kpiYoySub = $('kpiYoySub');

  if (state.year === '전체') {
    if (yoyEl) {
      yoyEl.textContent = '누적 집계';
      yoyEl.className = 'kpi-yoy-val kpi-zero';
    }
    if (kpiYoySub) {
      kpiYoySub.textContent = '전체 연도 총합';
    }
  } else if (state.year === state.minYear) {
    if (yoyEl) {
      yoyEl.textContent = '-';
      yoyEl.className = 'kpi-yoy-val kpi-zero';
    }
    if (kpiYoySub) {
      kpiYoySub.textContent = '전년 데이터 없음';
    }
  } else if (state.year === state.currentYear) {
    if (yoyEl) {
      yoyEl.textContent = '전년대비 집계중';
      yoyEl.className = 'kpi-yoy-val kpi-counting'; // 녹색 (#00B050)
    }
    if (kpiYoySub) {
      kpiYoySub.textContent = '전년 ' + (k.yoyBase || 0) + '건';
    }
  } else {
    if (yoyEl) {
      yoyEl.textContent = formatDiff(k.yoyDiff);
      yoyEl.className = 'kpi-yoy-val ' + getDiffClass(k.yoyDiff);
    }
    if (kpiYoySub) {
      kpiYoySub.textContent = '전년 ' + (k.yoyBase || 0) + '건';
    }
  }

  // 2. 영업부별 재해 TOP 3 리스트 렌더링
  const charts = data.charts || { typeCounts: [], typeCountsYoy: [], deptCounts: [], deptCountsYoy: [], teamCounts: [], teamCountsYoy: [] };
  const kpiTopDeptList = $('kpiTopDeptList');
  if (kpiTopDeptList) {
    const topDepts = (charts.deptCounts || []).slice(0, 3);
    if (topDepts.length > 0) {
      kpiTopDeptList.innerHTML = topDepts.map((d, i) => `
        <div class="kpi-top-item">
          <span class="top-rank">${i+1}위</span>
          <span class="top-name">${esc(cleanDeptName(d.label))}</span>
          <span class="top-count">${d.count}건</span>
        </div>
      `).join('');
    } else {
      kpiTopDeptList.innerHTML = '<div class="empty-message">데이터 없음</div>';
    }
  }

  // 3. 재해유형 TOP 3 리스트 렌더링
  const kpiTopTypeList = $('kpiTopTypeList');
  if (kpiTopTypeList) {
    const filteredTypes = (charts.typeCounts || []).filter(r => r.label !== '미분류').slice(0, 3);
    if (filteredTypes.length > 0) {
      kpiTopTypeList.innerHTML = filteredTypes.map((t, i) => `
        <div class="kpi-top-item">
          <span class="top-rank">${i+1}위</span>
          <span class="top-name">${esc(t.label)}</span>
          <span class="top-count">${t.count}건</span>
        </div>
      `).join('');
    } else {
      kpiTopTypeList.innerHTML = '<div class="empty-message">데이터 없음</div>';
    }
  }

  // 빈 데이터 메시지
  const emptyDashboard = $('emptyDashboard');
  if (emptyDashboard) emptyDashboard.classList.toggle('hidden', !!data.hasData);

  // 차트 렌더링 (미분류 제외, 상위 5개 TOP 5 제한, 금년 vs 전년 비교)
  const filteredTypes = (charts.typeCounts || []).filter(r => r.label !== '미분류').slice(0, 5);
  const filteredTypesYoy = charts.typeCountsYoy || [];
  drawRankedBarChart('typeChart', 'type', filteredTypes, filteredTypesYoy, false);

  const filteredDepts = (charts.deptCounts || []).slice(0, 5);
  const filteredDeptsYoy = charts.deptCountsYoy || [];
  drawRankedBarChart('deptChart', 'dept', filteredDepts, filteredDeptsYoy, true);

  const filteredTeams = (charts.teamCounts || []).slice(0, 5);
  const filteredTeamsYoy = charts.teamCountsYoy || [];
  drawRankedBarChart('teamChart', 'team', filteredTeams, filteredTeamsYoy, true);

  // 3개년 월별 추이 (라인 차트)
  drawTrendChart(data.yearlyTrend || []);

  // 반복사고 데이터 바인딩
  state.repeatRows = data.repeatStores || [];
  state.repeatPage = 1;
  renderRepeatList();
  renderRepeatFull();
  renderRegionMap();
}

/* ============ 차트: 금년 vs 전년 이중 막대 그래프 (Y축/그리드 제거, 라벨 상시) ============ */
function drawRankedBarChart(canvasId, chartKey, rows, yoyRows, horizontal) {
  const canvas = $(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (state.charts[chartKey]) { state.charts[chartKey].destroy(); state.charts[chartKey] = null; }

  // 1. 레이블 가공 ('영업부' 명칭 제거)
  const labels = (rows || []).map(r => cleanDeptName(r.label));
  const curCounts = (rows || []).map(r => r.count);
  
  // 2. 단일 막대(전년도 비교 없음) 조건 설정: '전체' 연도 및 '최초' 연도
  const isSingleBar = (state.year === '전체' || state.year === state.minYear);

  let datasets = [];
  if (isSingleBar) {
    // 단일 막대 렌더링
    datasets = [
      {
        label: '재해건수',
        data: curCounts,
        backgroundColor: rankColors(labels.length),
        borderRadius: 4
      }
    ];
  } else {
    // 금년 vs 전년 이중 막대 렌더링
    const yoyMap = {};
    (yoyRows || []).forEach(r => {
      yoyMap[cleanDeptName(r.label)] = r.count;
    });
    const yoyCounts = (rows || []).map(r => yoyMap[cleanDeptName(r.label)] || 0);
    
    datasets = [
      {
        label: '금년',
        data: curCounts,
        backgroundColor: rankColors(labels.length),
        borderRadius: 4
      },
      {
        label: '전년',
        data: yoyCounts,
        backgroundColor: labels.map(() => '#cbd5e1'), // 전년도는 연회색 고정
        borderRadius: 4
      }
    ];
  }

  state.charts[chartKey] = new Chart(ctx, {
    type: 'bar',
    data: { labels: labels, datasets: datasets },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: !isSingleBar, position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: c => ` ${c.dataset.label}: ${c.raw}건`
          }
        },
        datalabels: {
          anchor: 'end',
          align: 'end',
          offset: -2,
          font: { weight: 'bold', size: 10 },
          formatter: function(value, context) {
            if (!isSingleBar && context.datasetIndex === 0) { // 금년 막대 증감 텍스트 추가
              const curVal = value;
              const yoyVal = context.chart.data.datasets[1].data[context.dataIndex] || 0;
              const diff = curVal - yoyVal;
              let diffText = '';
              if (diff > 0) diffText = ` (+${diff})`;
              else if (diff < 0) diffText = ` (${diff})`;
              return `${curVal}건${diffText}`;
            }
            return `${value}건`;
          },
          color: function(context) {
            return (isSingleBar || context.datasetIndex === 0) ? '#0f172a' : '#64748b';
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { autoSkip: false, font: { size: 11, weight: 'bold' } }
        },
        y: {
          display: false, // Y축 격자 및 스케일 완전 제거
          grid: { display: false },
          beginAtZero: true
        }
      },
      onClick: function(e, elements) {
        if (!elements || !elements.length) return;
        const idx = elements[0].index;
        const originalLabel = rows[idx].label;
        openChartList(chartKey, originalLabel);
      }
    },
    plugins: [ChartDataLabels]
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
        },
        datalabels: { display: false }
      },
      scales: {
        x: { ticks: { font: { size: 12 } } },
        y: { beginAtZero: true, ticks: { precision: 0, font: { size: 12 } } }
      }
    }
  });
}

/* ============ 그래프 클릭 → 사고 리스트 팝업 (로딩 오버레이 비활성화) ============ */
async function openChartList(chartType, label) {
  // 모달을 로딩 딜레이 없이 쾌속 렌더링하기 위해 showLoading 생략
  try {
    const res = await callAPI({
      action: 'chartRecords', division: state.division,
      chartType, label, year: state.year, month: state.month
    });
    state.listRows = (res && res.rows) || [];
    state.listPage = 1;
    $('listModalTitle').textContent = cleanDeptName(label || '') + ' 사고 리스트 (' + state.listRows.length + '건)';
    renderListModalPage();
    $('listModal').classList.remove('hidden');
  } catch (err) {
    alert('사고 리스트 조회 오류: ' + (err.message || err));
  }
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
      '<td>' + esc(cleanDeptName(r.stdDept)) + '</td>' +
      '<td>' + esc(r.stdTeam) + '</td>' +
      '<td>' + esc(r.store) + '</td>' +
      '<td>' + esc(r.accidentType) + '</td>' +
      '<td class="content-cell" style="color: #000000 !important;">' + esc(shorten(r.accidentContent, 90)) + '</td></tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

/* ============ 사고 상세 팝업 (로딩 오버레이 비활성화) ============ */
async function openDetail(recordId) {
  try {
    const res = await callAPI({ action: 'detail', division: state.division, recordId });
    const d = res.detail;
    let html = '<dl class="detail-grid">';
    ['재해일자', '영업부', '팀', '매장명', '재해자명', '사번', '재해유형', '기인물'].forEach(k => {
      let val = d[k];
      if (k === '영업부') val = cleanDeptName(val);
      html += '<dt>' + k + '</dt><dd style="color: #000000 !important;">' + esc(val) + '</dd>';
    });
    html += '<dt>사고내용</dt><dd class="accident-content">' + esc(d['사고내용']) + '</dd></dl>';
    $('detailBody').innerHTML = html;
    $('detailModal').classList.remove('hidden');
  } catch (err) {
    alert('상세 조회 오류: ' + (err.message || err));
  }
}
window.openDetail = openDetail;

function closeModals() {
  $('listModal').classList.add('hidden');
  $('detailModal').classList.add('hidden');
}

/* ============ 대시보드 미니 목록: 최근 1년 반복사고 매장 ============ */
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
        '<small>' + esc(cleanDeptName(r.dept)) + ' / ' + esc(r.team) + ' / 주요유형: ' + esc(r.topType) + '</small></div>' +
        '<div style="font-weight:900; color:var(--red); display:flex; align-items:center; justify-content:flex-end;">' + r.count + '건</div></div>'
    ).join('');
  }
}

/* ============ 반복사고 매장 전체 리스트 렌더링 ============ */
function renderRepeatFull() {
  const rows = state.repeatRows || [];
  const repeatFullList = $('repeatFullList');
  if (!repeatFullList) return;
  if (!rows.length) {
    repeatFullList.innerHTML = '<div class="empty-message">최근 1년 반복사고 매장이 없습니다.</div>';
    return;
  }
  let html = '<table><thead><tr>' +
    '<th>순위</th><th>매장명</th><th>건수</th><th>주요유형</th>' +
    '<th>최근사고일</th><th>영업부</th><th>팀</th></tr></thead><tbody>';
  rows.forEach((r, i) => {
    html += '<tr class="clickable" onclick="openChartList(\'store\',\'' + escapeAttr(r.store) + '\')">' +
      '<td>' + (i + 1) + '</td><td>' + esc(r.store) + '</td><td style="color:var(--red); font-weight:bold;">' + r.count + '</td>' +
      '<td>' + esc(r.topType) + '</td><td>' + esc(r.recentDate) + '</td>' +
      '<td>' + esc(cleanDeptName(r.dept)) + '</td><td>' + esc(r.team) + '</td></tr>';
  });
  html += '</tbody></table>';
  repeatFullList.innerHTML = html;
}

/* ============ 반복사고 매장: 영업부별 가상 지역 맵 (Grid Map) ============ */
function renderRegionMap() {
  const container = $('visualRegionMap');
  if (!container) return;

  let standardDepts = [];
  if (state.division === '수도권영업부문') {
    standardDepts = ['인천영업부', '강북영업부', '강남/구리영업부', '수원/용인영업부', '관악/평택/안산영업부', '강원영업부'];
  } else {
    standardDepts = ['충청영업부', '호남영업부', '경북영업부', '경남영업부'];
  }

  const deptSummary = {};
  standardDepts.forEach(d => { deptSummary[d] = 0; });
  (state.repeatRows || []).forEach(r => {
    if (deptSummary[r.dept] !== undefined) {
      deptSummary[r.dept] += Number(r.count || 0);
    }
  });

  container.innerHTML = standardDepts.map(d => {
    const count = deptSummary[d] || 0;
    let hotspotClass = 'hotspot-safe';
    let statusText = '안전';

    if (count >= 4) {
      hotspotClass = 'hotspot-red';
      statusText = '위험';
    } else if (count === 3) {
      hotspotClass = 'hotspot-blue';
      statusText = '주의';
    } else if (count === 2) {
      hotspotClass = 'hotspot-gray';
      statusText = '보통';
    }

    const shortName = cleanDeptName(d);

    return `
      <div class="region-card ${hotspotClass}" onclick="openChartList('dept', '${escapeAttr(d)}')">
        <span class="region-name">${esc(shortName)}</span>
        <span class="region-badge">${count}건 (${statusText})</span>
      </div>
    `;
  }).join('');
}

/* ============ 페이지 전환 (로딩창 노출 최적화) ============ */
function switchView(view) {
  state.currentView = view;
  document.querySelectorAll('.nav[data-view]').forEach(b =>
    b.classList.toggle('active', b.dataset.view === view)
  );
  $('dashboardPage').classList.toggle('hidden', view !== 'dashboard');
  $('dataPage').classList.toggle('hidden', view !== 'data');
  $('repeatPage').classList.toggle('hidden', view !== 'repeat');
  
  if (view === 'data') {
    renderDataTablePage();
  }
  if (view === 'repeat') {
    renderRepeatFull();
    renderRegionMap();
  }
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
    state.dataRows = res.rows || [];
    state.dataPage = 1;
    renderDataTablePage();
  } catch (err) {
    alert('데이터 조회 오류: ' + (err.message || err));
  } finally { hideLoading(); }
}

async function resetFilters() {
  $('dataYear').value = (state.year !== '전체' ? state.year : (state.minYear || '2024'));
  $('dataMonth').value = '전체';
  $('filterStoreSearch').value = '';
  await updateCascade();
  await loadDataTable();
}

function renderDataTablePage() {
  const max = Math.max(1, Math.ceil(state.dataRows.length / PAGE_SIZE_DATA));
  if (state.dataPage > max) state.dataPage = max;
  const start = (state.dataPage - 1) * PAGE_SIZE_DATA;
  const pageRows = state.dataRows.slice(start, start + PAGE_SIZE_DATA);
  
  const pager = $('dataPager');
  if (pager) {
    pager.classList.toggle('hidden', state.dataRows.length <= PAGE_SIZE_DATA);
  }
  const pageInfo = $('dataPageInfo');
  if (pageInfo) pageInfo.textContent = state.dataPage + ' / ' + max;
  
  const resultContainer = $('dataResult');
  if (resultContainer) {
    resultContainer.innerHTML = `<p><b>조회 결과: ${state.dataRows.length}건</b> (현재 페이지: ${pageRows.length}건)</p>` +
      makeRecordTable(pageRows, true);
  }
}

/* ============ PPT 캡처 전용 모달 동작 ============ */
function openCaptureMode() {
  const modal = $('captureModal');
  const body = $('captureBody');
  if (!modal || !body) return;

  const data = state.lastDashboardData;
  if (!data) {
    alert('대시보드 데이터를 먼저 조회하세요.');
    return;
  }

  // 1. 모달 노출
  modal.classList.remove('hidden');

  // 2. 16:9 비율 PPT 보드 내부에 대시보드 컴포넌트 렌더링
  const k = data.kpi || { total: 0, yoyDiff: 0, yoyBase: 0 };
  
  let yoyHtml = '';
  if (state.year === '전체') {
    yoyHtml = `<span class="kpi-yoy-val">누적 집계</span><small>전체 연도 총합</small>`;
  } else if (state.year === state.minYear) {
    yoyHtml = `<span class="kpi-yoy-val">-</span><small>전년 데이터 없음</small>`;
  } else if (state.year === state.currentYear) {
    yoyHtml = `<span class="kpi-yoy-val kpi-counting">전년대비 집계중</span><small>전년 ${k.yoyBase || 0}건</small>`;
  } else {
    yoyHtml = `<span class="kpi-yoy-val ${getDiffClass(k.yoyDiff)}">${formatDiff(k.yoyDiff)}</span><small>전년 ${k.yoyBase || 0}건</small>`;
  }

  const charts = data.charts || { typeCounts: [], typeCountsYoy: [], deptCounts: [], deptCountsYoy: [] };
  
  const topDepts = (charts.deptCounts || []).slice(0, 3);
  let deptListHtml = '';
  if (topDepts.length > 0) {
    deptListHtml = topDepts.map((d, i) => `
      <div class="kpi-top-item">
        <span class="top-rank">${i+1}위</span>
        <span class="top-name">${esc(cleanDeptName(d.label))}</span>
        <span class="top-count">${d.count}건</span>
      </div>
    `).join('');
  } else {
    deptListHtml = '<div class="empty-message">데이터 없음</div>';
  }

  const topTypes = (charts.typeCounts || []).filter(r => r.label !== '미분류').slice(0, 3);
  let typeListHtml = '';
  if (topTypes.length > 0) {
    typeListHtml = topTypes.map((t, i) => `
      <div class="kpi-top-item">
        <span class="top-rank">${i+1}위</span>
        <span class="top-name">${esc(t.label)}</span>
        <span class="top-count">${t.count}건</span>
      </div>
    `).join('');
  } else {
    typeListHtml = '<div class="empty-message">데이터 없음</div>';
  }

  body.innerHTML = `
    <!-- KPI 영역 -->
    <div class="kpi-grid">
      <div class="kpi-card kpi-card-total">
        <span>총 재해 건수</span>
        <strong>${k.total || 0}건</strong>
        <div class="kpi-yoy-box">${yoyHtml}</div>
      </div>
      <div class="kpi-card">
        <span>영업부별 재해 TOP 3</span>
        <div class="kpi-top-list">${deptListHtml}</div>
      </div>
      <div class="kpi-card">
        <span>재해유형 TOP 3</span>
        <div class="kpi-top-list">${typeListHtml}</div>
      </div>
    </div>
    
    <!-- 그래프 영역 (대표적인 2가지 선정) -->
    <div class="panel">
      <h3>재해유형별 건수 (TOP 5)</h3>
      <div class="chart-container"><canvas id="captureTypeChart"></canvas></div>
    </div>
    <div class="panel">
      <h3>영업부별 재해 건수 (TOP 5)</h3>
      <div class="chart-container"><canvas id="captureDeptChart"></canvas></div>
    </div>
  `;

  // 3. 캡처용 전용 차트 드로잉 (금년 vs 전년 비교 동일 적용)
  const filteredTypes = (charts.typeCounts || []).filter(r => r.label !== '미분류').slice(0, 5);
  const filteredTypesYoy = charts.typeCountsYoy || [];
  drawCaptureChart('captureTypeChart', 'type', filteredTypes, filteredTypesYoy, false);

  const filteredDepts = (charts.deptCounts || []).slice(0, 5);
  const filteredDeptsYoy = charts.deptCountsYoy || [];
  drawCaptureChart('captureDeptChart', 'dept', filteredDepts, filteredDeptsYoy, true);
}

function drawCaptureChart(canvasId, chartKey, rows, yoyRows, horizontal) {
  const canvas = $(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  if (state.captureCharts[chartKey]) {
    state.captureCharts[chartKey].destroy();
    state.captureCharts[chartKey] = null;
  }

  const labels = (rows || []).map(r => cleanDeptName(r.label));
  const curCounts = (rows || []).map(r => r.count);
  const isSingleBar = (state.year === '전체' || state.year === state.minYear);

  let datasets = [];
  if (isSingleBar) {
    datasets = [
      {
        label: '재해건수',
        data: curCounts,
        backgroundColor: rankColors(labels.length),
        borderRadius: 4
      }
    ];
  } else {
    const yoyMap = {};
    (yoyRows || []).forEach(r => { yoyMap[cleanDeptName(r.label)] = r.count; });
    const yoyCounts = (rows || []).map(r => yoyMap[cleanDeptName(r.label)] || 0);
    datasets = [
      {
        label: '금년',
        data: curCounts,
        backgroundColor: rankColors(labels.length),
        borderRadius: 4
      },
      {
        label: '전년',
        data: yoyCounts,
        backgroundColor: labels.map(() => '#cbd5e1'),
        borderRadius: 4
      }
    ];
  }

  state.captureCharts[chartKey] = new Chart(ctx, {
    type: 'bar',
    data: { labels: labels, datasets: datasets },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      responsive: true,
      maintainAspectRatio: false,
      animation: false, // 캡처 모드는 애니메이션 없이 바로 노출
      plugins: {
        legend: { display: !isSingleBar, position: 'top', labels: { boxWidth: 10, font: { size: 10 } } },
        datalabels: {
          anchor: 'end',
          align: 'end',
          offset: -2,
          font: { weight: 'bold', size: 9 },
          formatter: function(value, context) {
            if (!isSingleBar && context.datasetIndex === 0) {
              const curVal = value;
              const yoyVal = context.chart.data.datasets[1].data[context.dataIndex] || 0;
              const diff = curVal - yoyVal;
              let diffText = '';
              if (diff > 0) diffText = ` (+${diff})`;
              else if (diff < 0) diffText = ` (${diff})`;
              return `${curVal}건${diffText}`;
            }
            return `${value}건`;
          },
          color: function(context) {
            return (isSingleBar || context.datasetIndex === 0) ? '#0f172a' : '#64748b';
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10, weight: 'bold' } } },
        y: { display: false, grid: { display: false }, beginAtZero: true }
      }
    },
    plugins: [ChartDataLabels]
  });
}

function closeCaptureMode() {
  const modal = $('captureModal');
  if (modal) modal.classList.add('hidden');
  
  // 차트 인스턴스 해제
  ['type', 'dept'].forEach(k => {
    if (state.captureCharts[k]) {
      state.captureCharts[k].destroy();
      state.captureCharts[k] = null;
    }
  });
}
