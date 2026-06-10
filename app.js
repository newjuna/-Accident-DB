/* ============================================================
 *  산업재해 현황 분석 대시보드 v14.0 — 클라이언트
 *
 *  ■ 기준: 사용자가 제공한 최신 index.html / style.css / app.js 구조 유지
 *  ■ Apps Script 배포 URL은 아래 API_URL 값을 사용합니다.
 *  ■ 변경사항 v14.0:
 *    - 기존 데이터 조회·대시보드·반복사고 조회 기능 유지
 *    - 사고 상세보기 팝업을 플레이풀 카드형 디자인으로 개선
 *    - 데이터 조회 결과를 카드형 리스트로 개선
 *    - 반복사고 매장 리스트를 랭킹 카드형으로 개선
 *    - 과거 버전 주석을 v13 기준으로 정리
 *    - 데이터 조회: 선택한 연도/월에 데이터가 있는 영업부만 드롭다운 표시
 *    - 데이터 조회: 영업부 퀵서비스 버튼 추가
 *    - 데이터 조회: 매장명 검색창을 초기 화면부터 노출
 *    - 모바일 화면 가독성 보강
 * ============================================================ */

// ★★★ 여기에 Apps Script 배포 URL을 붙여넣으세요 ★★★
const API_URL = 'https://script.google.com/macros/s/AKfycbxUiYag45n_ZxTqIF-alMjVDxf2reP5l0iSb6kTiv2lwj7db7ius-kdmt9hJwS49pDwHA/exec'; 

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
  captureCharts: { type: null, dept: null }, 
  repeatRows: [],
  repeatPage: 1,
  listRows: [],
  listPage: 1,
  listModalMode: 'table', // 반복사고 매장 팝업만 카드형으로 표시하기 위한 상태
  
  // 데이터 조회 전용 상태 및 순차 필터링용 옵션 백업
  dataRows: [],
  dataPage: 1,
  initFilterData: null, // 초기 필터 정보 캐시
  dataOptionRows: [], // 선택한 연도/월 기준 전체 행 캐시(영업부/팀 옵션 생성용)
  dataOptionKey: '', // dataOptionRows가 어느 연도/월 기준인지 확인하는 키
  
  // 데이터 조회 활성 필터 상태
  activeFilters: {
    year: '',
    month: '',
    dept: '전체',
    team: '전체',
    storeSearch: ''
  },
  
  // 반복사고 영업부별 필터링 상태 (맵 ➡️ 리스트 인터랙티브 연동)
  selectedRegionFilter: null,

  // 연도 비교 예외용 상태
  minYear: null,
  currentYear: String(new Date().getFullYear()),
  lastDashboardData: null,

  currentView: 'dashboard'
};

const PAGE_SIZE_MODAL = 5;
const PAGE_SIZE_DATA = 10;
const PAGE_SIZE_REPEAT = 10; 

// AI 조언용 5초 타이머 디바운싱용 전역 핸들
let aiAdviceTimer = null; 
let typewriterInterval = null; 

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
  // 브라우저 캐싱으로 인한 실시간 갱신 누락 방지 (Cache Busting)
  params._ = Date.now();
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
  $('captureDownloadBtn').addEventListener('click', downloadCaptureImage);

  // 데이터 조회 초기화
  $('filterResetBtn').addEventListener('click', resetFilters);

  // 데이터 조회 페이지네이션
  $('dataPrev').addEventListener('click', () => {
    if (state.dataPage > 1) { state.dataPage--; renderDataTablePage(); }
  });
  $('dataNext').addEventListener('click', () => {
    const max = Math.max(1, Math.ceil(state.dataRows.length / PAGE_SIZE_DATA));
    if (state.dataPage < max) { state.dataPage++; renderDataTablePage(); }
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
  try {
    // 병렬 비동기 API 통신 처리로 초기화 로딩 지연 극대화 개선
    const [init, dashboardData] = await Promise.all([
      callAPI({ action: 'init', division: state.division }),
      callAPI({ action: 'dashboard', division: state.division, year: String(new Date().getFullYear()), month: '전체' })
    ]);

    state.initFilterData = init; // 데이터 조회 필터링을 위한 원본 백업
    state.lastDashboardData = dashboardData;

    const years = init.years && init.years.length ? init.years : ['전체', String(new Date().getFullYear())];
    const months = ['전체', '1월', '2월', '3월', '4월', '5월', '6월',
                    '7월', '8월', '9월', '10월', '11월', '12월'];

    fillSelect($('dashYear'), years, init.defaultYear);
    fillSelect($('dashMonth'), months, '전체');

    state.year = $('dashYear').value;
    state.month = $('dashMonth').value;
    
    // 데이터 조회 필터용 기본 연도 백업 (최신 연도로 매칭)
    const numericYears = years.filter(y => y !== '전체');
    if (numericYears.length > 0) {
      state.minYear = numericYears[numericYears.length - 1];
    }
    
    // 데이터 조회 최초 연도 필터 상태 세팅
    state.activeFilters.year = init.defaultYear;

    // 대시보드 즉시 그리기
    renderDashboard(dashboardData || {});
  } catch (err) {
    alert('초기화 에러: ' + (err.message || err));
  } finally {
    hideLoading();
  }
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
    state.lastDashboardData = data; 
    renderDashboard(data || {});
  } catch (err) {
    alert('대시보드 조회 오류: ' + (err.message || err));
  } finally {
    hideLoading();
  }
}

function renderDashboard(data) {
  const k = data.kpi || { total: 0, yoyDiff: 0, yoyBase: 0, topType: '-', topTypeCount: 0 };

  // 1. 총 재해 건수 + 전년 대비
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
      yoyEl.className = 'kpi-yoy-val kpi-counting'; 
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

  // 차트 렌더링 (클릭 이벤트 제거, 텍스트 크기 확대, TOP 5 제한)
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

  // 반복사고 페이지 데이터 바인딩
  state.repeatRows = data.repeatStores || [];
  state.repeatPage = 1;
  state.selectedRegionFilter = null; // 대시보드 갱신 시 맵 필터 해제
  renderRepeatFull();
  renderRegionMap();
}

