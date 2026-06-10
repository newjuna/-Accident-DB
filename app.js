/* ============================================================
 *  산업재해 현황 분석 대시보드 v15.0 — 클라이언트
 *
 *  ■ Apps Script 배포 URL을 아래 API_URL에 붙여넣으세요.
 *  ■ 변경사항 v15.0:
 *    - 대시보드 화면 내 미니 반복사고 리스트 패널 제거
 *    - 차트 클릭 시 팝업 띄우는 기능 전면 제거 (차트 클릭 불가 처리)
 *    - 차트 내 데이터라벨 및 축 텍스트 크기 확대 (12px bold)
 *    - 가로 막대 차트 Y축(부서명/팀명) 표시 롤백, X축 수치 스케일 완전 제거
 *    - 로그인 후 병렬 비동기 통신 처리로 로딩 속도 단축
 *    - 데이터 조회: 연도 선택 ➡️ 월 ➡️ 영업부 ➡️ 팀 순서로 드롭다운 순차 동적 생성
 *    - 데이터 조회: 조회 버튼 제거, 드롭다운 변경 시 자동 실시간 쿼리 및 렌더링
 *    - 데이터 조회: 초기화 클릭 시 연도 필터만 남기고 클리어
 *    - 상세 팝업 호출 시의 대기용 로딩 오버레이 팝업 원복
 *    - 반복사고 분포 맵: 2건 이상 발생한 영업부만 맵에 렌더링
 *    - 분포 맵 클릭 시 팝업을 띄우지 않고, 우측의 매장 리스트 테이블을 실시간 필터링 연동
 *    - 로그아웃 테두리 제거 및 붉은색 텍스트 변경
 *    - 로그인 창 로고 중앙 정렬 및 서브 타이틀 문구 제거
 * ============================================================ */

// ★★★ 여기에 Apps Script 배포 URL을 붙여넣으세요 ★★★
const API_URL = 'https://script.google.com/macros/s/AKfycbxkJ98XNaLD7GW-ToGUEu7NPlB9-VkbtzCQ0QQMa7miiF1nyXU9yonu0QKh97q_XxvZkA/exec'; 

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
  listRows: [],
  listPage: 1,
  listModalMode: 'table',
  listModalContext: null,
  
  // 데이터 조회 전용 상태 및 순차 필터링용 옵션 백업
  dataRows: [],
  dataPage: 1,
  initFilterData: null, // 초기 필터 정보 캐시
  
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
  state.selectedRegionFilter = null; // 대시보드 갱신 시 맵 필터 해제
  renderRepeatFull();
  renderRegionMap();
}

/* ============ 차트 그리기 (v7.0: 클릭 비활성화, 텍스트 크기 확대 12px, 수치 스케일 제거) ============ */
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
    state.listModalMode = (chartType === 'store') ? 'cards' : 'table';
    state.listModalContext = { chartType, label };
    $('listModalTitle').textContent = cleanDeptName(label || '') + ' 사고 리스트 (' + state.listRows.length + '건)';

    const listModal = $('listModal');
    const listModalBox = listModal ? listModal.querySelector('.modal-box') : null;
    if (listModalBox) {
      listModalBox.classList.toggle('list-card-mode', state.listModalMode === 'cards');
      listModalBox.classList.toggle('wide', true);
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

  if (state.listModalMode === 'cards') {
    listModalBody.innerHTML = makeRepeatStoreCardList(pageRows, state.listRows);
  } else {
    listModalBody.innerHTML = makeRecordTable(pageRows, true);
  }
}

function getAccidentTypeTone(type) {
  const t = String(type || '').trim();
  if (!t) return 'tone-gray';
  if (/(깔림|끼임|절단|베임|협착)/.test(t)) return 'tone-red';
  if (/(무리한 동작|근골격|요통|통증)/.test(t)) return 'tone-green';
  if (/(넘어짐|전도|부딪힘|충돌|미끄러짐)/.test(t)) return 'tone-blue';
  return 'tone-gray';
}

