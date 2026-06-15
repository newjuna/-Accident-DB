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

  // 산재승인 조회 전용 상태(안전보건팀 로그인 전용)
  approvalBaseRows: [],
  approvalRows: [],
  approvalTrendRows: [],
  approvalDataLoaded: false,
  approvalPage: 1,
  approvalSevereRows: [],
  severePage: 1,
  approvalFilters: {
    year: '',
    month: '전체',
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
  currentSummarySvg: null,
  currentSummarySvgs: [],
  currentSummaryFileName: null,
  currentSummaryZipName: null,

  currentView: 'dashboard'
};

const PAGE_SIZE_MODAL = 5;
const PAGE_SIZE_DATA = 10;
const PAGE_SIZE_REPEAT = 10;
const PAGE_SIZE_APPROVAL = 10; 

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

function isSafetyTeamLogin() {
  return state.division === '안전보건팀';
}

function toggleSafetyOnlyFeatures() {
  const group = $('approvalMenuGroup');
  if (group) group.classList.toggle('hidden', !isSafetyTeamLogin());
}

function toggleNavSection(targetId) {
  const body = $(targetId);
  if (!body) return;
  const section = body.closest('.nav-section');
  if (!section) return;
  section.classList.toggle('collapsed');
}

function expandNavGroupForView(view) {
  const isApproval = ['approval', 'approvalData', 'approvalSevere'].includes(view);
  const accident = $('accidentMenuGroup');
  const approval = $('approvalMenuGroup');
  if (accident) accident.classList.toggle('collapsed', isApproval);
  if (approval && !approval.classList.contains('hidden')) approval.classList.toggle('collapsed', !isApproval);
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
  if ($('approvalSummaryBtn')) $('approvalSummaryBtn').addEventListener('click', openApprovalCaptureMode);
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

  // 산재승인 조회 페이지네이션
  if ($('approvalPrev')) $('approvalPrev').addEventListener('click', () => {
    if (state.approvalPage > 1) { state.approvalPage--; renderApprovalTablePage(); }
  });
  if ($('approvalNext')) $('approvalNext').addEventListener('click', () => {
    const max = Math.max(1, Math.ceil(state.approvalRows.length / PAGE_SIZE_APPROVAL));
    if (state.approvalPage < max) { state.approvalPage++; renderApprovalTablePage(); }
  });

  // 중상해 매장 페이지네이션
  if ($('severePrev')) $('severePrev').addEventListener('click', () => {
    if (state.severePage > 1) { state.severePage--; renderSevereStorePage(); }
  });
  if ($('severeNext')) $('severeNext').addEventListener('click', () => {
    const max = Math.max(1, Math.ceil(state.approvalSevereRows.length / PAGE_SIZE_APPROVAL));
    if (state.severePage < max) { state.severePage++; renderSevereStorePage(); }
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
  document.querySelectorAll('.nav-section-toggle').forEach(btn =>
    btn.addEventListener('click', () => toggleNavSection(btn.dataset.target))
  );
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
    toggleSafetyOnlyFeatures();
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
    state.approvalFilters.year = init.defaultYear;
    state.approvalFilters.month = '전체';

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
  const approvalViews = ['approval', 'approvalData', 'approvalSevere'];
  if (approvalViews.includes(view) && !isSafetyTeamLogin()) {
    alert('산재 승인 사고 메뉴는 안전보건팀 로그인에서만 사용할 수 있습니다.');
    view = 'dashboard';
  }

  state.currentView = view;
  expandNavGroupForView(view);
  document.querySelectorAll('.nav[data-view]').forEach(b =>
    b.classList.toggle('active', b.dataset.view === view)
  );
  $('dashboardPage').classList.toggle('hidden', view !== 'dashboard');
  $('dataPage').classList.toggle('hidden', view !== 'data');
  $('repeatPage').classList.toggle('hidden', view !== 'repeat');
  if ($('approvalPage')) $('approvalPage').classList.toggle('hidden', view !== 'approval');
  if ($('approvalDataPage')) $('approvalDataPage').classList.toggle('hidden', view !== 'approvalData');
  if ($('approvalSeverePage')) $('approvalSeverePage').classList.toggle('hidden', view !== 'approvalSevere');
  
  if (view === 'data') {
    renderDataFilters();
    renderDataTablePage();
  }
  if (view === 'repeat') {
    state.selectedRegionFilter = null;
    state.repeatPage = 1;
    renderRepeatFull();
    renderRegionMap();
  }
  if (view === 'approval') {
    if (!state.approvalFilters.year && state.initFilterData) {
      state.approvalFilters.year = state.initFilterData.defaultYear || state.currentYear;
    }
    if (state.approvalDataLoaded) loadApprovalDashboardData({ skipQuery: true });
    else loadApprovalDashboardData({ loadingMessage: '산재 승인 사고 대시보드를 불러오는 중입니다' });
  }
  if (view === 'approvalData') {
    if (!state.approvalFilters.year && state.initFilterData) {
      state.approvalFilters.year = state.initFilterData.defaultYear || state.currentYear;
    }
    if (state.approvalDataLoaded) {
      state.approvalRows = applyApprovalClientFilters(state.approvalBaseRows);
      state.approvalPage = 1;
      renderApprovalFilters();
      renderApprovalTablePage();
    } else {
      loadApprovalData({ loadingMessage: '산재 승인 사고 데이터를 불러오는 중입니다' });
    }
  }
  if (view === 'approvalSevere') {
    if (!state.approvalFilters.year && state.initFilterData) {
      state.approvalFilters.year = state.initFilterData.defaultYear || state.currentYear;
    }
    if (state.approvalDataLoaded) {
      state.approvalRows = applyApprovalClientFilters(state.approvalBaseRows);
      state.approvalSevereRows = getSevereStoreGroups(state.approvalRows);
      state.severePage = 1;
      renderSevereFilters();
      renderSevereKpis();
      renderSevereStorePage();
    } else {
      loadSevereStoreData({ loadingMessage: '중상해 매장 데이터를 불러오는 중입니다' });
    }
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


/* ============ 산재 승인 사고 공통/대시보드/데이터조회/중상해매장 ============ */

function getApprovalMonthOptions() {
  return ['전체', '1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
}

function isApprovedRow(r) {
  return String((r || {}).approvalYn || '').trim().toUpperCase() === 'Y';
}

function getKpiTargetCategories() {
  return ['넘어짐', '무리한 동작', '물체에 맞음'];
}

function isKpiTargetCategory(v) {
  return getKpiTargetCategories().includes(String(v || '').trim());
}

function isApprovalCommuteRow(r) {
  return String((r || {}).kpiCategory || '').includes('출퇴근');
}

function isApprovalDashboardRow(r) {
  return isApprovedRow(r) && !isApprovalCommuteRow(r);
}

function isSevereRow(r) {
  return isApprovalDashboardRow(r) && Number(r.lostDays || 0) >= 91;
}

function sumLostDays(rows) {
  return (rows || []).reduce((s, r) => s + (Number(r.lostDays || 0) || 0), 0);
}

function uniqueValues(rows, field) {
  return [...new Set((rows || []).map(r => r[field]).filter(Boolean))].sort();
}

function getApprovalVisibleBaseRows(rows) {
  return (rows || []).filter(isApprovalDashboardRow);
}

function applyApprovalClientFilters(rows) {
  const f = state.approvalFilters;
  let out = getApprovalVisibleBaseRows(rows);
  if (f.dept && f.dept !== '전체') out = out.filter(r => r.stdDept === f.dept);
  if (f.team && f.team !== '전체') out = out.filter(r => r.stdTeam === f.team);
  return out;
}

function getApprovalStats(rows) {
  const visibleRows = getApprovalVisibleBaseRows(rows || []);
  const kpiRows = visibleRows.filter(r => isKpiTargetCategory(r.kpiCategory));
  const severeRows = visibleRows.filter(isSevereRow);
  const lostDays = sumLostDays(visibleRows);
  const severeStores = getSevereStoreGroups(visibleRows);

  const typeCounts = makeCountRows_(visibleRows, 'accidentType').slice(0, 5);
  const deptCounts = makeCountRows_(visibleRows, 'stdDept').map(r => ({ ...r, label: cleanDeptName(r.label) })).slice(0, 5);
  const teamCounts = makeCountRows_(visibleRows, 'stdTeam').slice(0, 5);
  const lossByDept = makeSumRows_(visibleRows, 'stdDept', 'lostDays').map(r => ({ ...r, label: cleanDeptName(r.label) })).slice(0, 5);

  return { visibleRows, kpiRows, severeRows, lostDays, severeStores, typeCounts, deptCounts, teamCounts, lossByDept };
}

function makeCountRows_(rows, field) {
  const o = {};
  (rows || []).forEach(r => {
    const key = String(r[field] || '미분류').trim() || '미분류';
    o[key] = (o[key] || 0) + 1;
  });
  return Object.keys(o).map(label => ({ label, count: o[label] })).sort((a, b) => b.count - a.count);
}

function makeSumRows_(rows, groupField, sumField) {
  const o = {};
  (rows || []).forEach(r => {
    const key = String(r[groupField] || '미분류').trim() || '미분류';
    o[key] = (o[key] || 0) + (Number(r[sumField] || 0) || 0);
  });
  return Object.keys(o).map(label => ({ label, count: o[label] })).sort((a, b) => b.count - a.count);
}

function getSevereStoreGroups(rows) {
  const severe = (rows || []).filter(isSevereRow);
  const groups = {};
  severe.forEach(r => {
    const store = r.store || '미분류';
    if (!groups[store]) {
      groups[store] = {
        store,
        dept: r.stdDept || '-',
        team: r.stdTeam || '-',
        count: 0,
        totalLostDays: 0,
        maxLostDays: 0,
        latestDate: '',
        firstRecordId: '',
        types: {},
        rows: []
      };
    }
    const g = groups[store];
    const lost = Number(r.lostDays || 0) || 0;
    g.count += 1;
    g.totalLostDays += lost;
    g.maxLostDays = Math.max(g.maxLostDays, lost);
    g.types[r.accidentType || '미분류'] = (g.types[r.accidentType || '미분류'] || 0) + 1;
    g.rows.push(r);
    if (!g.latestDate || String(r.accidentDate || '').localeCompare(String(g.latestDate)) > 0) {
      g.latestDate = r.accidentDate || '';
      g.firstRecordId = r.recordId || '';
    }
  });
  return Object.values(groups).map(g => {
    const topType = Object.keys(g.types).sort((a, b) => g.types[b] - g.types[a])[0] || '-';
    return { ...g, topType };
  }).sort((a, b) => b.count - a.count || b.totalLostDays - a.totalLostDays || b.maxLostDays - a.maxLostDays).slice(0, 50);
}

function renderApprovalDashboardFilters() {
  const container = $('approvalDashboardFilters');
  if (!container || !state.initFilterData) return;
  const f = state.approvalFilters;
  const years = state.initFilterData.years && state.initFilterData.years.length
    ? state.initFilterData.years
    : ['전체', '2026'];

  container.innerHTML = `
    <label>기준연도<select id="approvalDashYear">
      ${years.map(y => `<option value="${esc(y)}" ${String(y) === String(f.year) ? 'selected' : ''}>${esc(y)}</option>`).join('')}
    </select></label>
    <label>기준월<select id="approvalDashMonth">
      ${getApprovalMonthOptions().map(m => `<option value="${esc(m)}" ${String(m) === String(f.month) ? 'selected' : ''}>${esc(m)}</option>`).join('')}
    </select></label>`;

  const reload = () => loadApprovalDashboardData();
  $('approvalDashYear').addEventListener('change', e => {
    f.year = e.target.value;
    f.dept = '전체';
    f.team = '전체';
    f.storeSearch = '';
    loadApprovalDashboardData();
  });
  $('approvalDashMonth').addEventListener('change', e => {
    f.month = e.target.value;
    f.dept = '전체';
    f.team = '전체';
    f.storeSearch = '';
    loadApprovalDashboardData();
  });
}

async function loadApprovalDashboardData(options = {}) {
  if (!isSafetyTeamLogin()) return;
  const f = state.approvalFilters;
  if (!f.year) f.year = state.initFilterData ? state.initFilterData.defaultYear : state.currentYear;
  if (!options.skipQuery) showLoading(options.loadingMessage || '산재 승인 사고 대시보드를 조회 중입니다');
  try {
    if (!options.skipQuery) {
      const currentFilters = { year: f.year, month: f.month || '전체', dept: '전체', team: '전체', store: '전체', type: '전체', storeSearch: f.storeSearch || '' };
      const trendFilters = { year: '전체', month: f.month || '전체', dept: '전체', team: '전체', store: '전체', type: '전체', storeSearch: f.storeSearch || '' };
      const [currentRes, trendRes] = await Promise.all([
        callAPI({ action: 'query', division: '안전보건팀', filters: JSON.stringify(currentFilters) }),
        callAPI({ action: 'query', division: '안전보건팀', filters: JSON.stringify(trendFilters) })
      ]);
      state.approvalBaseRows = currentRes.rows || [];
      state.approvalTrendRows = trendRes.rows || [];
      state.approvalDataLoaded = true;
    }
    state.approvalRows = applyApprovalClientFilters(state.approvalBaseRows);
    renderApprovalDashboardFilters();
    renderApprovalKpis();
    renderApprovalTrendChart();
    renderApprovalCharts();
  } catch (err) {
    alert('산재 승인 사고 대시보드 오류: ' + (err.message || err));
  } finally {
    if (!options.skipQuery) hideLoading();
  }
}

function renderApprovalKpis() {
  const grid = $('approvalKpiGrid');
  if (!grid) return;
  const stats = getApprovalStats(state.approvalRows || []);
  const multiSevereStores = stats.severeStores.filter(s => s.count >= 2).length;

  grid.innerHTML = `
    <article class="approval-kpi-card approval-kpi-approved">
      <span>산업재해 승인 건수</span>
      <strong>${stats.visibleRows.length}건</strong>
      <small></small>
    </article>
    <article class="approval-kpi-card approval-kpi-target">
      <span>3대 재해</span>
      <strong>${stats.kpiRows.length}건</strong>
      <small>넘어짐·무리한 동작·물체에 맞음</small>
    </article>
    <article class="approval-kpi-card approval-kpi-days">
      <span>총 근로손실일수</span>
      <strong>${stats.lostDays.toLocaleString()}일</strong>
      <small></small>
    </article>
    <article class="approval-kpi-card approval-kpi-severe">
      <span>91일 이상 재해</span>
      <strong>${stats.severeRows.length}건</strong>
      <small>산업재해 승인 건수</small>
    </article>
  `;
}

function getApprovalTrendRowsForCurrentFilters() {
  const f = state.approvalFilters;
  let out = getApprovalVisibleBaseRows(state.approvalTrendRows || []);
  if (f.dept && f.dept !== '전체') out = out.filter(r => r.stdDept === f.dept);
  if (f.team && f.team !== '전체') out = out.filter(r => r.stdTeam === f.team);
  return out;
}

function getApprovalThreeYearCounts() {
  const years = ['2024', '2025', '2026'];
  const rows = getApprovalTrendRowsForCurrentFilters();
  return years.map(year => ({
    year,
    count: rows.filter(r => String(r.year) === String(year)).length
  }));
}

function renderApprovalTrendChart() {
  const panel = $('approvalTrendPanel');
  if (!panel) return;
  const data = getApprovalThreeYearCounts();
  const max = Math.max(1, ...data.map(d => d.count));
  const yearsText = data.map(d => `${d.year}년 ${d.count}건`).join(' · ');

  panel.innerHTML = `
    <div class="approval-trend-card approval-trend-card-v2">
      <div class="approval-trend-copy">
        <span>3개년 산업재해 승인 건수</span>
        <strong>2024 · 2025 · 2026</strong>
        <small>${state.approvalFilters.month === '전체' ? '연간 누적 기준' : state.approvalFilters.month + ' 기준'} / 출퇴근재해 제외</small>
      </div>
      <div class="approval-year-comparison" aria-label="3개년 산업재해 승인 건수 비교">
        ${data.map((d, i) => {
          const pct = Math.max(10, Math.round((d.count / max) * 100));
          return `
            <div class="approval-year-card ${i === data.length - 1 ? 'current' : ''}">
              <div class="approval-year-count">${d.count}<small>건</small></div>
              <div class="approval-year-bar"><span style="height:${pct}%"></span></div>
              <div class="approval-year-label">${d.year}</div>
            </div>`;
        }).join('')}
      </div>
      <div class="approval-trend-note">${esc(yearsText)}</div>
    </div>`;
}

function renderApprovalCharts() {
  const grid = $('approvalChartGrid');
  if (!grid) return;
  const stats = getApprovalStats(state.approvalRows || []);
  grid.innerHTML = `
    ${makeApprovalDonutPanel('재해유형 TOP 5', stats.typeCounts)}
    ${makeApprovalDeptTeamPanel(stats.deptCounts, stats.teamCounts)}
    ${makeApprovalLossSeverePanel(stats.lossByDept, stats.severeStores.slice(0, 5))}
  `;
}


function makeApprovalDonutPanel(title, rows) {
  const safeRows = (rows || []).slice(0, 5);
  const total = safeRows.reduce((s, r) => s + Number(r.count || 0), 0);
  const colors = ['#0b2f86', '#ff1a1a', '#f28c28', '#9aa0a6', '#f0b429'];
  let current = 0;
  const stops = safeRows.map((r, i) => {
    const value = total ? (Number(r.count || 0) / total) * 100 : 0;
    const start = current;
    current += value;
    return `${colors[i % colors.length]} ${start.toFixed(2)}% ${current.toFixed(2)}%`;
  }).join(', ');
  const donutStyle = total ? `background: conic-gradient(${stops});` : 'background:#edf0f5;';
  const tooltipRows = safeRows.map((r, i) => {
    const pct = total ? Math.round((Number(r.count || 0) / total) * 100) : 0;
    return `<div><span style="background:${colors[i % colors.length]}"></span><strong>${esc(r.label || '-')}</strong><b>${Number(r.count || 0).toLocaleString()}건 · ${pct}%</b></div>`;
  }).join('');
  const tooltip = safeRows.length ? `<div class="approval-donut-tooltip">${tooltipRows}</div>` : '';
  const legend = safeRows.length ? safeRows.map((r, i) => `
    <div class="approval-donut-legend-row">
      <span style="background:${colors[i % colors.length]}"></span>
      <strong>${esc(r.label || '-')}</strong>
      <b>${Number(r.count || 0).toLocaleString()}건</b>
    </div>`).join('') : '<div class="empty-message compact">데이터가 없습니다.</div>';

  return `<section class="approval-chart-card approval-donut-card">
    <h3>${esc(title)}</h3>
    <div class="approval-donut-layout">
      <div class="approval-donut-wrap">
        <div class="approval-donut" style="${donutStyle}" title="${esc(safeRows.map(r => `${r.label}: ${r.count}건`).join(' / '))}"><em>${total.toLocaleString()}건</em></div>
        ${tooltip}
      </div>
      <div class="approval-donut-legend">${legend}</div>
    </div>
  </section>`;
}

function makeApprovalRankPanel(title, rows) {
  const body = (rows && rows.length) ? rows.slice(0, 5).map((r, i) => `
    <div class="approval-rank-row rank-${i+1}">
      <span>${i + 1}</span>
      <strong>${esc(r.label || '-')}</strong>
      <b>${Number(r.count || 0).toLocaleString()}건</b>
    </div>`).join('') : '<div class="empty-message compact">데이터가 없습니다.</div>';
  return `<section class="approval-chart-card approval-rank-card"><h3>${esc(title)}</h3>${body}</section>`;
}

function makeApprovalChipPanel(title, rows) {
  const body = (rows && rows.length) ? rows.slice(0, 5).map((r, i) => `
    <div class="approval-chip-item">
      <span>TOP ${i + 1}</span>
      <strong>${esc(r.label || '-')}</strong>
      <b>${Number(r.count || 0).toLocaleString()}건</b>
    </div>`).join('') : '<div class="empty-message compact">데이터가 없습니다.</div>';
  return `<section class="approval-chart-card approval-chip-card"><h3>${esc(title)}</h3><div class="approval-chip-grid">${body}</div></section>`;
}


function makeApprovalDeptTeamPanel(deptRows, teamRows) {
  const makeCol = (title, rows) => {
    const body = (rows && rows.length) ? rows.slice(0, 5).map((r, i) => `
      <div class="approval-combo-row">
        <span>${i + 1}</span>
        <strong>${esc(r.label || '-')}</strong>
        <b>${Number(r.count || 0).toLocaleString()}건</b>
      </div>`).join('') : '<div class="empty-message compact">데이터가 없습니다.</div>';
    return `<div class="approval-combo-col"><h4>${esc(title)}</h4>${body}</div>`;
  };

  return `<section class="approval-chart-card approval-combo-card">
    <h3>영업부·팀별 산재승인 TOP 5</h3>
    <div class="approval-combo-grid">
      ${makeCol('영업부별', deptRows)}
      ${makeCol('팀별', teamRows)}
    </div>
  </section>`;
}


function makeApprovalLossSeverePanel(lossRows, severeRows) {
  const makeLossCol = (rows) => {
    const max = Math.max(1, ...(rows || []).slice(0, 5).map(r => Number(r.count || 0)));
    return (rows && rows.length) ? rows.slice(0, 5).map((r, i) => {
      const w = Math.max(6, Math.round((Number(r.count || 0) / max) * 100));
      return `<div class="approval-loss-row">
        <span>${i + 1}</span>
        <strong>${esc(r.label || '-')}</strong>
        <div class="loss-track"><div style="width:${w}%"></div></div>
        <b>${Number(r.count || 0).toLocaleString()}일</b>
      </div>`;
    }).join('') : '<div class="empty-message compact">데이터가 없습니다.</div>';
  };

  const makeSevereCol = (rows) => {
    return (rows && rows.length) ? rows.slice(0, 5).map((r, i) => `
      <div class="approval-severe-mini-row ${r.count >= 2 ? 'risk' : ''}" onclick="openDetail('${escapeAttr(r.firstRecordId || '')}')">
        <span>${i + 1}</span>
        <div>
          <strong>${esc(r.store || '-')}</strong>
          <small>${esc(r.latestDate || '-')} · ${esc(cleanDeptName(r.dept || '-'))}</small>
        </div>
        <b>${Number(r.maxLostDays || 0).toLocaleString()}일</b>
      </div>`).join('') : '<div class="empty-message compact">91일 이상 재해 매장이 없습니다.</div>';
  };

  return `<section class="approval-chart-card approval-loss-severe-card">
    <h3>근로손실일수·91일 이상 재해 TOP 5</h3>
    <div class="approval-loss-severe-grid">
      <div class="approval-combo-col loss-col">
        <h4>영업부별 근로손실일수</h4>
        ${makeLossCol(lossRows)}
      </div>
      <div class="approval-combo-col severe-col">
        <h4>91일 이상 재해 매장</h4>
        ${makeSevereCol(severeRows)}
      </div>
    </div>
  </section>`;
}

function makeApprovalBarPanel(title, rows, tone = 'blue', unit = '건') {
  const max = Math.max(1, ...(rows || []).map(r => Number(r.count || 0)));
  const body = (rows && rows.length) ? rows.map((r, i) => {
    const w = Math.max(6, Math.round((Number(r.count || 0) / max) * 100));
    return `<div class="approval-mini-row">
      <span class="rank ${i === 0 ? 'first' : ''}">${i + 1}</span>
      <strong>${esc(r.label || '-')}</strong>
      <div class="mini-track"><div class="mini-fill ${tone}" style="width:${w}%"></div></div>
      <b>${Number(r.count || 0).toLocaleString()}${unit}</b>
    </div>`;
  }).join('') : '<div class="empty-message compact">데이터가 없습니다.</div>';
  return `<section class="approval-chart-card"><h3>${esc(title)}</h3>${body}</section>`;
}

function makeSevereStorePanel(rows) {
  const body = rows.length ? rows.slice(0, 5).map((r, i) => `
    <div class="severe-store-row ${r.count >= 2 ? 'risk' : ''}" onclick="openDetail('${escapeAttr(r.firstRecordId || '')}')">
      <span class="rank ${i === 0 ? 'first' : ''}">${i + 1}</span>
      <div>
        <strong>${esc(r.store || '-')}</strong>
        <small>${esc(r.latestDate || '-')} · ${esc(cleanDeptName(r.dept || '-'))} · ${esc(r.team || '-')} · ${esc(r.topType || '-')}</small>
      </div>
      <b>${r.count}건 / ${Number(r.maxLostDays || 0).toLocaleString()}일</b>
    </div>`).join('') : '<div class="empty-message compact">91일 이상 재해 매장이 없습니다.</div>';
  return `<section class="approval-chart-card severe-card-wide"><h3>91일 이상 재해 매장 TOP 5</h3>${body}</section>`;
}

function renderApprovalFilters() {
  const container = $('approvalFiltersContainer');
  if (!container || !state.initFilterData) return;
  const f = state.approvalFilters;
  const numericYears = (state.initFilterData.years || []).filter(y => y !== '전체');
  const baseRows = getApprovalVisibleBaseRows(state.approvalBaseRows || []);
  const deptOptions = uniqueValues(baseRows, 'stdDept');
  const teamSource = f.dept && f.dept !== '전체' ? baseRows.filter(r => r.stdDept === f.dept) : baseRows;
  const teamOptions = uniqueValues(teamSource, 'stdTeam');

  container.innerHTML = `
    <div class="approval-filter-head">
      <div><span>산재 승인 사고 데이터 조회 필터</span></div>
      <button type="button" id="approvalReloadBtn" class="btn-sub">조회</button>
    </div>
    <div class="approval-filter-row">
      <label>연도<select id="approvalYear">${numericYears.map(y => `<option value="${esc(y)}" ${String(y) === String(f.year) ? 'selected' : ''}>${esc(y)}</option>`).join('')}</select></label>
      <label>월<select id="approvalMonth">${getApprovalMonthOptions().map(m => `<option value="${esc(m)}" ${String(m) === String(f.month) ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
      <label>영업부<select id="approvalDept"><option value="전체">전체</option>${deptOptions.map(d => `<option value="${esc(d)}" ${String(d) === String(f.dept) ? 'selected' : ''}>${esc(cleanDeptName(d))}</option>`).join('')}</select></label>
      <label>팀<select id="approvalTeam"><option value="전체">전체</option>${teamOptions.map(t => `<option value="${esc(t)}" ${String(t) === String(f.team) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <label class="store-search-label">매장명 검색<input id="approvalStoreSearch" value="${esc(f.storeSearch)}" placeholder="매장명 입력"></label>
      <button type="button" id="approvalResetBtn" class="btn-sub btn-light">초기화</button>
    </div>`;

  const reload = () => loadApprovalData();
  const rerender = () => {
    state.approvalRows = applyApprovalClientFilters(state.approvalBaseRows);
    state.approvalPage = 1;
    renderApprovalFilters();
    renderApprovalTablePage();
  };
  $('approvalYear').addEventListener('change', e => { f.year = e.target.value; f.dept = '전체'; f.team = '전체'; reload(); });
  $('approvalMonth').addEventListener('change', e => { f.month = e.target.value; f.dept = '전체'; f.team = '전체'; reload(); });
  $('approvalDept').addEventListener('change', e => { f.dept = e.target.value; f.team = '전체'; rerender(); });
  $('approvalTeam').addEventListener('change', e => { f.team = e.target.value; rerender(); });
  $('approvalStoreSearch').addEventListener('input', e => { f.storeSearch = e.target.value; });
  $('approvalStoreSearch').addEventListener('keydown', e => { if (e.key === 'Enter') reload(); });
  $('approvalReloadBtn').addEventListener('click', reload);
  $('approvalResetBtn').addEventListener('click', () => resetApprovalFilters());
}

async function loadApprovalData(options = {}) {
  if (!isSafetyTeamLogin()) return;
  const f = state.approvalFilters;
  if (!f.year) f.year = state.initFilterData ? state.initFilterData.defaultYear : state.currentYear;
  showLoading(options.loadingMessage || '산재 승인 사고 데이터를 조회 중입니다');
  try {
    const queryFilters = { year: f.year, month: f.month || '전체', dept: '전체', team: '전체', store: '전체', type: '전체', storeSearch: f.storeSearch || '' };
    const res = await callAPI({ action: 'query', division: '안전보건팀', filters: JSON.stringify(queryFilters) });
    state.approvalBaseRows = res.rows || [];
    state.approvalDataLoaded = true;
    state.approvalRows = applyApprovalClientFilters(state.approvalBaseRows);
    state.approvalPage = 1;
    renderApprovalFilters();
    renderApprovalTablePage();
  } catch (err) {
    alert('산재 승인 사고 데이터 조회 오류: ' + (err.message || err));
  } finally {
    hideLoading();
  }
}

function resetApprovalFilters() {
  state.approvalFilters = { year: state.initFilterData ? state.initFilterData.defaultYear : state.currentYear, month: '전체', dept: '전체', team: '전체', storeSearch: '' };
  if (state.currentView === 'approval') loadApprovalDashboardData({ loadingMessage: '산재 승인 사고 대시보드를 초기화하는 중입니다' });
  else if (state.currentView === 'approvalSevere') loadSevereStoreData({ loadingMessage: '중상해 매장 조회 조건을 초기화하는 중입니다' });
  else loadApprovalData({ loadingMessage: '산재 승인 사고 조회 조건을 초기화하는 중입니다' });
}

function makeApprovalBadge(value, type) {
  const v = String(value || '').trim();
  if (type === 'approval') return v === 'Y' ? '<span class="approval-badge ok">승인</span>' : '<span class="approval-badge wait">미승인</span>';
  if (!v) return '<span class="approval-badge empty">공란</span>';
  if (isKpiTargetCategory(v)) return `<span class="approval-badge target">${esc(v)}</span>`;
  if (v.includes('미매칭')) return `<span class="approval-badge warn">${esc(v)}</span>`;
  return `<span class="approval-badge exclude">${esc(v)}</span>`;
}

function buildApprovalExcelFileName() {
  const f = state.approvalFilters || {};
  const parts = ['산재승인_업무상사고_KPI조회'];
  if (f.year) parts.push(String(f.year) + '년');
  if (f.month && f.month !== '전체') parts.push(String(f.month));
  if (f.dept && f.dept !== '전체') parts.push(cleanDeptName(f.dept));
  parts.push(String((state.approvalRows || []).length) + '건');
  return parts.join('_') + '.xlsx';
}

function downloadApprovalExcel() {
  const rows = state.approvalRows || [];
  if (!rows.length) return alert('다운로드할 산재 승인 사고 조회 결과가 없습니다.');
  if (typeof XLSX === 'undefined') return alert('엑셀 다운로드 라이브러리를 불러오지 못했습니다. 인터넷 연결 후 다시 시도해 주세요.');
  const fileName = buildApprovalExcelFileName();
  const title = fileName.replace(/\.xlsx$/i, '');
  const header = ['No', '재해일자', '영업부', '팀', '매장명', '재해유형', '산재승인 유무', '근로손실일수', 'KPI집계현황분류', '사고내용'];
  const dataRows = rows.map((r, i) => ([i + 1, r.accidentDate || '', cleanDeptName(r.stdDept || ''), r.stdTeam || '', r.store || '', r.accidentType || '', r.approvalYn || '', r.lostDays || '', r.kpiCategory || '', r.accidentContent || '']));
  makeStyledExcel_(title, header, dataRows, fileName, '산재승인KPI');
}
window.downloadApprovalExcel = downloadApprovalExcel;

function makeStyledExcel_(title, header, dataRows, fileName, sheetBaseName) {
  const aoa = [[title], [], [], header, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const lastRow = aoa.length;
  const lastCol = header.length;
  const tableStartRow = 4;
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: lastCol - 1 } }];
  ws['!cols'] = getAutoColumnWidths([header, ...dataRows]);
  ws['!rows'] = ws['!rows'] || [];
  ws['!rows'][0] = { hpt: 30 };
  ws['!rows'][3] = { hpt: 22 };
  const borderStyle = { top: { style: 'thin', color: { rgb: '808080' } }, bottom: { style: 'thin', color: { rgb: '808080' } }, left: { style: 'thin', color: { rgb: '808080' } }, right: { style: 'thin', color: { rgb: '808080' } } };
  const headerStyle = { font: { name: '맑은 고딕', bold: true, sz: 11, color: { rgb: '000000' } }, fill: { patternType: 'solid', fgColor: { rgb: 'DCE6F1' } }, border: borderStyle, alignment: { horizontal: 'center', vertical: 'center' } };
  const bodyStyle = { font: { name: '맑은 고딕', sz: 10, color: { rgb: '000000' } }, border: borderStyle, alignment: { vertical: 'top', wrapText: true } };
  const bodyCenterStyle = { ...bodyStyle, alignment: { horizontal: 'center', vertical: 'top', wrapText: true } };
  applyExcelCellStyle(ws, 'A1', { font: { name: '맑은 고딕', bold: true, sz: 20, color: { rgb: '000000' } }, alignment: { horizontal: 'left', vertical: 'center' } });
  for (let r = tableStartRow; r <= lastRow; r++) {
    for (let c = 1; c <= lastCol; c++) {
      const addr = XLSX.utils.encode_cell({ r: r - 1, c: c - 1 });
      applyExcelCellStyle(ws, addr, r === tableStartRow ? headerStyle : ([1, 2, 3, 4, 6, 7, 8, 9].includes(c) ? bodyCenterStyle : bodyStyle));
    }
  }
  ws['!freeze'] = { xSplit: 0, ySplit: 4 };
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: tableStartRow - 1, c: 0 }, e: { r: lastRow - 1, c: lastCol - 1 } }) };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (sheetBaseName + '_' + dataRows.length + '건').slice(0, 31));
  XLSX.writeFile(wb, fileName, { bookType: 'xlsx', cellStyles: true });
}

function renderApprovalTablePage() {
  const result = $('approvalResult');
  if (!result) return;
  const rows = state.approvalRows || [];
  const max = Math.max(1, Math.ceil(rows.length / PAGE_SIZE_APPROVAL));
  if (state.approvalPage > max) state.approvalPage = max;
  if (state.approvalPage < 1) state.approvalPage = 1;
  const start = (state.approvalPage - 1) * PAGE_SIZE_APPROVAL;
  const pageRows = rows.slice(start, start + PAGE_SIZE_APPROVAL);
  const pager = $('approvalPager');
  if (pager) pager.classList.toggle('hidden', rows.length <= PAGE_SIZE_APPROVAL);
  const pageInfo = $('approvalPageInfo');
  if (pageInfo) pageInfo.textContent = state.approvalPage + ' / ' + max;
  const excelButtonHtml = rows.length > 0 ? `<button type="button" class="excel-download-btn" onclick="downloadApprovalExcel()">📥 엑셀 다운로드</button>` : '';
  if (!pageRows.length) {
    result.innerHTML = `<div class="data-result-head"><div><span class="data-result-kicker">산재 승인 사고 조회 결과</span><strong>조회된 데이터가 없습니다.</strong></div><div class="data-result-actions"><span class="data-result-count">총 0건</span></div></div><div class="empty-message">조건에 맞는 산재 승인 사고 데이터가 없습니다.</div>`;
    return;
  }
  result.innerHTML = `
    <div class="data-result-head"><div><span class="data-result-kicker">산재 승인 사고 조회 결과</span><strong>산업재해 승인 건수/KPI 관리 목록</strong></div><div class="data-result-actions"><span class="data-result-count">총 ${rows.length}건</span>${excelButtonHtml}</div></div>
    <div class="approval-table-scroll"><table class="approval-table"><thead><tr><th>재해일자</th><th>영업부</th><th>팀</th><th>매장명</th><th>재해유형</th><th>산재승인</th><th>근로손실일수</th><th>KPI분류</th><th>사고내용</th></tr></thead><tbody>
      ${pageRows.map(r => `<tr onclick="openDetail('${escapeAttr(r.recordId)}')"><td>${esc(r.accidentDate || '-')}</td><td>${esc(cleanDeptName(r.stdDept || '-'))}</td><td>${esc(r.stdTeam || '-')}</td><td class="approval-store-cell">${esc(r.store || '-')}</td><td>${esc(r.accidentType || '미분류')}</td><td>${makeApprovalBadge(r.approvalYn, 'approval')}</td><td class="approval-days-cell">${esc(r.lostDays || '-')}</td><td>${makeApprovalBadge(r.kpiCategory, 'kpi')}</td><td class="approval-content-cell">${esc(shorten(r.accidentContent, 70))}</td></tr>`).join('')}
    </tbody></table></div>`;
}

function renderSevereFilters() {
  const container = $('severeFilterContainer');
  if (!container || !state.initFilterData) return;
  const f = state.approvalFilters;
  const numericYears = (state.initFilterData.years || []).filter(y => y !== '전체');
  container.innerHTML = `<div class="approval-filter-head"><div><span>중상해 매장 조회 필터</span></div><button type="button" id="severeReloadBtn" class="btn-sub">조회</button></div><div class="approval-filter-row"><label>연도<select id="severeYear">${numericYears.map(y => `<option value="${esc(y)}" ${String(y) === String(f.year) ? 'selected' : ''}>${esc(y)}</option>`).join('')}</select></label><label>월<select id="severeMonth">${getApprovalMonthOptions().map(m => `<option value="${esc(m)}" ${String(m) === String(f.month) ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label><label class="store-search-label">매장명 검색<input id="severeStoreSearch" value="${esc(f.storeSearch)}" placeholder="매장명 입력"></label><button type="button" id="severeResetBtn" class="btn-sub btn-light">초기화</button></div>`;
  $('severeYear').addEventListener('change', e => { f.year = e.target.value; loadSevereStoreData(); });
  $('severeMonth').addEventListener('change', e => { f.month = e.target.value; loadSevereStoreData(); });
  $('severeStoreSearch').addEventListener('input', e => { f.storeSearch = e.target.value; });
  $('severeStoreSearch').addEventListener('keydown', e => { if (e.key === 'Enter') loadSevereStoreData(); });
  $('severeReloadBtn').addEventListener('click', () => loadSevereStoreData());
  $('severeResetBtn').addEventListener('click', () => resetApprovalFilters());
}

async function loadSevereStoreData(options = {}) {
  if (!isSafetyTeamLogin()) return;
  const f = state.approvalFilters;
  if (!f.year) f.year = state.initFilterData ? state.initFilterData.defaultYear : state.currentYear;
  showLoading(options.loadingMessage || '중상해 매장 데이터를 조회 중입니다');
  try {
    const queryFilters = { year: f.year, month: f.month || '전체', dept: '전체', team: '전체', store: '전체', type: '전체', storeSearch: f.storeSearch || '' };
    const res = await callAPI({ action: 'query', division: '안전보건팀', filters: JSON.stringify(queryFilters) });
    state.approvalBaseRows = res.rows || [];
    state.approvalDataLoaded = true;
    state.approvalRows = applyApprovalClientFilters(state.approvalBaseRows);
    state.approvalSevereRows = getSevereStoreGroups(state.approvalRows);
    state.severePage = 1;
    renderSevereFilters();
    renderSevereKpis();
    renderSevereStorePage();
  } catch (err) {
    alert('중상해 매장 조회 오류: ' + (err.message || err));
  } finally {
    hideLoading();
  }
}

function renderSevereKpis() {
  const grid = $('severeKpiGrid');
  if (!grid) return;
  const severeRows = (state.approvalRows || []).filter(isSevereRow);
  const stores = getSevereStoreGroups(state.approvalRows || []);
  const riskStores = stores.filter(s => s.count >= 2);
  grid.innerHTML = `
    <article class="approval-kpi-card approval-kpi-severe">
      <span>91일 이상 재해</span>
      <strong>${severeRows.length}건</strong>
      <small>산업재해 승인 건수</small>
    </article>
    <article class="approval-kpi-card approval-kpi-approved">
      <span>발생 매장</span>
      <strong>${stores.length}개</strong>
      <small></small>
    </article>
    <article class="approval-kpi-card approval-kpi-target">
      <span>2건 이상 매장</span>
      <strong>${riskStores.length}개</strong>
      <small>집중 모니터링 대상</small>
    </article>
    <article class="approval-kpi-card approval-kpi-days">
      <span>중상해 근로손실일수</span>
      <strong>${sumLostDays(severeRows).toLocaleString()}일</strong>
      <small>91일 이상 건 합계</small>
    </article>`;
}

function renderSevereStorePage() {
  const result = $('severeResult');
  if (!result) return;
  const rows = state.approvalSevereRows || [];
  const max = Math.max(1, Math.ceil(rows.length / PAGE_SIZE_APPROVAL));
  if (state.severePage > max) state.severePage = max;
  const start = (state.severePage - 1) * PAGE_SIZE_APPROVAL;
  const pageRows = rows.slice(start, start + PAGE_SIZE_APPROVAL);
  if ($('severePager')) $('severePager').classList.toggle('hidden', rows.length <= PAGE_SIZE_APPROVAL);
  if ($('severePageInfo')) $('severePageInfo').textContent = state.severePage + ' / ' + max;
  if (!pageRows.length) {
    result.innerHTML = `<div class="data-result-head"><div><span class="data-result-kicker">중상해 매장</span><strong>조회된 매장이 없습니다.</strong></div><span class="data-result-count">총 0개</span></div><div class="empty-message">91일 이상 재해 매장이 없습니다.</div>`;
    return;
  }
  result.innerHTML = `<div class="data-result-head"><div><span class="data-result-kicker">중상해 매장</span><strong>91일 이상 재해 매장 목록</strong></div><span class="data-result-count">총 ${rows.length}개</span></div>
  <div class="approval-table-scroll"><table class="approval-table severe-table"><thead><tr><th>순위</th><th>매장명</th><th>재해일자</th><th>영업부</th><th>팀</th><th>91일 이상 건수</th><th>총 근로손실일수</th><th>최장 근로손실일수</th><th>주요 재해유형</th></tr></thead><tbody>
  ${pageRows.map((r, i) => `<tr class="${r.count >= 2 ? 'severe-risk-row' : ''}" onclick="openDetail('${escapeAttr(r.firstRecordId || '')}')"><td>${start + i + 1}</td><td class="approval-store-cell">${esc(r.store)}</td><td>${esc(r.latestDate || '-')}</td><td>${esc(cleanDeptName(r.dept))}</td><td>${esc(r.team)}</td><td><strong>${r.count}건</strong></td><td>${Number(r.totalLostDays || 0).toLocaleString()}일</td><td>${Number(r.maxLostDays || 0).toLocaleString()}일</td><td>${esc(r.topType)}</td></tr>`).join('')}
  </tbody></table></div>`;
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
    const logoDataUrl = await getLogoDataUrl();
    let pages = [];

    if (state.division === '안전보건팀') {
      const pageDefs = [
        { division: '수도권영업부문', label: '수도권영업부문', fileSuffix: '01_수도권영업부문', integrated: false },
        { division: '지방영업부문', label: '지방영업부문', fileSuffix: '02_지방영업부문', integrated: false },
        { division: '안전보건팀', label: '전체 통합(수도권+지방)', fileSuffix: '03_전체통합', integrated: true }
      ];

      pages = await Promise.all(pageDefs.map(def =>
        buildSummarySvgForDivision(def.division, def.label, selectedYear, selectedMonth, logoDataUrl, def.integrated)
          .then(svg => ({
            svg,
            label: def.label,
            fileName: `산업재해_현황_요약_${selectedYear}년_${selectedMonth}_${def.fileSuffix}.png`
          }))
      ));

      state.currentSummarySvgs = pages;
      state.currentSummarySvg = pages[0] ? pages[0].svg : null;
      state.currentSummaryFileName = pages[0] ? pages[0].fileName : null;
      state.currentSummaryZipName = `산업재해_현황_요약_${selectedYear}년_${selectedMonth}_안전보건팀_3장.zip`;
    } else {
      const svg = await buildSummarySvgForDivision(state.division, state.division, selectedYear, selectedMonth, logoDataUrl, false);
      pages = [{ svg, label: state.division, fileName: `산업재해_현황_요약_${selectedYear}년_${selectedMonth}.png` }];
      state.currentSummarySvg = svg;
      state.currentSummarySvgs = [];
      state.currentSummaryFileName = pages[0].fileName;
      state.currentSummaryZipName = null;
    }

    showSummaryPagesInModal(pages);
  } catch (err) {
    alert('요약 생성 오류: ' + (err.message || err));
  } finally {
    hideLoading();
  }
}

async function openApprovalCaptureMode() {
  const modal = $('captureModal');
  const body = $('captureBody');
  if (!modal || !body) return;

  const f = state.approvalFilters || {};
  const selectedYear = f.year || (state.initFilterData ? state.initFilterData.defaultYear : state.currentYear);
  const selectedMonth = f.month || '전체';

  if (!selectedYear || selectedYear === '전체' || !selectedMonth || selectedMonth === '전체') {
    alert('산재 승인 사고 요약 생성은 연도와 월을 선택한 뒤 실행해 주세요.');
    return;
  }

  showLoading('산재 승인 사고 요약 화면을 만드는 중입니다');

  try {
    const logoDataUrl = await getLogoDataUrl();
    const svg = await buildApprovalSummarySvgForSafety(selectedYear, selectedMonth, logoDataUrl);
    const pages = [{
      svg,
      label: '산재 승인 사고',
      fileName: `산재승인_사고_요약_${selectedYear}년_${selectedMonth}.png`
    }];

    state.currentSummarySvg = svg;
    state.currentSummarySvgs = [];
    state.currentSummaryFileName = pages[0].fileName;
    state.currentSummaryZipName = null;

    showSummaryPagesInModal(pages);
  } catch (err) {
    alert('산재 승인 사고 요약 생성 오류: ' + (err.message || err));
  } finally {
    hideLoading();
  }
}

function showSummaryPagesInModal(pages) {
  const modal = $('captureModal');
  const body = $('captureBody');
  if (!modal || !body) return;

  modal.classList.remove('hidden');
  body.className = 'svg-summary-report-body';

  const board = modal.querySelector('.capture-board');
  if (board) {
    board.classList.remove('monthly-report-board');
    board.classList.remove('summary-report-board');
    board.classList.add('svg-summary-board');
  }

  body.innerHTML = `
    <div class="svg-summary-preview-wrap ${pages.length > 1 ? 'multi-page' : ''}">
      ${pages.map((p, i) => `
        <div class="svg-summary-page-card">
          ${pages.length > 1 ? `<div class="svg-summary-page-label">${i + 1}페이지 · ${esc(p.label)}</div>` : ''}
          <img class="summarySvgPreview" alt="${esc(p.label)} 요약 미리보기">
        </div>
      `).join('')}
    </div>`;

  const imgs = body.querySelectorAll('.summarySvgPreview');
  imgs.forEach((img, i) => {
    img.src = svgToDataUrl(pages[i].svg);
  });
}

async function buildSummarySvgForDivision(division, displayDivision, selectedYear, selectedMonth, logoDataUrl, integrated) {
  const monthNum = Number(String(selectedMonth).replace('월', ''));
  const prevDate = getPreviousYearMonth(selectedYear, selectedMonth);

  const [currentData, prevData, yearTotalData] = await Promise.all([
    callAPI({ action: 'dashboard', division, year: selectedYear, month: selectedMonth }),
    callAPI({ action: 'dashboard', division, year: prevDate.year, month: prevDate.month }),
    callAPI({ action: 'dashboard', division, year: selectedYear, month: '전체' })
  ]);

  const currentTotal = Number(((currentData || {}).kpi || {}).total || 0);
  const prevTotal = Number(((prevData || {}).kpi || {}).total || 0);
  const monthDiff = currentTotal - prevTotal;
  const yearlyTotal = Number(((yearTotalData || {}).kpi || {}).total || 0);

  return buildSummarySvgReport({
    year: selectedYear,
    monthText: selectedMonth,
    monthNum,
    division: displayDivision || division || '-',
    currentTotal,
    prevTotal,
    prevDate,
    monthDiff,
    yearlyTotal,
    currentData,
    logoDataUrl,
    integrated: !!integrated
  });
}


async function buildApprovalSummarySvgForSafety(selectedYear, selectedMonth, logoDataUrl) {
  const res = await callAPI({
    action: 'query',
    division: '안전보건팀',
    filters: JSON.stringify({
      year: '전체',
      month: selectedMonth,
      dept: '전체',
      team: '전체',
      store: '전체',
      type: '전체',
      storeSearch: ''
    })
  });
  const rows = res.rows || [];
  return buildApprovalSummarySvgReport({
    year: selectedYear,
    monthText: selectedMonth,
    rows,
    logoDataUrl
  });
}

function buildApprovalSummaryStats(rows) {
  const visibleRows = getApprovalVisibleBaseRows(rows || []);
  const kpiRows = visibleRows.filter(r => isKpiTargetCategory(r.kpiCategory));
  const severeRows = visibleRows.filter(isSevereRow);
  const lostDays = sumLostDays(visibleRows);
  const severeStores = getSevereStoreGroups(visibleRows);
  const typeCounts = makeCountRows_(kpiRows, 'kpiCategory');
  const lossByDept = makeSumRows_(visibleRows, 'stdDept', 'lostDays').map(r => ({ ...r, label: cleanDeptName(r.label) })).slice(0, 5);
  return { visibleRows, kpiRows, severeRows, lostDays, severeStores, typeCounts, lossByDept };
}

function buildApprovalSummarySvgReport(ctx) {
  const stats = buildApprovalSummaryStats(ctx.rows || []);
  const monthNum = Number(String(ctx.monthText).replace('월', '')) || 0;
  const monthLastDay = monthNum ? getLastDayOfMonth(ctx.year, monthNum) : '31';
  const topKpi = stats.typeCounts[0] || { label: '-', count: 0 };
  const yearCounts = buildApprovalYearCountsForSvg(ctx.rows || [], ctx.monthText);
  const maxYear = Math.max(1, ...yearCounts.map(r => r.count));
  const maxType = Math.max(1, ...stats.typeCounts.map(r => r.count));
  const maxLoss = Math.max(1, ...stats.lossByDept.map(r => r.count));

  const barBaseY = 478;
  const barChartH = 145;
  const barXs = [116, 245, 374];
  const yearBars = yearCounts.map((r, i) => {
    const h = Math.max(6, Math.round((r.count / maxYear) * barChartH));
    return { ...r, x: barXs[i], h, y: barBaseY - h };
  });
  const trendPath = yearBars.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x + 34} ${p.y - 12}`).join(' ');
  const typeBars = stats.typeCounts.map((r, i) => {
    const y = 338 + i * 54;
    const width = Math.max(6, Math.round((r.count / maxType) * 270));
    return `<text x="690" y="${y}" class="dark" font-size="18" font-weight="900">${svgEsc(r.label)}</text><rect x="865" y="${y-15}" width="270" height="16" rx="8" fill="#edf0f5"/><rect x="865" y="${y-15}" width="${width}" height="16" rx="8" fill="${i === 0 ? '#0b2f86' : (i === 1 ? '#ff1a1a' : '#777')}"/><text x="1170" y="${y}" text-anchor="end" class="dark" font-size="18" font-weight="900">${r.count}건</text>`;
  }).join('');
  const lossBars = stats.lossByDept.map((r, i) => {
    const y = 500 + i * 28;
    const width = Math.max(6, Math.round((r.count / maxLoss) * 270));
    return `<text x="690" y="${y}" class="dark" font-size="15" font-weight="900">${svgEsc(shortSvgText(r.label, 12))}</text><rect x="865" y="${y-12}" width="270" height="12" rx="6" fill="#edf0f5"/><rect x="865" y="${y-12}" width="${width}" height="12" rx="6" fill="#ff1a1a"/><text x="1170" y="${y}" text-anchor="end" class="dark" font-size="15" font-weight="900">${Number(r.count||0).toLocaleString()}일</text>`;
  }).join('');

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs><style>.font{font-family:'Malgun Gothic','Apple SD Gothic Neo',Arial,sans-serif}.navy{fill:#0b2f86}.red{fill:#ff1a1a}.dark{fill:#222}.muted{fill:#555}.title{font-size:46px;font-weight:900;letter-spacing:-2px}.sub{font-size:18px;font-weight:800}.panel-title{font-size:20px;font-weight:900}.shadow{filter:drop-shadow(0px 4px 8px rgba(0,0,0,.12))}</style><linearGradient id="approvalSvgBarGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ff2b2b"/><stop offset="100%" stop-color="#d90000"/></linearGradient></defs>
  <rect width="1280" height="720" fill="#fff"/>
  <g class="font">
    ${ctx.logoDataUrl ? `<image href="${ctx.logoDataUrl}" x="1030" y="38" width="174" height="70" preserveAspectRatio="xMidYMid meet"/>` : ''}
    <text x="640" y="70" text-anchor="middle" class="title navy">${svgEsc(ctx.year)}년 ${svgEsc(ctx.monthText)} 산재승인 및 KPI <tspan class="red">집계 현황</tspan></text>
    <text x="640" y="104" text-anchor="middle" class="sub dark">안전보건팀 / 기준: ${svgEsc(ctx.year)}.${String(monthNum || '').padStart(2,'0')}.01 ~ ${svgEsc(ctx.year)}.${String(monthNum || '').padStart(2,'0')}.${monthLastDay}</text>
    <g class="shadow"><rect x="64" y="135" width="270" height="104" rx="18" fill="#fff" stroke="#d9d9d9"/><text x="92" y="169" class="dark" font-size="20" font-weight="900">산업재해 승인 건수</text><text x="92" y="216" class="navy" font-size="42" font-weight="900">${stats.visibleRows.length}건</text><rect x="364" y="135" width="270" height="104" rx="18" fill="#fff" stroke="#d9d9d9"/><text x="392" y="169" class="dark" font-size="20" font-weight="900">KPI 집계대상</text><text x="392" y="216" class="red" font-size="42" font-weight="900">${stats.kpiRows.length}건</text><rect x="664" y="135" width="270" height="104" rx="18" fill="#fff" stroke="#d9d9d9"/><text x="692" y="169" class="dark" font-size="20" font-weight="900">총 근로손실일수</text><text x="692" y="216" class="red" font-size="42" font-weight="900">${stats.lostDays.toLocaleString()}일</text><rect x="964" y="135" width="250" height="104" rx="18" fill="#fff" stroke="#d9d9d9"/><text x="992" y="169" class="dark" font-size="20" font-weight="900">91일 이상 중상해</text><text x="992" y="216" fill="#777" font-size="42" font-weight="900">${stats.severeRows.length}건</text></g>
    <g><rect x="54" y="276" width="570" height="304" rx="18" fill="#fff" stroke="#d9d9d9"/><text x="82" y="318" class="panel-title navy">3개년 산업재해 승인 건수 비교</text><path d="${trendPath}" fill="none" stroke="#ff1a1a" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="8 8" opacity=".85"/>${yearBars.map(p=>`<circle cx="${p.x+34}" cy="${p.y-12}" r="7" fill="#ff1a1a"/>`).join('')}${yearBars.map((p,i)=>`<rect x="${p.x}" y="${p.y}" width="68" height="${p.h}" rx="14" fill="${i===2?'url(#approvalSvgBarGrad)':'#0b2f86'}" opacity="${i===2?'1':'.88'}"/><text x="${p.x+34}" y="${Math.max(338,p.y-31)}" text-anchor="middle" class="dark" font-size="22" font-weight="900">${p.count}건</text><text x="${p.x+34}" y="535" text-anchor="middle" class="dark" font-size="18" font-weight="900">${p.year}</text>`).join('')}</g>
    <g><rect x="654" y="276" width="570" height="304" rx="18" fill="#fff" stroke="#d9d9d9"/><text x="690" y="318" class="panel-title navy">KPI 분류별 건수</text>${typeBars}<line x1="690" y1="455" x2="1178" y2="455" stroke="#e5e7eb"/><text x="690" y="482" class="panel-title navy">영업부별 근로손실일수</text>${lossBars}</g>
    <g><rect x="54" y="616" width="1166" height="72" rx="18" fill="#fff7f7" stroke="#ffc7c7"/><text x="84" y="657" class="red" font-size="22" font-weight="900">핵심 포인트</text><text x="226" y="657" class="dark" font-size="17" font-weight="900">산업재해 승인 건수 기준 KPI 반영 대상은 <tspan class="red">${stats.kpiRows.length}건</tspan>이며, 최다 KPI 분류는 <tspan class="red">${svgEsc(topKpi.label)}</tspan>입니다. 91일 이상 중상해 ${stats.severeRows.length}건을 모니터링합니다.</text></g>
  </g>
</svg>`;
}

function buildApprovalYearCountsForSvg(rows, monthText) {
  const years = ['2024', '2025', '2026'];
  const visible = getApprovalVisibleBaseRows(rows || []);
  return years.map(year => ({ year, count: visible.filter(r => String(r.year) === year).length }));
}

async function getLogoDataUrl() {
  if (state.logoDataUrl) return state.logoDataUrl;
  try {
    const res = await fetch('logo.png', { cache: 'no-store' });
    const blob = await res.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    state.logoDataUrl = dataUrl;
    return dataUrl;
  } catch (err) {
    return '';
  }
}

function svgToDataUrl(svg) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function svgEsc(v) {
  return String(v ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}

function shortSvgText(v, n) {
  const s = String(v || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function buildSummarySvgReport(ctx) {
  const monthLastDay = getLastDayOfMonth(ctx.year, ctx.monthNum);
  const charts = (ctx.currentData || {}).charts || {};
  const typeRows = (charts.typeCounts || []).filter(r => r.label !== '미분류').slice(0, 3);
  const allTypeRows = (charts.typeCounts || []).filter(r => r.label !== '미분류');
  const deptRows = (charts.deptCounts || []).slice(0, 3).map(r => ({ ...r, label: cleanDeptName(r.label) }));
  const trendRows = (ctx.currentData || {}).yearlyTrend || [];
  const currentTrend = trendRows.find(r => String(r.year) === String(ctx.year)) || trendRows[trendRows.length - 1] || { months: [] };
  const previousTrend = trendRows.find(r => String(r.year) === String(Number(ctx.year) - 1)) || { months: [] };
  const monthlyValues = Array.from({ length: 12 }, (_, i) => Number((currentTrend.months || [])[i] || 0));
  const prevYearValues = Array.from({ length: 12 }, (_, i) => Number((previousTrend.months || [])[i] || 0));
  const mixedValues = monthlyValues.map((v, i) => i + 1 <= ctx.monthNum ? v : (prevYearValues[i] || 0));
  const maxVal = Math.max(5, ...mixedValues, ctx.currentTotal, ctx.prevTotal);
  const axisMax = Math.ceil(maxVal / 5) * 5;
  const topTypeName = typeRows[0] ? typeRows[0].label : '-';
  const topDeptName = deptRows[0] ? deptRows[0].label : '-';
  const currentYtd = monthlyValues.slice(0, ctx.monthNum).reduce((s, n) => s + Number(n || 0), 0);
  const prevYearYtd = prevYearValues.slice(0, ctx.monthNum).reduce((s, n) => s + Number(n || 0), 0);

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <style>
      .font { font-family: 'Malgun Gothic','Apple SD Gothic Neo',Arial,sans-serif; }
      .navy { fill: #0b2f86; }
      .red { fill: #ff1a1a; }
      .dark { fill: #222; }
      .muted { fill: #555; }
      .title { font-size: 52px; font-weight: 900; letter-spacing: -2px; }
      .sub { font-size: 18px; font-weight: 800; }
      .panel-title { font-size: 19px; font-weight: 900; }
      .small { font-size: 13px; font-weight: 800; }
      .label { font-size: 15px; font-weight: 800; }
      .shadow { filter: drop-shadow(0px 4px 8px rgba(0,0,0,.12)); }
    </style>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#f6f8fb"/>
    </linearGradient>
    <linearGradient id="navyGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#163c99"/>
      <stop offset="100%" stop-color="#082763"/>
    </linearGradient>
    <linearGradient id="redGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ff2b2b"/>
      <stop offset="100%" stop-color="#ec0000"/>
    </linearGradient>
  </defs>

  <rect x="0" y="0" width="1280" height="720" fill="url(#bgGrad)"/>
  <rect x="0" y="0" width="1280" height="720" fill="#ffffff" opacity="0.88"/>

  <g class="font">
    ${ctx.logoDataUrl ? `<image href="${ctx.logoDataUrl}" x="1038" y="30" width="205" height="70" preserveAspectRatio="xMidYMid meet"/>` : `<text x="1095" y="55" class="navy" font-size="30" font-weight="900">ASUNG</text><text x="1146" y="88" fill="#777" font-size="20" font-weight="900">DAISO</text>`}

    <text x="640" y="72" text-anchor="middle" class="title navy">${svgEsc(ctx.year)}년 ${svgEsc(ctx.monthText)} 산업재해 <tspan class="red">${ctx.integrated ? '통합 현황' : '현황'}</tspan></text>
    <text x="640" y="102" text-anchor="middle" class="sub dark">${svgEsc(ctx.division)} / 기준: ${svgEsc(ctx.year)}.${String(ctx.monthNum).padStart(2,'0')}.01 ~ ${svgEsc(ctx.year)}.${String(ctx.monthNum).padStart(2,'0')}.${monthLastDay}</text>

    ${buildKpiSvg({ ...ctx, currentYtd, prevYearYtd })}
    ${buildTrendSvg(mixedValues, monthlyValues, ctx.monthNum, axisMax, ctx.year)}
    ${buildDonutSvg(allTypeRows, ctx.monthText)}
    ${buildTopListSvg(typeRows, 36, 522, '재해유형 TOP 3')}
    ${buildTopListSvg(deptRows, 432, 522, '영업부별 재해 TOP 3')}
    ${buildPointSvg(ctx, topTypeName, topDeptName, 828, 522, 414, 168)}
  </g>
</svg>`;
}

function buildKpiSvg(ctx) {
  const diffText = formatMonthlyDiff(ctx.monthDiff);
  const diffColor = getChangeSvgColor(ctx.monthDiff);
  const prevTotalText = Number(ctx.prevTotal || 0);

  const yoyText = formatYoyText(ctx.currentYtd, ctx.prevYearYtd);
  const yoyColor = getYoySvgColor(ctx.currentYtd, ctx.prevYearYtd);
  const prevYearYtdText = Number(ctx.prevYearYtd || 0);

  return `
  <g class="shadow">
    <rect x="72" y="128" width="1136" height="96" rx="18" fill="#ffffff" stroke="#d9d9d9"/>
    <line x1="640" y1="146" x2="640" y2="206" stroke="#d9d9d9" stroke-width="2"/>

    ${shieldIconSvg(116, 150, 52)}
    <text x="188" y="164" class="dark" font-size="21" font-weight="900">총 재해</text>
    <text x="188" y="202" class="red" font-size="36" font-weight="900">${ctx.currentTotal}건</text>

    <rect x="348" y="153" width="254" height="52" rx="14" fill="${diffColor}" opacity="0.10"/>
    <text x="475" y="174" text-anchor="middle" fill="#444" font-size="13" font-weight="900">전월 ${prevTotalText}건 대비</text>
    <text x="475" y="199" text-anchor="middle" fill="${diffColor}" font-size="20" font-weight="900">${svgEsc(diffText)}</text>

    ${growthIconSvg(690, 150, 52)}
    <text x="762" y="164" class="dark" font-size="21" font-weight="900">연간 누적</text>
    <text x="762" y="202" class="navy" font-size="36" font-weight="900">${ctx.currentYtd}건</text>

    <rect x="928" y="153" width="264" height="52" rx="14" fill="${yoyColor}" opacity="0.10"/>
    <text x="1060" y="174" text-anchor="middle" fill="#444" font-size="13" font-weight="900">전년 동기 ${prevYearYtdText}건 대비</text>
    <text x="1060" y="199" text-anchor="middle" fill="${yoyColor}" font-size="19" font-weight="900">${svgEsc(yoyText)}</text>
  </g>`;
}

function shieldIconSvg(x, y, size = 52) {
  const s = size / 64;
  return `<g transform="translate(${x},${y}) scale(${s})"><path fill="#ff1a1a" d="M32 0l26 9v22c0 18-10 32-26 42C16 63 6 49 6 31V9z"/><path fill="#fff" d="M27 14h10v14h14v10H37v14H27V38H13V28h14z"/></g>`;
}
function downIconSvg(x, y, size = 52) {
  const s = size / 70;
  return `<g transform="translate(${x},${y}) scale(${s})"><circle cx="35" cy="35" r="35" fill="#0b2f86"/><path fill="#fff" d="M30 12h10v30h14L35 61 16 42h14z"/></g>`;
}
function growthIconSvg(x, y, size = 52) {
  const s = size / 70;
  return `<g transform="translate(${x},${y}) scale(${s})"><circle cx="35" cy="35" r="35" fill="#0b2f86"/><rect x="17" y="37" width="9" height="18" rx="1" fill="#fff"/><rect x="31" y="28" width="9" height="27" rx="1" fill="#fff"/><rect x="45" y="18" width="9" height="37" rx="1" fill="#fff"/><path d="M17 26l12-9 9 8 14-14" stroke="#fff" stroke-width="4" fill="none"/></g>`;
}

function buildTrendSvg(mixedValues, monthlyValues, monthNum, axisMax, yearText) {
  const x = 36, y = 246, w = 820, h = 250;
  const chartX = x + 26, chartY = y + 52, chartW = w - 52, chartH = 138;
  const gap = chartW / 12;
  let bars = '';
  for (let i = 0; i < 12; i++) {
    const val = mixedValues[i] || 0;
    const bh = Math.max(4, (val / axisMax) * chartH);
    const bx = chartX + i * gap + 11;
    const by = chartY + chartH - bh;
    const color = (i + 1 === monthNum) ? 'url(#redGrad)' : ((i + 1 < monthNum) ? 'url(#navyGrad)' : '#d9d9d9');
    bars += `<text x="${bx+16}" y="${by-7}" text-anchor="middle" class="dark" font-size="14" font-weight="900">${val}</text><rect x="${bx}" y="${by}" width="32" height="${bh}" rx="2" fill="${color}"/><text x="${bx+16}" y="${chartY+chartH+26}" text-anchor="middle" class="dark" font-size="14" font-weight="900">${i+1}월</text>`;
  }
  const actual = monthlyValues.slice(0, monthNum);
  const linePoints = actual.map((v, i) => {
    const px = chartX + i * gap + 27;
    const py = chartY + chartH - ((v || 0) / axisMax) * chartH;
    return `${px},${py}`;
  }).join(' ');
  const dots = actual.map((v, i) => {
    const px = chartX + i * gap + 27;
    const py = chartY + chartH - ((v || 0) / axisMax) * chartH;
    return `<circle cx="${px}" cy="${py}" r="5" fill="#ff1a1a"/>`;
  }).join('');
  return `
  <g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="#fff" stroke="#d9d9d9"/>
    <text x="${x+18}" y="${y+30}" class="panel-title navy">${svgEsc(yearText)}년 월별 재해 발생 추이</text>
    <line x1="${chartX}" y1="${chartY+chartH}" x2="${chartX+chartW}" y2="${chartY+chartH}" stroke="#c9c9c9" stroke-width="2"/>
    ${bars}
    <polyline points="${linePoints}" fill="none" stroke="#ff1a1a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="3 9"/>
    ${dots}
    <rect x="${chartX+215}" y="${y+h-25}" width="14" height="10" fill="#0b2f86"/><text x="${chartX+236}" y="${y+h-16}" class="small dark">실적</text>
    <line x1="${chartX+300}" y1="${y+h-20}" x2="${chartX+340}" y2="${y+h-20}" stroke="#ff1a1a" stroke-width="4" stroke-dasharray="3 8"/><text x="${chartX+350}" y="${y+h-16}" class="small dark">추세선</text>
    <rect x="${chartX+430}" y="${y+h-25}" width="14" height="10" fill="#d9d9d9"/><text x="${chartX+450}" y="${y+h-16}" class="small dark">과거건수</text>
  </g>`;
}

function buildDonutSvg(rows, monthText) {
  const x = 878, y = 246, w = 364, h = 250;
  let usable = (rows || []).filter(r => r.label !== '미분류').slice(0, 5);
  if (usable.length > 4) {
    const keep = usable.slice(0, 4);
    const etcCount = usable.slice(4).reduce((s, r) => s + Number(r.count || 0), 0);
    if (etcCount > 0) keep.push({ label: '기타', count: etcCount });
    usable = keep;
  }
  const total = Math.max(1, usable.reduce((s, r) => s + Number(r.count || 0), 0));
  const colors = ['#0b2f86', '#ff1a1a', '#a9a9a9', '#d9d9d9', '#eeeeee'];
  let paths = '';
  let start = -90;
  usable.forEach((r, i) => {
    const angle = (Number(r.count || 0) / total) * 360;
    paths += donutSlicePath(972, 373, 68, 34, start, start + angle, colors[i]);
    start += angle;
  });

  const legendBaseY = 330;
  const legendGap = 22;
  const legend = usable.map((r, i) => {
    const pct = ((Number(r.count || 0) / total) * 100).toFixed(1);
    const yy = legendBaseY + i * legendGap;
    return `<circle cx="1070" cy="${yy}" r="5" fill="${colors[i]}"/><text x="1084" y="${yy+5}" class="small dark">${svgEsc(shortSvgText(r.label, 8))}</text><text x="1218" y="${yy+5}" text-anchor="end" class="small dark">${pct}%</text>`;
  }).join('');

  return `
  <g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="#fff" stroke="#d9d9d9"/>
    <text x="${x+18}" y="${y+30}" class="panel-title navy">${svgEsc(monthText)} 재해유형 비중</text>
    ${paths}
    <circle cx="972" cy="373" r="35" fill="#fff"/>
    <text x="972" y="366" text-anchor="middle" class="dark" font-size="18" font-weight="900">주요</text>
    <text x="972" y="390" text-anchor="middle" class="dark" font-size="18" font-weight="900">유형</text>
    ${legend}
  </g>`;
}

function donutSlicePath(cx, cy, r, inner, startAngle, endAngle, color) {
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  const p1 = polar(cx, cy, r, endAngle);
  const p2 = polar(cx, cy, r, startAngle);
  const p3 = polar(cx, cy, inner, startAngle);
  const p4 = polar(cx, cy, inner, endAngle);
  return `<path d="M ${p1.x} ${p1.y} A ${r} ${r} 0 ${largeArc} 0 ${p2.x} ${p2.y} L ${p3.x} ${p3.y} A ${inner} ${inner} 0 ${largeArc} 1 ${p4.x} ${p4.y} Z" fill="${color}" stroke="#fff" stroke-width="2"/>`;
}
function polar(cx, cy, r, angle) {
  const rad = (angle - 90) * Math.PI / 180.0;
  return { x: cx + (r * Math.cos(rad)), y: cy + (r * Math.sin(rad)) };
}

function buildTopListSvg(rows, x, y, title) {
  const w = 380, h = 168;
  const max = Math.max(1, ...(rows || []).map(r => Number(r.count || 0)));
  const colors = ['#0b2f86', '#ff1a1a', '#a9a9a9'];
  const items = (rows || []).slice(0, 3).map((r, i) => {
    const top = y + 44 + i * 40;
    const bw = Math.max(26, Math.round((Number(r.count || 0) / max) * 220));
    return `
      <circle cx="${x+26}" cy="${top+2}" r="12" fill="${colors[i]}"/>
      <text x="${x+26}" y="${top+7}" text-anchor="middle" fill="#fff" font-size="13" font-weight="900">${i+1}</text>
      <text x="${x+48}" y="${top+7}" class="dark" font-size="15" font-weight="900">${svgEsc(shortSvgText(r.label, 16))}</text>
      <text x="${x+w-18}" y="${top+7}" text-anchor="end" class="dark" font-size="15" font-weight="900">${r.count}건</text>
      <rect x="${x+48}" y="${top+17}" width="260" height="8" rx="4" fill="#efefef"/>
      <rect x="${x+48}" y="${top+17}" width="${bw}" height="8" rx="4" fill="${colors[i]}"/>
    `;
  }).join('');
  return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="#fff" stroke="#d9d9d9"/><text x="${x+16}" y="${y+29}" class="panel-title navy">${svgEsc(title)}</text>${items}</g>`;
}

function buildPointSvg(ctx, topTypeName, topDeptName, x = 828, y = 522, w = 414, h = 168) {
  const diffAbs = Math.abs(Number(ctx.monthDiff || 0));
  const diffWord = ctx.monthDiff <= 0 ? '감소' : '증가';

  if (ctx.integrated) {
    return `
  <g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="#fff7f7" stroke="#ffc7c7"/>
    <text x="${x+18}" y="${y+34}" class="red" font-size="20" font-weight="900">다음달 중점관리 포인트</text>
    <text x="${x+24}" y="${y+74}" class="dark" font-size="14" font-weight="900">• <tspan class="red" font-weight="900">${svgEsc(topTypeName)}</tspan> 사고 중심 TBM·작업 전 주의 강화</text>
    <text x="${x+24}" y="${y+108}" class="dark" font-size="14" font-weight="900">• <tspan class="red" font-weight="900">${svgEsc(topDeptName)}</tspan> 중심 현장점검 우선 실시</text>
    <text x="${x+24}" y="${y+142}" class="dark" font-size="14" font-weight="900">• 반복사고 매장 개선조치 이행 여부 확인</text>
  </g>`;
  }

  return `
  <g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="#fff7f7" stroke="#ffc7c7"/>
    <text x="${x+18}" y="${y+34}" class="red" font-size="20" font-weight="900">핵심 포인트</text>
    <text x="${x+24}" y="${y+74}" class="dark" font-size="14" font-weight="900">• 전월 대비 재해 <tspan class="red" font-weight="900">${diffAbs}건 ${diffWord}</tspan></text>
    <text x="${x+24}" y="${y+108}" class="dark" font-size="14" font-weight="900">• 최다 재해유형은 <tspan class="red" font-weight="900">${svgEsc(topTypeName)}</tspan></text>
    <text x="${x+24}" y="${y+142}" class="dark" font-size="14" font-weight="900">• 집중관리 영업부 <tspan class="red" font-weight="900">${svgEsc(topDeptName)}</tspan></text>
  </g>`;
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

function formatYoyText(currentValue, previousValue) {
  const c = Number(currentValue || 0);
  const p = Number(previousValue || 0);
  if (p <= 0) {
    if (c <= 0) return '동일';
    return '비교값 없음';
  }
  const pct = ((c - p) / p) * 100;
  if (Math.abs(pct) < 0.05) return '동일';
  const abs = Math.abs(pct).toFixed(1);
  return pct > 0 ? `▲ ${abs}% 증가` : `▼ ${abs}% 감소`;
}

function getChangeSvgColor(n) {
  n = Number(n || 0);
  if (n > 0) return '#ff1a1a';  // 증가: 빨강
  if (n < 0) return '#0b2f86';  // 감소: 파랑
  return '#0FA36B';             // 동일: 초록
}

function getYoySvgColor(currentValue, previousValue) {
  const c = Number(currentValue || 0);
  const p = Number(previousValue || 0);
  if (p <= 0) return c <= 0 ? '#0FA36B' : '#666666';
  const diff = c - p;
  if (diff > 0) return '#ff1a1a';  // 증가: 빨강
  if (diff < 0) return '#0b2f86';  // 하락: 파랑
  return '#0FA36B';                // 동일: 초록
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
  state.currentSummarySvg = null;
  state.currentSummarySvgs = [];
  state.currentSummaryFileName = null;
  state.currentSummaryZipName = null;
  
  ['type', 'dept'].forEach(k => {
    if (state.captureCharts[k]) {
      state.captureCharts[k].destroy();
      state.captureCharts[k] = null;
    }
  });
}

async function downloadCaptureImage() {
  const multiPages = state.currentSummarySvgs || [];

  if (multiPages.length > 1) {
    showLoading(`${multiPages.length}장 요약 이미지를 ZIP으로 만드는 중입니다...`);
    try {
      if (typeof JSZip === 'undefined') {
        for (const page of multiPages) {
          const blob = await svgToPngBlob(page.svg);
          downloadBlob(blob, page.fileName);
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      } else {
        const zip = new JSZip();
        for (const page of multiPages) {
          const blob = await svgToPngBlob(page.svg);
          zip.file(page.fileName, blob);
        }
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        downloadBlob(zipBlob, state.currentSummaryZipName || '산업재해_현황_요약.zip');
      }
    } catch (err) {
      alert('이미지 다운로드 중 오류 발생: ' + (err.message || err));
    } finally {
      hideLoading();
    }
    return;
  }

  if (state.currentSummarySvg) {
    showLoading('이미지 파일 생성 중입니다...');
    try {
      const blob = await svgToPngBlob(state.currentSummarySvg);
      downloadBlob(blob, state.currentSummaryFileName || `산업재해_현황_요약_${state.year}년_${state.month}.png`);
    } catch (err) {
      alert('이미지 다운로드 중 오류 발생: ' + (err.message || err));
    } finally {
      hideLoading();
    }
    return;
  }

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

async function svgToPngBlob(svg) {
  const img = new Image();
  const svgUrl = svgToDataUrl(svg);

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = svgUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = 1280 * 2;
  canvas.height = 720 * 2;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName || 'download';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