/* ============ 차트 그리기 (v13.0: 클릭 비활성화, 텍스트 크기 확대 12px, 수치 스케일 제거) ============ */
function drawRankedBarChart(canvasId, chartKey, rows, yoyRows, horizontal) {
  const canvas = $(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (state.charts[chartKey]) { state.charts[chartKey].destroy(); state.charts[chartKey] = null; }

  const labels = (rows || []).map(r => cleanDeptName(r.label));
  const curCounts = (rows || []).map(r => r.count);
  const isSingleBar = (state.year === '전체' || state.year === state.minYear);

  const yoyMap = {};
  if (!isSingleBar) {
    (yoyRows || []).forEach(r => { yoyMap[cleanDeptName(r.label)] = r.count; });
  }

  const datasets = [
    {
      label: '금년',
      data: curCounts,
      backgroundColor: rankColors(labels.length),
      borderRadius: 4
    }
  ];

  state.charts[chartKey] = new Chart(ctx, {
    type: 'bar',
    data: { labels: labels, datasets: datasets },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      responsive: true,
      maintainAspectRatio: false,
      events: ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove'],
      layout: {
        padding: {
          right: horizontal ? 65 : 10,
          top: horizontal ? 10 : 25
        }
      },
      plugins: {
        legend: { display: false }, // 단일 막대이므로 범례(Legend) 제거하여 차트가 더 넓게 표현되게 함
        tooltip: {
          enabled: true,
          callbacks: {
            title: function(context) {
              return context[0].label;
            },
            label: function(context) {
              const idx = context.dataIndex;
              const labelName = context.chart.data.labels[idx];
              const curVal = context.chart.data.datasets[0].data[idx] || 0;
              
              const lines = [`금년: ${curVal}건`];
              if (!isSingleBar) {
                const yoyVal = yoyMap[labelName] || 0;
                lines.push(`전년: ${yoyVal}건`);
                const diff = curVal - yoyVal;
                let diffText = '동일';
                if (diff > 0) diffText = `▲ ${diff}건 상승`;
                else if (diff < 0) diffText = `▼ ${Math.abs(diff)}건 하락`;
                lines.push(`전년대비: ${diffText}`);
              }
              return lines;
            }
          }
        },
        datalabels: {
          anchor: 'end',
          align: 'end',
          offset: -2,
          font: { weight: 'bold', size: 12 }, 
          formatter: function(value, context) {
            return `${value}건`;
          },
          color: function(context) {
            return context.datasetIndex === 0 ? '#0f172a' : '#64748b';
          }
        }
      },
      scales: {
        x: {
          display: !horizontal, 
          grid: { display: false },
          ticks: { font: { size: 12, weight: 'bold' } } 
        },
        y: {
          display: horizontal, 
          grid: { display: false },
          beginAtZero: true,
          ticks: { font: { size: 12, weight: 'bold' } } 
        }
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
  const lineColors = [CI_GRAY, CI_BLUE, CI_RED]; 
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
          labels: { font: { size: 12, weight: 'bold' }, padding: 20 }
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

/* ============ 수동 리스트 모달 쿼리 (로딩 오버레이 연동 확인) ============ */
async function openChartList(chartType, label) {
  showLoading('사고 리스트를 불러오는 중입니다'); 
  try {
    // 반복사고 매장 클릭('store')인 경우, 대시보드 선택 연월에 영향받지 않게 year/month를 '전체'로 쿼리
    const yr = (chartType === 'store') ? '전체' : state.year;
    const mth = (chartType === 'store') ? '전체' : state.month;

    const res = await callAPI({
      action: 'chartRecords', division: state.division,
      chartType, label, year: yr, month: mth
    });
    state.listRows = (res && res.rows) || [];
    state.listPage = 1;

    // v14 기준 유지: 반복사고 매장(store)에서 열린 사고 리스트 팝업만 카드형으로 표시
    state.listModalMode = (chartType === 'store') ? 'repeatStoreCards' : 'table';
    $('listModalTitle').textContent = cleanDeptName(label || '') + ' 사고 리스트 (' + state.listRows.length + '건)';

    const listModal = $('listModal');
    const listModalBox = listModal ? listModal.querySelector('.modal-box') : null;
    if (listModalBox) {
      listModalBox.classList.toggle('repeat-list-modal-box', state.listModalMode === 'repeatStoreCards');
    }

    renderListModalPage();
    $('listModal').classList.remove('hidden');
  } catch (err) {
    alert('사고 리스트 조회 오류: ' + (err.message || err));
  } finally { hideLoading(); }
}

function renderListModalPage() {
  const max = Math.max(1, Math.ceil(state.listRows.length / PAGE_SIZE_MODAL));
  if (state.listPage > max) state.listPage = max;
  const start = (state.listPage - 1) * PAGE_SIZE_MODAL;
  const pageRows = state.listRows.slice(start, start + PAGE_SIZE_MODAL);
  const listPageInfo = $('listPageInfo');
  if (listPageInfo) listPageInfo.textContent = state.listPage + ' / ' + max;
  const listModalBody = $('listModalBody');
  if (!listModalBody) return;

  if (state.listModalMode === 'repeatStoreCards') {
    listModalBody.innerHTML = makeRepeatStoreAccidentCards(pageRows);
  } else {
    listModalBody.innerHTML = makeRecordTable(pageRows, true);
  }
}

function makeRepeatStoreAccidentCards(rows) {
  if (!rows || !rows.length) return '<div class="empty-message">조회된 사고가 없습니다.</div>';

  const first = rows[0] || {};
  const metaHtml = `
    <div class="repeat-modal-meta-row">
      ${first.stdDept ? `<span>${esc(cleanDeptName(first.stdDept))}</span>` : ''}
      ${first.stdTeam ? `<span>${esc(first.stdTeam)}</span>` : ''}
    </div>
  `;

  const cards = rows.map(r => {
    const typeClass = getAccidentTypeClass(r.accidentType);
    return `
      <article class="repeat-accident-card ${typeClass}" onclick="openDetail('${escapeAttr(r.recordId)}')">
        <div class="repeat-accident-head">
          <div class="repeat-accident-date">
            <span class="repeat-date-icon">📅</span>
            <strong>${esc(r.accidentDate || '-')}</strong>
          </div>
          <span class="data-type-badge ${typeClass}">${esc(r.accidentType || '미분류')}</span>
        </div>
        <div class="repeat-accident-store">${esc(r.store || '-')}</div>
        <div class="repeat-accident-content">${esc(r.accidentContent || '-')}</div>
        <div class="repeat-accident-foot">
          <span>🏬 ${esc(cleanDeptName(r.stdDept || '-'))}</span>
          <span>•</span>
          <span>👤 ${esc(r.stdTeam || '-')}</span>
        </div>
      </article>
    `;
  }).join('');

  return `<div class="repeat-modal-card-wrap">${metaHtml}<div class="repeat-accident-card-list">${cards}</div></div>`;
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

function detailVal(d, key) {
  const v = d ? d[key] : '';
  return (v === undefined || v === null || String(v).trim() === '') ? '-' : String(v);
}

function getAccidentTypeClass(type) {
  const t = String(type || '');
  if (/넘어|미끄|전도|추락|낙상/.test(t)) return 'type-fall';
  if (/끼임|절단|베임|찔림|부딪|협착|화상|충돌/.test(t)) return 'type-red';
  if (/근골|요통|염좌|무리|통증|삐끗/.test(t)) return 'type-green';
  return 'type-gray';
}

function makeDetailMiniCard(icon, label, value) {
  return `
    <div class="detail-mini-card">
      <div class="detail-mini-icon">${icon}</div>
      <div>
        <span>${esc(label)}</span>
        <strong>${esc(value)}</strong>
      </div>
    </div>
  `;
}

function makeDetailRow(icon, label, value) {
  return `
    <div class="detail-row">
      <span class="detail-row-label"><i>${icon}</i>${esc(label)}</span>
      <strong>${esc(value)}</strong>
    </div>
  `;
}

function makeDataCardList(rows) {
  if (!rows || !rows.length) return '<div class="empty-message">조회된 사고가 없습니다.</div>';

  let html = '<div class="data-card-list">';
  rows.forEach((r, i) => {
    const typeClass = getAccidentTypeClass(r.accidentType);
    html += `
      <article class="data-record-card" onclick="openDetail('${escapeAttr(r.recordId)}')">
        <div class="data-record-left">
          <div class="data-record-store-icon">🏬</div>
          <div>
            <div class="data-record-date">${esc(r.accidentDate || '-')}</div>
            <div class="data-record-store">${esc(r.store || '-')}</div>
            <div class="data-record-org">${esc(cleanDeptName(r.stdDept))} · ${esc(r.stdTeam || '-')}</div>
          </div>
        </div>
        <div class="data-record-content">
          <span class="data-type-badge ${typeClass}">${esc(r.accidentType || '미분류')}</span>
          <p>${esc(shorten(r.accidentContent, 110))}</p>
        </div>
        <button class="data-detail-btn" type="button">상세보기</button>
      </article>
    `;
  });
  html += '</div>';
  return html;
}

/* ============ 사고 상세 팝업 (v13.0 플레이풀 카드형 디자인) ============ */
async function openDetail(recordId) {
  showLoading('사고 상세를 불러오는 중입니다');
  try {
    const res = await callAPI({ action: 'detail', division: state.division, recordId });
    const d = res.detail || {};

    const accidentDate = detailVal(d, '재해일자');
    const dept = cleanDeptName(detailVal(d, '영업부'));
    const team = detailVal(d, '팀');
    const store = detailVal(d, '매장명');
    const victim = detailVal(d, '재해자명');
    const employeeNo = detailVal(d, '사번');
    const accidentType = detailVal(d, '재해유형');
    const cause = detailVal(d, '기인물');
    const accidentContent = detailVal(d, '사고내용');
    const typeClass = getAccidentTypeClass(accidentType);

    const html = `
      <div class="detail-playful">
        <div class="detail-sticker">사고</div>

        <section class="detail-hero-card">
          <div class="detail-hero-title">
            <div class="detail-hero-icon">📋</div>
            <div>
              <h4>사고 상세보기</h4>
              <p>${esc(accidentDate)} · ${esc(dept)} · ${esc(team)} · ${esc(store)}</p>
            </div>
          </div>
          <span class="detail-type-badge ${typeClass}">${esc(accidentType)}</span>
        </section>

        <section class="detail-mini-grid">
          ${makeDetailMiniCard('📅', '재해일자', accidentDate)}
          ${makeDetailMiniCard('🏬', '매장명', store)}
          ${makeDetailMiniCard('👥', '팀', team)}
          ${makeDetailMiniCard('🏢', '영업부', dept)}
        </section>

        <section class="detail-section-grid">
          <div class="detail-paper-card person-card">
            <h5><span>👤</span> 인적 정보</h5>
            ${makeDetailRow('👤', '재해자명', victim)}
            ${makeDetailRow('🪪', '사번', employeeNo)}
          </div>

          <div class="detail-paper-card type-card">
            <h5><span>⚠️</span> 사고 분류</h5>
            ${makeDetailRow('⚠️', '재해유형', accidentType)}
            ${makeDetailRow('📦', '기인물', cause)}
          </div>
        </section>

        <section class="detail-paper-card accident-card">
          <h5><span>📝</span> 사고 내용</h5>
          <div class="detail-accident-content">${esc(accidentContent)}</div>
        </section>
      </div>
    `;

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
  state.listModalMode = 'table';
  const listModalBox = $('listModal') ? $('listModal').querySelector('.modal-box') : null;
  if (listModalBox) listModalBox.classList.remove('repeat-list-modal-box');
}

/* ============ 반복사고 매장 전체 리스트 렌더링 (가상 맵 필터 연동 포함) ============ */
function renderRepeatFull() {
  let rows = state.repeatRows || [];

  // 가상 지역 맵 클릭 필터가 켜져 있으면 필터링 처리
  if (state.selectedRegionFilter) {
    rows = rows.filter(r => r.dept === state.selectedRegionFilter);
  }

  const repeatFullList = $('repeatFullList');
  if (!repeatFullList) return;
  if (!rows.length) {
    state.repeatPage = 1;
    repeatFullList.innerHTML = '<div class="empty-message">조건에 맞는 반복사고 매장이 없습니다.</div>';
    return;
  }

  const maxPage = Math.max(1, Math.ceil(rows.length / PAGE_SIZE_REPEAT));
  if (state.repeatPage > maxPage) state.repeatPage = maxPage;
  if (state.repeatPage < 1) state.repeatPage = 1;

  const start = (state.repeatPage - 1) * PAGE_SIZE_REPEAT;
  const pageRows = rows.slice(start, start + PAGE_SIZE_REPEAT);

  let html = `
    <div class="repeat-list-head">
      <div>
        <span class="repeat-list-kicker">반복사고 매장 리스트</span>
        <strong>총 ${rows.length}개 매장</strong>
      </div>
      ${rows.length > PAGE_SIZE_REPEAT ? `<span class="repeat-list-page-chip">${state.repeatPage} / ${maxPage}</span>` : ''}
    </div>
    <div class="repeat-rank-list">
  `;

  pageRows.forEach((r, idx) => {
    const i = start + idx;
    const typeClass = getAccidentTypeClass(r.topType);
    const rankClass = i === 0 ? 'rank-first' : (i === 1 ? 'rank-second' : (i === 2 ? 'rank-third' : ''));
    html += `
      <article class="repeat-rank-card ${rankClass}" onclick="openChartList('store','${escapeAttr(r.store)}')">
        <div class="repeat-rank-no">${i + 1}</div>
        <div class="repeat-rank-main">
          <div class="repeat-store-name">${esc(r.store)}</div>
          <div class="repeat-store-sub">${esc(cleanDeptName(r.dept))} · ${esc(r.team)}</div>
          <div class="repeat-store-meta">
            <span class="data-type-badge ${typeClass}">${esc(r.topType || '미분류')}</span>
            <span>최근 ${esc(r.recentDate || '-')}</span>
          </div>
        </div>
        <div class="repeat-count-box">
          <strong>${esc(r.count)}</strong>
          <span>건</span>
        </div>
      </article>
    `;
  });

  html += '</div>';

  if (rows.length > PAGE_SIZE_REPEAT) {
    html += `
      <div class="repeat-pager">
        <button type="button" onclick="goRepeatPage(-1)" ${state.repeatPage <= 1 ? 'disabled' : ''}>이전</button>
        <span>${state.repeatPage} / ${maxPage}</span>
        <button type="button" onclick="goRepeatPage(1)" ${state.repeatPage >= maxPage ? 'disabled' : ''}>다음</button>
      </div>
    `;
  }

  repeatFullList.innerHTML = html;
}

function goRepeatPage(step) {
  const nextPage = Number(state.repeatPage || 1) + Number(step || 0);
  state.repeatPage = nextPage;
  renderRepeatFull();
}
window.goRepeatPage = goRepeatPage;

/* ============ 반복사고 매장: 영업부별 가상 지역 맵 (v13.0: 매장 단위 최고 발생 건수 기준 정밀화) ============ */
function renderRegionMap() {
  const container = $('visualRegionMap');
  if (!container) return;

  let standardDepts = [];
  if (state.division === '수도권영업부문') {
    standardDepts = ['인천영업부', '강북영업부', '강남/구리영업부', '수원/용인영업부', '관악/평택/안산영업부', '강원영업부'];
  } else {
    standardDepts = ['충청영업부', '호남영업부', '경북영업부', '경남영업부'];
  }

  // 2건 이상 반복 매장이 1개라도 존재하는 영업부만 추출
  const activeDepts = standardDepts.filter(d => 
    (state.repeatRows || []).some(r => r.dept === d)
  );

  if (activeDepts.length === 0) {
    container.innerHTML = '<div class="empty-message" style="grid-column: 1/-1;">최근 1년 동안 2건 이상 반복사고가 발생한 매장이 없습니다.</div>';
    return;
  }

  let html = activeDepts.map(d => {
    const deptStores = (state.repeatRows || []).filter(r => r.dept === d);
    
    // 매장별 최고 사고 건수 판별 및 등급별 매장 카운트
    let maxCount = 0;
    let count4 = 0; // 4건 이상 매장 수
    let count3 = 0; // 3건 매장 수
    let count2 = 0; // 2건 매장 수

    deptStores.forEach(s => {
      const cnt = Number(s.count || 0);
      if (cnt > maxCount) maxCount = cnt;

      if (cnt >= 4) {
        count4++;
      } else if (cnt === 3) {
        count3++;
      } else if (cnt === 2) {
        count2++;
      }
    });

    let hotspotClass = 'hotspot-safe';
    let statusText = '안전';
    let detailText = '';

    if (maxCount >= 4) {
      hotspotClass = 'hotspot-red';
      statusText = '위험';
      detailText = `🔴 4건이상 매장: ${count4}곳`;
    } else if (maxCount === 3) {
      hotspotClass = 'hotspot-blue';
      statusText = '주의';
      detailText = `🔵 3건 매장: ${count3}곳`;
    } else if (maxCount === 2) {
      hotspotClass = 'hotspot-gray';
      statusText = '보통';
      detailText = `⚪ 2건 매장: ${count2}곳`;
    }

    const isSelected = state.selectedRegionFilter === d ? 'border-color: var(--blue); box-shadow: 0 8px 16px rgba(19,36,90,0.12); transform: translateY(-3px);' : '';
    const shortName = cleanDeptName(d);

    return `
      <div class="region-card ${hotspotClass}" style="${isSelected}" onclick="toggleRegionFilter('${escapeAttr(d)}')">
        <span class="region-name">${esc(shortName)}</span>
        <span class="region-badge" style="margin-bottom: 6px;">${statusText}</span>
        <span style="font-size: 11px; font-weight: 800; color: var(--muted);">${detailText}</span>
      </div>
    `;
  }).join('');
  
  if (state.selectedRegionFilter) {
    html += `
      <div class="region-card hotspot-safe" style="grid-column: 1/-1; min-height: 48px; border-style: dashed;" onclick="toggleRegionFilter(null)">
        <span class="region-name" style="margin-bottom:0; color: var(--blue);">[전체 보기 - 필터 해제]</span>
      </div>
    `;
  }
  
  container.innerHTML = html;
}

/**
 * 가상 지역 맵 카드 클릭 시 우측 테이블 필터링 연동 (토글 식)
 */
function toggleRegionFilter(dept) {
  if (state.selectedRegionFilter === dept) {
    state.selectedRegionFilter = null; // 같은 카드를 또 누르면 필터 해제
  } else {
    state.selectedRegionFilter = dept;
  }
  state.repeatPage = 1;
  renderRepeatFull();
  renderRegionMap();
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
    // 순차 드롭다운 UI 최초 렌더링
    renderDataFilters();
    renderDataTablePage();
  }
  if (view === 'repeat') {
    state.selectedRegionFilter = null; // 초기 진입 시 전체 노출
    state.repeatPage = 1;
    renderRepeatFull();
    renderRegionMap();
  }
}

/* ============ 데이터 조회: v14.0 기간 연동 필터 + 영업부 퀵서비스 ============ */

function getDataPeriodKey() {
  const f = state.activeFilters;
  return `${f.year || ''}|${f.month || ''}`;
}

function resetDownstreamDataFilters(resetMonth) {
  const f = state.activeFilters;
  if (resetMonth) f.month = '';
  f.dept = '전체';
  f.team = '전체';
  f.storeSearch = '';
  state.dataOptionRows = [];
  state.dataOptionKey = '';
  state.dataRows = [];
  state.dataPage = 1;
}

async function loadDataFilterOptions(force) {
  const f = state.activeFilters;
  if (!f.year || !f.month) {
    state.dataOptionRows = [];
    state.dataOptionKey = '';
    return;
  }

  const key = getDataPeriodKey();
  if (!force && state.dataOptionKey === key) return;

  const optionFilters = {
    year: f.year,
    month: f.month,
    dept: '전체',
    team: '전체',
    store: '전체',
    type: '전체',
    storeSearch: ''
  };

  const res = await callAPI({ action: 'query', division: state.division, filters: JSON.stringify(optionFilters) });
  state.dataOptionRows = res.rows || [];
  state.dataOptionKey = key;
}

function getDeptCounts_() {
  const counts = {};
  (state.dataOptionRows || []).forEach(r => {
    const dept = r.stdDept || '';
    if (!dept) return;
    counts[dept] = (counts[dept] || 0) + 1;
  });
  return counts;
}

function getAvailableDepartments_() {
  const init = state.initFilterData || {};
  const counts = getDeptCounts_();
  const available = Object.keys(counts);

  const ordered = [];
  (init.departments || []).forEach(d => {
    if (counts[d]) ordered.push(d);
  });
  available.forEach(d => {
    if (!ordered.includes(d)) ordered.push(d);
  });
  return ordered;
}

function getFilteredTeams_(dept) {
  const teams = new Set();
  (state.dataOptionRows || []).forEach(r => {
    if ((dept === '전체' || r.stdDept === dept) && r.stdTeam) teams.add(r.stdTeam);
  });
  return [...teams].sort();
}

function makeDeptQuickServiceHtml() {
  const f = state.activeFilters;
  if (!f.year || !f.month) return '';

  const deptCounts = getDeptCounts_();
  const departments = getAvailableDepartments_();
  const total = (state.dataOptionRows || []).length;

  if (!departments.length) {
    return `
      <div class="dept-quick-service is-empty">
        <div class="dept-quick-head">
          <span>빠른 영업부 조회</span>
          <small>선택한 기간에 등록된 사고 데이터가 없습니다.</small>
        </div>
      </div>
    `;
  }

  let html = `
    <div class="dept-quick-service">
      <div class="dept-quick-head">
        <span>빠른 영업부 조회</span>
        <small>선택한 기간에 데이터가 있는 영업부만 표시됩니다.</small>
      </div>
      <div class="dept-quick-buttons">
        <button type="button" class="dept-quick-btn ${f.dept === '전체' ? 'active' : ''}" onclick="selectQuickDept('전체')">
          <span>전체</span><b>${total}건</b>
        </button>
  `;

  departments.forEach(d => {
    html += `
        <button type="button" class="dept-quick-btn ${f.dept === d ? 'active' : ''}" onclick="selectQuickDept('${escapeAttr(d)}')">
          <span>${esc(cleanDeptName(d))}</span><b>${deptCounts[d] || 0}건</b>
        </button>
    `;
  });

  html += `
      </div>
    </div>
  `;
  return html;
}

function renderDataFilters() {
  const container = $('dataFiltersContainer');
  if (!container || !state.initFilterData) return;

  const init = state.initFilterData;
  const f = state.activeFilters;
  const availableDepartments = getAvailableDepartments_();

  let html = makeDeptQuickServiceHtml();
  html += '<div class="data-filter-row">';

  // 1. 연도
  html += `<label>연도<select id="dataYear">`;
  const numericYears = init.years.filter(y => y !== '전체');
  numericYears.forEach(y => {
    html += `<option value="${y}" ${String(y) === String(f.year) ? 'selected' : ''}>${y}</option>`;
  });
  html += `</select></label>`;

  // 2. 월
  if (f.year) {
    const months = ['', '전체', '1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
    html += `<label>월<select id="dataMonth">`;
    months.forEach(m => {
      const label = m || '월 선택';
      html += `<option value="${m}" ${String(m) === String(f.month) ? 'selected' : ''}>${label}</option>`;
    });
    html += `</select></label>`;
  }

  // 3. 영업부: 선택한 연도/월에 실제 데이터가 있는 영업부만 표시
  if (f.year && f.month) {
    html += `<label>영업부<select id="filterDept"><option value="전체">전체</option>`;
    availableDepartments.forEach(d => {
      html += `<option value="${d}" ${String(d) === String(f.dept) ? 'selected' : ''}>${cleanDeptName(d)}</option>`;
    });
    html += `</select></label>`;
  }

  // 4. 팀: 선택한 연도/월 + 영업부에 실제 데이터가 있는 팀만 표시
  if (f.year && f.month && f.dept && f.dept !== '전체') {
    const filteredTeams = getFilteredTeams_(f.dept);
    html += `<label>팀<select id="filterTeam"><option value="전체">전체</option>`;
    filteredTeams.forEach(t => {
      html += `<option value="${t}" ${String(t) === String(f.team) ? 'selected' : ''}>${t}</option>`;
    });
    html += `</select></label>`;
  }

  // 5. 매장명 검색: 월/영업부 선택 전에도 바로 검색할 수 있도록 상시 노출
  if (f.year) {
    html += `<label class="store-search-label">매장명 검색<input id="filterStoreSearch" value="${esc(f.storeSearch)}" placeholder="매장명만 입력 후 Enter"></label>`;
    html += `<button type="button" id="storeSearchBtn" class="btn-sub store-search-btn">검색</button>`;
  }

  html += '</div>';
  container.innerHTML = html;

  const selYear = $('dataYear');
  if (selYear) selYear.addEventListener('change', (e) => {
    f.year = e.target.value;
    resetDownstreamDataFilters(true);
    renderDataFilters();
    renderDataTablePage();
  });

  const selMonth = $('dataMonth');
  if (selMonth) selMonth.addEventListener('change', (e) => {
    f.month = e.target.value;
    f.dept = '전체';
    f.team = '전체';
    state.dataOptionRows = [];
    state.dataOptionKey = '';
    if (!f.month) {
      state.dataRows = [];
      renderDataFilters();
      renderDataTablePage();
      return;
    }
    loadDataTable({ reloadOptions: true, loadingMessage: '선택한 기간의 영업부를 불러오는 중입니다' });
  });

  const selDept = $('filterDept');
  if (selDept) selDept.addEventListener('change', (e) => {
    f.dept = e.target.value;
    f.team = '전체';
    renderDataFilters();
    loadDataTable();
  });

  const selTeam = $('filterTeam');
  if (selTeam) selTeam.addEventListener('change', (e) => {
    f.team = e.target.value;
    renderDataFilters();
    loadDataTable();
  });

  const txtSearch = $('filterStoreSearch');
  if (txtSearch) {
    txtSearch.addEventListener('input', (e) => { f.storeSearch = e.target.value; });
    txtSearch.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadDataTable({ storeSearchOnly: !f.month }); });
  }

  const storeSearchBtn = $('storeSearchBtn');
  if (storeSearchBtn) {
    storeSearchBtn.addEventListener('click', () => loadDataTable({ storeSearchOnly: !f.month }));
  }
}

function selectQuickDept(dept) {
  const f = state.activeFilters;
  f.dept = dept || '전체';
  f.team = '전체';
  renderDataFilters();
  loadDataTable();
}
window.selectQuickDept = selectQuickDept;

/**
 * 실시간 자동 쿼리 수행
 */
async function loadDataTable(options = {}) {
  const f = state.activeFilters;
  const hasStoreSearch = String(f.storeSearch || '').trim() !== '';

  // 연도는 기본 기준으로 유지하고, 월 선택 전에는 매장명 검색이 있을 때만 조회한다.
  if (!f.year) return;
  if (!f.month && !hasStoreSearch) return;

  showLoading(options.loadingMessage || '데이터 조회 중입니다');
  try {
    if (f.month && (options.reloadOptions || state.dataOptionKey !== getDataPeriodKey())) {
      await loadDataFilterOptions(true);
    }

    const availableDepartments = f.month ? getAvailableDepartments_() : [];
    if (f.month && f.dept !== '전체' && !availableDepartments.includes(f.dept)) {
      f.dept = '전체';
      f.team = '전체';
    }

    const queryFilters = {
      year: f.year,
      month: f.month,
      dept: f.dept,
      team: f.team,
      store: '전체',
      type: '전체',
      storeSearch: f.storeSearch
    };
    const res = await callAPI({ action: 'query', division: state.division, filters: JSON.stringify(queryFilters) });
    state.dataRows = res.rows || [];
    state.dataPage = 1;

    renderDataFilters();
    renderDataTablePage();
    triggerAiAdviceTimer();
  } catch (err) {
    alert('데이터 조회 오류: ' + (err.message || err));
  } finally { hideLoading(); }
}

/**
 * 5초 유휴 시 작동하는 AI 안전 조언 타이머 트리거
 */
function triggerAiAdviceTimer() {
  const adviceBox = $('aiAdviceBox');
  if (adviceBox) {
    const content = adviceBox.querySelector('.ai-advice-content');
    if (content) {
      clearInterval(typewriterInterval);
      content.innerHTML = '🤖 AI 안전진단 분석 중... 잠시만 기다려 주세요.';
    }
  }

  clearTimeout(aiAdviceTimer);
  aiAdviceTimer = setTimeout(() => {
    generateAiAdvice();
  }, 5000); // 5초 딜레이
}

/**
 * 글자가 한 자씩 타다닥 찍히는 타자(Typewriter) 연출 효과 구현
 */
function typeWriterEffect(element, text, speed = 35) {
  clearInterval(typewriterInterval);
  element.innerHTML = '';
  let i = 0;
  typewriterInterval = setInterval(() => {
    if (i < text.length) {
      element.innerHTML += text.charAt(i);
      i++;
    } else {
      clearInterval(typewriterInterval);
    }
  }, speed);
}

/**
 * 조회된 조직의 이력을 분석하여 실시간 AI 조언 멘트 카드 출력 (정제된 통계와 타이핑 효과 적용)
 */
function generateAiAdvice() {
  const adviceBox = $('aiAdviceBox');
  if (!adviceBox) return;

  const f = state.activeFilters;
  const contentEl = adviceBox.querySelector('.ai-advice-content');
  if (!contentEl) return;

  // 영업부가 '전체'이거나 선택되지 않았으면 AI 안내 패널 노출 제외
  if (!f.dept || f.dept === '전체') {
    contentEl.innerHTML = '🤖 AI 안전진단 분석 대기 중... 필터를 선택해 주세요.';
    return;
  }

  const rows = state.dataRows || [];
  const deptNameClean = cleanDeptName(f.dept);
  const teamText = (f.team && f.team !== '전체') ? ` ${f.team}` : '';
  const targetLabel = `${deptNameClean}${teamText}`;

  let adviceText = '';
  
  if (rows.length === 0) {
    adviceText = `🤖 AI 분석 결과: ${targetLabel}은 분석 기간 내 등록된 산업재해 이력이 전혀 없습니다. 매우 우수한 안전 문화를 유지하고 계십니다!`;
  } else {
    // 1. 최다 발생 재해 유형 집계
    const typeCounts = {};
    rows.forEach(r => {
      if (r.accidentType && r.accidentType !== '미분류') {
        typeCounts[r.accidentType] = (typeCounts[r.accidentType] || 0) + 1;
      }
    });

    const sortedTypes = Object.keys(typeCounts).sort((a, b) => typeCounts[b] - typeCounts[a]);
    const topType = sortedTypes[0]; // 1위 유형

    adviceText = `🤖 AI 분석 결과: ${targetLabel}의 최근 산재 이력을 정밀 분석한 결과, '${topType}' 유형의 사고 비중이 가장 높게 나타났습니다. 현장 작업 시 주의가 필요합니다.`;
  }

  // 타이핑 효과 가동
  typeWriterEffect(contentEl, adviceText);
}

/**
 * 필터 리셋 (v13.0: AI 조언 박스 대기상태 복원 및 타이머 정지)
 */
async function resetFilters() {
  state.activeFilters = {
    year: state.initFilterData ? state.initFilterData.defaultYear : state.currentYear,
    month: '',
    dept: '전체',
    team: '전체',
    storeSearch: ''
  };
  state.dataRows = [];
  state.dataPage = 1;
  
  clearTimeout(aiAdviceTimer);
  clearInterval(typewriterInterval);
  
  const adviceBox = $('aiAdviceBox');
  if (adviceBox) {
    const content = adviceBox.querySelector('.ai-advice-content');
    if (content) content.innerHTML = '🤖 AI 안전진단 분석 대기 중... 필터를 선택해 주세요.';
  }

  renderDataFilters();
  
  const resultContainer = $('dataResult');
  if (resultContainer) resultContainer.innerHTML = '';
  const pager = $('dataPager');
  if (pager) pager.classList.add('hidden');
}


function sanitizeExcelFileNamePart(value) {
  return String(value || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '')
    .trim() || '전체';
}

function buildExcelFileName() {
  const f = state.activeFilters || {};
  const parts = [
    '산업재해_데이터조회',
    sanitizeExcelFileNamePart(f.year || state.currentYear || '전체') + '년',
    sanitizeExcelFileNamePart(f.month || '전체')
  ];

  if (f.dept && f.dept !== '전체') parts.push(sanitizeExcelFileNamePart(cleanDeptName(f.dept)));
  if (f.team && f.team !== '전체') parts.push(sanitizeExcelFileNamePart(f.team));
  if (f.storeSearch) parts.push(sanitizeExcelFileNamePart(f.storeSearch));
  parts.push((state.dataRows || []).length + '건');

  return parts.join('_') + '.xlsx';
}

function getTextWidth(value) {
  const text = String(value ?? '');
  // 한글은 영문보다 넓게 계산해서 열너비를 넉넉하게 잡습니다.
  let width = 0;
  for (const ch of text) {
    width += /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(ch) ? 1.8 : 1;
  }
  return width;
}

function getAutoColumnWidths(aoa) {
  const minWidths = [6, 12, 12, 12, 18, 12, 36];
  const maxWidths = [8, 16, 18, 20, 34, 18, 100];
  const colCount = aoa[0].length;

  const widths = [];
  for (let c = 0; c < colCount; c++) {
    let maxLen = minWidths[c] || 10;
    aoa.forEach(row => {
      const cell = row[c] ?? '';
      const len = getTextWidth(cell);
      if (len > maxLen) maxLen = len;
    });
    widths.push({ wch: Math.min(Math.ceil(maxLen + 3), maxWidths[c] || 40) });
  }
  return widths;
}

function applyExcelCellStyle(ws, cellAddress, style) {
  if (!ws[cellAddress]) ws[cellAddress] = { t: 's', v: '' };
  ws[cellAddress].s = style;
}

function downloadDataExcel() {
  const rows = state.dataRows || [];
  if (!rows.length) {
    alert('다운로드할 조회 결과가 없습니다.');
    return;
  }

  if (typeof XLSX === 'undefined') {
    alert('엑셀 다운로드 라이브러리를 불러오지 못했습니다. 인터넷 연결 후 다시 시도해 주세요.');
    return;
  }

  const fileName = buildExcelFileName();
  const title = fileName.replace(/\.xlsx$/i, '');

  const header = ['No', '재해일자', '영업부', '팀', '매장명', '재해유형', '사고내용'];
  const dataRows = rows.map((r, i) => ([
    i + 1,
    r.accidentDate || '',
    cleanDeptName(r.stdDept || ''),
    r.stdTeam || '',
    r.store || '',
    r.accidentType || '',
    r.accidentContent || ''
  ]));

  // A1 제목, A4부터 표 시작
  const aoa = [
    [title],
    [],
    [],
    header,
    ...dataRows
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const lastRow = aoa.length;
  const lastCol = header.length;
  const tableStartRow = 4; // Excel 기준 행 번호
  const tableEndRow = lastRow;

  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol - 1 } }
  ];

  ws['!cols'] = getAutoColumnWidths([header, ...dataRows]);

  // 제목 스타일: A1
  applyExcelCellStyle(ws, 'A1', {
    font: { name: '맑은 고딕', bold: true, sz: 20, color: { rgb: '000000' } },
    alignment: { horizontal: 'left', vertical: 'center' }
  });

  ws['!rows'] = ws['!rows'] || [];
  ws['!rows'][0] = { hpt: 30 };
  ws['!rows'][3] = { hpt: 22 };

  const borderStyle = {
    top: { style: 'thin', color: { rgb: '808080' } },
    bottom: { style: 'thin', color: { rgb: '808080' } },
    left: { style: 'thin', color: { rgb: '808080' } },
    right: { style: 'thin', color: { rgb: '808080' } }
  };

  const headerStyle = {
    font: { name: '맑은 고딕', bold: true, sz: 11, color: { rgb: '000000' } },
    fill: { patternType: 'solid', fgColor: { rgb: 'DCE6F1' } },
    border: borderStyle,
    alignment: { horizontal: 'center', vertical: 'center' }
  };

  const bodyStyle = {
    font: { name: '맑은 고딕', sz: 10, color: { rgb: '000000' } },
    border: borderStyle,
    alignment: { vertical: 'top', wrapText: true }
  };

  const bodyCenterStyle = {
    font: { name: '맑은 고딕', sz: 10, color: { rgb: '000000' } },
    border: borderStyle,
    alignment: { horizontal: 'center', vertical: 'top', wrapText: true }
  };

  // A4:G마지막행 스타일 적용: 바깥쪽/안쪽 윤곽선 모두 적용
  for (let r = tableStartRow; r <= tableEndRow; r++) {
    for (let c = 1; c <= lastCol; c++) {
      const addr = XLSX.utils.encode_cell({ r: r - 1, c: c - 1 });
      if (r === tableStartRow) {
        applyExcelCellStyle(ws, addr, headerStyle);
      } else {
        // No, 날짜, 영업부, 팀, 재해유형은 가운데 정렬 / 매장명, 사고내용은 좌측 정렬
        const style = [1, 2, 3, 4, 6].includes(c) ? bodyCenterStyle : bodyStyle;
        applyExcelCellStyle(ws, addr, style);
      }
    }
  }

  // 사고내용 열은 길게 보이도록 줄바꿈
  for (let r = tableStartRow + 1; r <= tableEndRow; r++) {
    const gAddr = XLSX.utils.encode_cell({ r: r - 1, c: 6 });
    if (ws[gAddr]) {
      ws[gAddr].s = {
        ...bodyStyle,
        alignment: { vertical: 'top', wrapText: true }
      };
    }
  }

  // 첫 표 행 고정 + 필터
  ws['!freeze'] = { xSplit: 0, ySplit: 4 };
  ws['!autofilter'] = {
    ref: XLSX.utils.encode_range({
      s: { r: tableStartRow - 1, c: 0 },
      e: { r: tableEndRow - 1, c: lastCol - 1 }
    })
  };

  const wb = XLSX.utils.book_new();
  const sheetName = '조회결과_' + rows.length + '건';
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));

  XLSX.writeFile(wb, fileName, { bookType: 'xlsx', cellStyles: true });
}
window.downloadDataExcel = downloadDataExcel;

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
    const excelButtonHtml = state.dataRows.length > 0
      ? `<button type="button" class="excel-download-btn" onclick="downloadDataExcel()">📥 엑셀 다운로드</button>`
      : '';

    resultContainer.innerHTML = `
      <div class="data-result-head">
        <div>
          <span class="data-result-kicker">조회 결과</span>
          <strong>사고 데이터 목록</strong>
        </div>
        <div class="data-result-actions">
          <span class="data-result-count">총 ${state.dataRows.length}건</span>
          ${excelButtonHtml}
        </div>
      </div>
    ` + makeDataCardList(pageRows);
  }
}