function makeRepeatStoreCardList(pageRows, allRows) {
  const totalRows = allRows || [];
  if (!pageRows || !pageRows.length) {
    return '<div class="empty-message">조회된 사고가 없습니다.</div>';
  }

  const first = totalRows[0] || pageRows[0] || {};
  const chips = [];
  if (first.stdDept) chips.push(`<span class="list-modal-chip">${esc(cleanDeptName(first.stdDept))}</span>`);
  if (first.stdTeam) chips.push(`<span class="list-modal-chip">${esc(first.stdTeam)}</span>`);

  const metaHtml = chips.length ? `<div class="list-modal-meta">${chips.join('')}</div>` : '';

  const cardsHtml = pageRows.map(r => {
    const tone = getAccidentTypeTone(r.accidentType);
    return `
      <button type="button" class="accident-list-card ${tone}" onclick="openDetail('${escapeAttr(r.recordId)}')">
        <div class="accident-list-card-head">
          <div class="accident-date-wrap">
            <span class="accident-date-icon">🗓</span>
            <span class="accident-date-text">${esc(r.accidentDate)}</span>
          </div>
          <span class="accident-type-badge ${tone}">${esc(r.accidentType || '기타')}</span>
        </div>
        <div class="accident-store-name">${esc(r.store || '')}</div>
        <div class="accident-summary-box ${tone}">${esc(r.accidentContent || '')}</div>
        <div class="accident-card-footer">
          <span class="accident-card-meta"><span class="meta-ico">🏬</span>${esc(cleanDeptName(r.stdDept || ''))}</span>
          <span class="meta-dot">•</span>
          <span class="accident-card-meta"><span class="meta-ico">👤</span>${esc(r.stdTeam || '')}</span>
        </div>
      </button>
    `;
  }).join('');

  return `<div class="repeat-store-card-list">${metaHtml}<div class="accident-list-cards">${cardsHtml}</div></div>`;
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

/* ============ 사고 상세 팝업 (로딩창 노출 복원) ============ */
async function openDetail(recordId) {
  showLoading('사고 상세를 불러오는 중입니다'); // 로딩 오버레이 롤백
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
  } finally { hideLoading(); }
}
window.openDetail = openDetail;

function closeModals() {
  $('listModal').classList.add('hidden');
  $('detailModal').classList.add('hidden');
  state.listModalMode = 'table';
  state.listModalContext = null;
  const listModalBox = $('listModal') ? $('listModal').querySelector('.modal-box') : null;
  if (listModalBox) listModalBox.classList.remove('list-card-mode');
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
    repeatFullList.innerHTML = '<div class="empty-message">조건에 맞는 반복사고 매장이 없습니다.</div>';
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

/* ============ 반복사고 매장: 영업부별 가상 지역 맵 (v12.0: 매장 단위 최고 발생 건수 기준 정밀화) ============ */
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
    renderRepeatFull();
    renderRegionMap();
  }
}

/* ============ 데이터 조회: v8.0 간소화된 5단계 필터 및 AI 안전 보건 조언 멘트 연동 ============ */

/**
 * 5단계 필터 렌더링 (매장 및 유형 제거)
 */