/* ============ PPT 캡처 전용 모달 동작 ============ */
async function openCaptureMode() {
  const modal = $('captureModal');
  const body = $('captureBody');
  if (!modal || !body) return;

  const selectedYear = $('dashYear') ? $('dashYear').value : state.year;
  const selectedMonth = $('dashMonth') ? $('dashMonth').value : state.month;

  if (!selectedYear || selectedYear === '전체' || !selectedMonth || selectedMonth === '전체') {
    alert('요약 생성은 기준연도와 기준월을 선택한 뒤 실행해 주세요.\n예: 6월 회의 자료 → 기준월 5월 선택');
    return;
  }

  showLoading('요약 화면을 만드는 중입니다');

  try {
    const currentData = state.lastDashboardData || {};
    const currentTotal = Number((currentData.kpi || {}).total || 0);
    const monthNum = Number(String(selectedMonth).replace('월', ''));
    const prevDate = getPreviousYearMonth(selectedYear, selectedMonth);
    const [prevData, yearTotalData] = await Promise.all([
      callAPI({ action: 'dashboard', division: state.division, year: prevDate.year, month: prevDate.month }),
      callAPI({ action: 'dashboard', division: state.division, year: selectedYear, month: '전체' })
    ]);

    const prevTotal = Number(((prevData || {}).kpi || {}).total || 0);
    const monthDiff = currentTotal - prevTotal;
    const yearlyTotal = Number(((yearTotalData || {}).kpi || {}).total || 0);

    const charts = currentData.charts || {};
    const typeRows = (charts.typeCounts || []).filter(r => r.label !== '미분류').slice(0, 3);
    const deptRows = (charts.deptCounts || []).slice(0, 3).map(r => ({ ...r, label: cleanDeptName(r.label) }));

    const trendRows = currentData.yearlyTrend || [];
    const currentTrend = trendRows.find(r => String(r.year) === String(selectedYear)) || trendRows[trendRows.length - 1] || { months: [] };
    const previousTrend = trendRows.find(r => String(r.year) === String(Number(selectedYear) - 1)) || { months: [] };

    const monthlyValues = Array.from({ length: 12 }, (_, i) => Number((currentTrend.months || [])[i] || 0));
    const referenceValues = Array.from({ length: 12 }, (_, i) => Number((previousTrend.months || [])[i] || 0));

    const combinedValues = monthlyValues.map((v, i) => {
      if (i + 1 <= monthNum) return v;
      return referenceValues[i] || 0;
    });

    const maxValue = Math.max(1, ...combinedValues, currentTotal, prevTotal);
    const topType = typeRows.length ? `${typeRows[0].label} ${typeRows[0].count}건` : '데이터 없음';
    const topDept = deptRows.length ? `${deptRows[0].label} ${deptRows[0].count}건` : '데이터 없음';

    modal.classList.remove('hidden');
    body.className = 'summary-report-body';
    const board = modal.querySelector('.capture-board');
    if (board) {
      board.classList.remove('monthly-report-board');
      board.classList.add('summary-report-board');
    }

    body.innerHTML = `
      <section id="summaryReportPage" class="summary-report-page">
        <div class="summary-bg-overlay"></div>
        <header class="summary-header">
          <div class="summary-title-wrap">
            <h1>${esc(selectedYear)}년 ${esc(selectedMonth)} 산업재해 <span>현황</span></h1>
            <p>${esc(state.division || '-')} / 기준: ${esc(selectedYear)}.${String(monthNum).padStart(2, '0')}.01 ~ ${esc(selectedYear)}.${String(monthNum).padStart(2, '0')}.${getLastDayOfMonth(selectedYear, monthNum)}</p>
          </div>
          <div class="summary-logo-wrap"><img src="logo.png" alt="ASUNG DAISO"></div>
        </header>

        <section class="summary-kpi-row">
          ${makeSummaryKpiCard('총 재해', `${currentTotal}건`, `<small>선택 월 발생 건수</small>`, 'shield')}
          ${makeSummaryKpiCard('전월 대비', `${formatMonthlyDiff(monthDiff)}`, `<small>${prevDate.year}년 ${prevDate.month} ${prevTotal}건</small>`, 'down')}
          ${makeSummaryKpiCard('연간 누적', `${yearlyTotal}건`, `<small>${selectedYear}년 누적 기준</small>`, 'growth')}
        </section>

        <section class="summary-main-grid">
          <div class="summary-panel summary-trend-panel">
            <div class="summary-panel-title">${esc(selectedYear)}년 월별 재해 발생 추이</div>
            <div class="summary-trend-chart">
              <div class="summary-y-axis">
                ${makeSummaryYAxis(maxValue)}
              </div>
              <div class="summary-bars-zone">
                <div class="summary-bars-area">
                  ${monthlyValues.map((v, i) => makeSummaryBar(i + 1, i + 1 <= monthNum ? v : referenceValues[i], maxValue, i + 1 === monthNum ? 'current' : (i + 1 < monthNum ? 'actual' : 'reference'))).join('')}
                  <svg class="summary-trend-line" viewBox="0 0 900 240" preserveAspectRatio="none">
                    <polyline points="${makeSummaryTrendPoints(monthlyValues.slice(0, monthNum), maxValue, monthNum)}" fill="none" stroke="#ff1a1a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="3 9"></polyline>
                    ${makeSummaryTrendDots(monthlyValues.slice(0, monthNum), maxValue, monthNum)}
                  </svg>
                </div>
                <div class="summary-bar-legend"><span class="legend-box navy"></span>실적 <span class="legend-dotted"></span>추세선 <span class="legend-box gray"></span>과거건수</div>
              </div>
            </div>
          </div>

          <div class="summary-panel summary-donut-panel">
            <div class="summary-panel-title">재해유형 비중</div>
            ${makeSummaryDonut(typeRows, charts.typeCounts || [])}
          </div>
        </section>

        <section class="summary-bottom-grid">
          <div class="summary-panel summary-list-panel">
            <div class="summary-panel-title">재해유형 TOP 3</div>
            ${makeSummaryTopList(typeRows, 'type')}
          </div>
          <div class="summary-panel summary-list-panel">
            <div class="summary-panel-title">영업부별 재해 TOP 3</div>
            ${makeSummaryTopList(deptRows, 'dept')}
          </div>
          <div class="summary-panel summary-point-panel">
            <div class="summary-panel-title point-title">핵심 포인트</div>
            <div class="summary-point-list">
              <div>• 전월 대비 재해 <b>${esc(String(Math.abs(monthDiff)))}건 ${monthDiff <= 0 ? '감소' : '증가'}</b></div>
              <div>• 최다 재해유형은 <b>${esc(typeRows[0] ? typeRows[0].label : '-')}</b></div>
              <div>• 집중관리 영업부 <b>${esc(deptRows[0] ? deptRows[0].label : '-')}</b></div>
            </div>
          </div>
        </section>
      </section>
    `;
  } catch (err) {
    alert('요약 생성 오류: ' + (err.message || err));
  } finally {
    hideLoading();
  }
}

function makeSummaryKpiCard(title, value, subHtml, iconType) {
  return `
    <div class="summary-kpi-card">
      <div class="summary-kpi-icon ${iconType}">${getSummaryIconSvg(iconType)}</div>
      <div class="summary-kpi-text">
        <span>${esc(title)}</span>
        <strong>${esc(value)}</strong>
        ${subHtml || ''}
      </div>
    </div>
  `;
}

function getSummaryIconSvg(type) {
  if (type === 'shield') {
    return '<svg viewBox="0 0 64 64" aria-hidden="true"><path fill="#ff1a1a" d="M32 6l18 6v15c0 12-7 22-18 29C21 49 14 39 14 27V12l18-6z"></path><path fill="#fff" d="M28 18h8v10h10v8H36v10h-8V36H18v-8h10z"></path></svg>';
  }
  if (type === 'down') {
    return '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="#0a2f7d"></circle><path fill="#fff" d="M28 14h8v22h10L32 50 18 36h10z"></path></svg>';
  }
  return '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="#0a2f7d"></circle><rect x="16" y="34" width="8" height="14" rx="1" fill="#fff"></rect><rect x="28" y="26" width="8" height="22" rx="1" fill="#fff"></rect><rect x="40" y="18" width="8" height="30" rx="1" fill="#fff"></rect><path d="M18 22l10-8 8 7 11-11" stroke="#fff" stroke-width="3" fill="none"></path></svg>';
}