function renderDataFilters() {
  const container = $('dataFiltersContainer');
  if (!container || !state.initFilterData) return;

  const init = state.initFilterData;
  const f = state.activeFilters;

  // 1. 연도 (기본 노출)
  let html = `<label>연도<select id="dataYear">`;
  const numericYears = init.years.filter(y => y !== '전체');
  numericYears.forEach(y => {
    html += `<option value="${y}" ${String(y) === String(f.year) ? 'selected' : ''}>${y}</option>`;
  });
  html += `</select></label>`;

  // 2. 월
  if (f.year) {
    const months = ['전체', '1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
    html += `<label>월<select id="dataMonth">`;
    months.forEach(m => {
      html += `<option value="${m}" ${String(m) === String(f.month) ? 'selected' : ''}>${m}</option>`;
    });
    html += `</select></label>`;
  }

  // 3. 영업부
  if (f.year && f.month) {
    html += `<label>영업부<select id="filterDept"><option value="전체">전체</option>`;
    (init.departments || []).forEach(d => {
      html += `<option value="${d}" ${String(d) === String(f.dept) ? 'selected' : ''}>${cleanDeptName(d)}</option>`;
    });
    html += `</select></label>`;
  }

  // 4. 팀 (영업부 선택 시 동적 생성)
  if (f.year && f.month && f.dept && f.dept !== '전체') {
    const filteredTeams = getFilteredTeams_(f.dept);
    html += `<label>팀<select id="filterTeam"><option value="전체">전체</option>`;
    filteredTeams.forEach(t => {
      html += `<option value="${t}" ${String(t) === String(f.team) ? 'selected' : ''}>${t}</option>`;
    });
    html += `</select></label>`;
  }

  // 5. 매장명 검색 (팀까지 렌더링 시 노출)
  if (f.year && f.month && f.dept && f.dept !== '전체') {
    html += `<label>매장명 검색<input id="filterStoreSearch" value="${esc(f.storeSearch)}" placeholder="매장명 입력"></label>`;
  }

  container.innerHTML = html;

  // 이벤트 핸들러 바인딩 및 자동 실시간 조회 연동
  const selYear = $('dataYear');
  if (selYear) selYear.addEventListener('change', (e) => { f.year = e.target.value; renderDataFilters(); loadDataTable(); });

  const selMonth = $('dataMonth');
  if (selMonth) selMonth.addEventListener('change', (e) => { f.month = e.target.value; renderDataFilters(); loadDataTable(); });

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
    txtSearch.addEventListener('input', (e) => { f.storeSearch = e.target.value; triggerAiAdviceTimer(); }); // 타이핑 마다 AI 타이머 재연장
    txtSearch.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadDataTable(); });
  }
}

function getFilteredTeams_(dept) {
  const init = state.initFilterData;
  if (!init) return [];
  const teams = new Set();
  state.dataRows.forEach(r => {
    if (r.stdDept === dept && r.stdTeam) teams.add(r.stdTeam);
  });
  return [...teams].sort();
}

/**
 * 실시간 자동 쿼리 수행
 */
async function loadDataTable() {
  const f = state.activeFilters;
  if (!f.year || !f.month) return;

  showLoading('데이터 조회 중입니다');
  try {
    const queryFilters = {
      year: f.year,
      month: f.month,
      dept: f.dept,
      team: f.team,
      store: '전체', // API 파라미터는 백엔드 호환성을 위해 고정값 유지
      type: '전체',
      storeSearch: f.storeSearch
    };
    const res = await callAPI({ action: 'query', division: state.division, filters: JSON.stringify(queryFilters) });
    state.dataRows = res.rows || [];
    state.dataPage = 1;
    renderDataTablePage();
    
    // 조회가 끝나면 AI 안전 진단 타이머(5초 디바운스) 작동 시작
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
 * 필터 리셋 (v12.0: AI 조언 박스 대기상태 복원 및 타이머 정지)
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
    resultContainer.innerHTML = `<p style="font-weight: 1000; color: var(--navy); font-size: 15px; margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">📋 사고 데이터 목록 (총 ${state.dataRows.length}건)</p>` +
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

  modal.classList.remove('hidden');

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
    
    <div class="panel">
      <h3>재해유형별 건수 (TOP 5)</h3>
      <div class="chart-container"><canvas id="captureTypeChart"></canvas></div>
    </div>
    <div class="panel">
      <h3>영업부별 재해 건수 (TOP 5)</h3>
      <div class="chart-container"><canvas id="captureDeptChart"></canvas></div>
    </div>
  `;

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
  
  ['type', 'dept'].forEach(k => {
    if (state.captureCharts[k]) {
      state.captureCharts[k].destroy();
      state.captureCharts[k] = null;
    }
  });
}

async function downloadCaptureImage() {
  const board = document.querySelector('.capture-board');
  if (!board) return;

  showLoading('이미지 파일 생성 중입니다...');

  try {
    board.classList.add('capturing');

    const canvas = await html2canvas(board, {
      scale: 2, 
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false
    });

    const imgData = canvas.toDataURL('image/png');

    const link = document.createElement('a');
    link.href = imgData;
    link.download = `산업재해_현황_분석_보고서_${state.year}년_${state.month}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

  } catch (err) {
    alert('이미지 다운로드 중 오류 발생: ' + (err.message || err));
  } finally {
    board.classList.remove('capturing');
    hideLoading();
  }
}