function makeSummaryYAxis(maxValue) {
  const step = Math.max(1, Math.ceil(maxValue / 5));
  const top = step * 5;
  return [top, top - step, top - step * 2, top - step * 3, top - step * 4, 0].map(v => `<span>${v}</span>`).join('');
}

function makeSummaryBar(month, value, maxValue, kind) {
  const pct = Math.max(4, Math.round((Number(value || 0) / Math.max(1, maxValue)) * 100));
  const cls = kind === 'current' ? 'current' : (kind === 'reference' ? 'reference' : 'actual');
  return `
    <div class="summary-bar-col ${cls}">
      <span class="summary-bar-value">${esc(value || 0)}</span>
      <div class="summary-bar-track"><div class="summary-bar-fill ${cls}" style="height:${pct}%"></div></div>
      <label>${month}월</label>
    </div>
  `;
}

function makeSummaryTrendPoints(values, maxValue, count) {
  if (!values.length) return '';
  const width = 900;
  const height = 240;
  const xGap = count > 1 ? width / (count - 1) : width;
  return values.map((v, i) => {
    const x = count > 1 ? i * xGap : width / 2;
    const y = height - (Number(v || 0) / Math.max(1, maxValue)) * (height - 20) - 10;
    return `${x},${Math.max(10, y)}`;
  }).join(' ');
}

function makeSummaryTrendDots(values, maxValue, count) {
  if (!values.length) return '';
  const width = 900;
  const height = 240;
  const xGap = count > 1 ? width / (count - 1) : width;
  return values.map((v, i) => {
    const x = count > 1 ? i * xGap : width / 2;
    const y = height - (Number(v || 0) / Math.max(1, maxValue)) * (height - 20) - 10;
    return `<circle cx="${x}" cy="${Math.max(10, y)}" r="7" fill="#ff1a1a"></circle>`;
  }).join('');
}

function makeSummaryDonut(topRows, allRows) {
  const rows = (allRows || []).filter(r => r.label !== '미분류');
  const baseRows = rows.length ? rows : topRows;
  const total = Math.max(1, baseRows.reduce((sum, r) => sum + Number(r.count || 0), 0));
  const colors = ['#0b2f86', '#ff1620', '#a9a9a9', '#d9d9d9', '#efefef'];
  let acc = 0;
  const stops = baseRows.slice(0, 5).map((r, i) => {
    const start = acc;
    const pct = (Number(r.count || 0) / total) * 100;
    acc += pct;
    return `${colors[i]} ${start.toFixed(1)}% ${acc.toFixed(1)}%`;
  });
  if (acc < 100) stops.push(`#f3f4f6 ${acc.toFixed(1)}% 100%`);
  return `
    <div class="summary-donut-wrap">
      <div class="summary-donut" style="background: conic-gradient(${stops.join(', ')})">
        <div class="summary-donut-center">주요<br>유형</div>
      </div>
      <div class="summary-donut-legend">
        ${baseRows.slice(0, 5).map((r, i) => `<div><span class="dot" style="background:${colors[i]}"></span><label>${esc(r.label)}</label><b>${((Number(r.count||0)/total)*100).toFixed(1)}%</b></div>`).join('')}
      </div>
    </div>
  `;
}

function makeSummaryTopList(rows, kind) {
  if (!rows || !rows.length) return '<div class="summary-empty">데이터 없음</div>';
  const total = Math.max(1, rows.reduce((sum, r) => sum + Number(r.count || 0), 0));
  const colors = kind === 'type' ? ['#0b2f86', '#ff1620', '#a9a9a9'] : ['#0b2f86', '#ff1620', '#a9a9a9'];
  const max = Math.max(1, ...rows.map(r => Number(r.count || 0)));
  return `
    <div class="summary-top-list">
      ${rows.slice(0, 3).map((r, i) => {
        const pct = Math.max(12, Math.round((Number(r.count || 0) / max) * 100));
        return `<div class="summary-top-item"><span class="rank" style="background:${colors[i]}">${i + 1}</span><label>${esc(r.label)}</label><div class="bar"><i style="width:${pct}%; background:${colors[i]}"></i></div><b>${esc(r.count)}건 (${((Number(r.count||0)/total)*100).toFixed(1)}%)</b></div>`;
      }).join('')}
    </div>
  `;
}

function getPreviousYearMonth(year, monthText) {
  let y = Number(year);
  let m = Number(String(monthText).replace('월', ''));
  m -= 1;
  if (m <= 0) {
    y -= 1;
    m = 12;
  }
  return { year: String(y), month: `${m}월` };
}

function getLastDayOfMonth(year, monthNum) {
  return String(new Date(Number(year), Number(monthNum), 0).getDate()).padStart(2, '0');
}

function formatMonthlyDiff(n) {
  n = Number(n || 0);
  if (n > 0) return `▲ ${n}건`;
  if (n < 0) return `▼ ${Math.abs(n)}건`;
  return '동일';
}

function getMonthlyDiffClass(n) {
  n = Number(n || 0);
  if (n > 0) return 'kpi-bad';
  if (n < 0) return 'kpi-good';
  return 'kpi-neutral';
}

function makeMonthlyKpiCard(title, value, sub, icon, cls) {
  return `
    <article class="monthly-kpi-card ${cls || ''}">
      <div class="monthly-kpi-icon">${icon}</div>
      <span>${esc(title)}</span>
      <strong>${esc(value)}</strong>
      <small>${esc(sub)}</small>
    </article>
  `;
}

function makeMonthlyBarList(rows, type) {
  if (!rows || !rows.length) {
    return '<div class="monthly-empty">해당 월 데이터가 없습니다.</div>';
  }
  const max = Math.max(...rows.map(r => Number(r.count || 0)), 1);
  return `
    <div class="monthly-bar-list">
      ${rows.map((r, i) => {
        const count = Number(r.count || 0);
        const width = Math.max(8, Math.round((count / max) * 100));
        return `
          <div class="monthly-bar-row">
            <div class="monthly-bar-label">
              <span>${i + 1}</span>
              <strong>${esc(r.label || '-')}</strong>
            </div>
            <div class="monthly-bar-track">
              <div class="monthly-bar-fill ${type === 'type' ? 'bar-red' : 'bar-blue'}" style="width:${width}%"></div>
            </div>
            <b>${count}건</b>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function makeMonthlyRepeatList(rows) {
  if (!rows || !rows.length) {
    return '<div class="monthly-empty">반복사고 매장이 없습니다.</div>';
  }
  return `
    <div class="monthly-repeat-list">
      ${rows.map((r, i) => `
        <div class="monthly-repeat-item ${i === 0 ? 'first' : ''}">
          <span>${i + 1}</span>
          <div>
            <strong>${esc(r.store || '-')}</strong>
            <small>${esc(cleanDeptName(r.dept || ''))} · ${esc(r.team || '-')} · ${esc(r.topType || '미분류')}</small>
          </div>
          <b>${esc(r.count || 0)}건</b>
        </div>
      `).join('')}
    </div>
  `;
}

function makeMonthlyCommentList(typeRows, deptRows, repeatRows) {
  const topType = typeRows && typeRows.length ? typeRows[0].label : '주요 재해유형';
  const topDept = deptRows && deptRows.length ? cleanDeptName(deptRows[0].label) : '발생 상위 영업부';
  const repeatText = repeatRows && repeatRows.length ? '반복사고 매장 현장 확인 및 개선조치 필요' : '반복사고 매장은 현재 낮은 수준 유지';

  const comments = [
    `${topType} 사고 예방 중심으로 TBM·작업 전 주의사항을 강화`,
    `${topDept} 중심으로 사고 발생 원인과 작업동선 재점검`,
    repeatText
  ];

  return `
    <div class="monthly-comment-list">
      ${comments.map((c, i) => `
        <div class="monthly-comment-item">
          <span>${i + 1}</span>
          <p>${esc(c)}</p>
        </div>
      `).join('')}
    </div>
  `;
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

  const yoyMap = {};
  if (!isSingleBar) {
    (yoyRows || []).forEach(r => { yoyMap[cleanDeptName(r.label)] = r.count; });
  }

  const datasets = [
    {
      label: '금년',
      data: curCounts,
      backgroundColor: rankColors(labels.length),
      borderRadius: 4
    }
  ];

  state.captureCharts[chartKey] = new Chart(ctx, {
    type: 'bar',
    data: { labels: labels, datasets: datasets },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      responsive: true,
      maintainAspectRatio: false,
      animation: false, 
      events: ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove'],
      layout: {
        padding: {
          right: horizontal ? 65 : 10,
          top: horizontal ? 10 : 25
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          callbacks: {
            title: function(context) { return context[0].label; },
            label: function(context) {
              const idx = context.dataIndex;
              const labelName = context.chart.data.labels[idx];
              const curVal = context.chart.data.datasets[0].data[idx] || 0;
              const lines = [`금년: ${curVal}건`];
              if (!isSingleBar) {
                const yoyVal = yoyMap[labelName] || 0;
                lines.push(`전년: ${yoyVal}건`);
                const diff = curVal - yoyVal;
                let diffText = '동일';
                if (diff > 0) diffText = `▲ ${diff}건 상승`;
                else if (diff < 0) diffText = `▼ ${Math.abs(diff)}건 하락`;
                lines.push(`전년대비: ${diffText}`);
              }
              return lines;
            }
          }
        },
        datalabels: {
          anchor: 'end',
          align: 'end',
          offset: -2,
          font: { weight: 'bold', size: 12 }, 
          formatter: function(value, context) {
            return `${value}건`;
          },
          color: function(context) {
            return (isSingleBar || context.datasetIndex === 0) ? '#0f172a' : '#64748b';
          }
        }
      },
      scales: {
        x: { 
          display: !horizontal, 
          grid: { display: false }, 
          ticks: { font: { size: 12, weight: 'bold' } } 
        },
        y: { 
          display: horizontal, 
          grid: { display: false }, 
          beginAtZero: true, 
          ticks: { font: { size: 12, weight: 'bold' } } 
        }
      }
    },
    plugins: [ChartDataLabels]
  });
}

function closeCaptureMode() {
  const modal = $('captureModal');
  if (modal) modal.classList.add('hidden');
  const board = modal ? modal.querySelector('.capture-board') : null;
  if (board) { board.classList.remove('monthly-report-board'); board.classList.remove('summary-report-board'); }
  const body = $('captureBody');
  if (body) body.className = 'capture-body-grid';
  
  ['type', 'dept'].forEach(k => {
    if (state.captureCharts[k]) {
      state.captureCharts[k].destroy();
      state.captureCharts[k] = null;
    }
  });
}

async function downloadCaptureImage() {
  const target = document.querySelector('#summaryReportPage') || document.querySelector('.capture-board');
  if (!target) return;

  showLoading('이미지 파일 생성 중입니다...');

  const body = $('captureBody');
  const prevTransform = target.style.transform;
  const prevMargin = target.style.margin;

  try {
    target.classList.add('capturing');
    if (body) body.classList.add('summary-exporting');

    // 미리보기 축소/스크롤 영향을 제거하고 보고서 본문만 정확히 16:9로 저장합니다.
    target.style.transform = 'none';
    target.style.margin = '0';

    await new Promise(resolve => requestAnimationFrame(resolve));

    const canvas = await html2canvas(target, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      width: 1280,
      height: 720,
      windowWidth: 1280,
      windowHeight: 720,
      scrollX: 0,
      scrollY: 0
    });

    const imgData = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = imgData;
    link.download = `산업재해_현황_요약_${state.year}년_${state.month}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (err) {
    alert('이미지 다운로드 중 오류 발생: ' + (err.message || err));
  } finally {
    target.classList.remove('capturing');
    if (body) body.classList.remove('summary-exporting');
    target.style.transform = prevTransform;
    target.style.margin = prevMargin;
    hideLoading();
  }
}
