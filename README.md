# 산재 대시보드 v4.0 — 셋업 가이드

## 폴더 구조

```
apps-script/    ← Google Apps Script에 붙여넣을 파일
  └── Code.gs

webapp/          ← GitHub Pages에 업로드할 파일
  ├── index.html
  ├── style.css
  └── app.js
```

---

## 1단계: Apps Script 설정 (서버)

1. Google Sheets를 열고 `확장 프로그램 → Apps Script` 클릭
2. 기존 `Code.gs` 내용을 **모두 삭제**
3. `apps-script/Code.gs` 내용을 복사 → 붙여넣기
4. **기존 Index.html, Style.html, Script.html 파일은 삭제** (더 이상 필요 없음)
5. 저장 (Ctrl+S)

### 배포

1. Apps Script 상단 `배포` → `새 배포`
2. 유형: **웹 앱**
3. 설명: `v4.0`
4. 실행 사용자: **나(본인)**
5. 액세스 권한: **모든 사용자**
6. `배포` 클릭
7. **배포 URL을 복사** (중요!)
   - 예: `https://script.google.com/macros/s/AKfyc.../exec`

---

## 2단계: GitHub Pages 설정 (화면)

### 최초 설정

1. [GitHub](https://github.com) 가입 (무료)
2. 새 Repository 생성
   - Repository name: `accident-dashboard` (원하는 이름)
   - Public 선택
   - `Create repository` 클릭

### 파일 업로드

1. Repository 페이지에서 `uploading an existing file` 클릭
2. `webapp/` 폴더 안의 **3개 파일**을 드래그 앤 드롭:
   - `index.html`
   - `style.css`
   - `app.js`
3. `Commit changes` 클릭

### ⚠️ API URL 설정 (중요!)

1. GitHub에서 `app.js` 파일 클릭 → 연필 아이콘 (Edit) 클릭
2. 맨 위의 `API_URL` 값을 **1단계에서 복사한 배포 URL**로 변경:

```javascript
const API_URL = 'https://script.google.com/macros/s/AKfyc.../exec';
```

3. `Commit changes` 클릭

### GitHub Pages 활성화

1. Repository → `Settings` → 왼쪽 `Pages`
2. Source: `Deploy from a branch`
3. Branch: `main` / `/ (root)` 선택
4. `Save` 클릭
5. 1~2분 후 URL 생성:
   - `https://유저이름.github.io/accident-dashboard/`

---

## 3단계: 사용

### 데이터 관리 (기존과 동일)

1. Google Sheets의 `원본DB` 시트에 재해통계표 데이터 붙여넣기
2. 메뉴 `산재 대시보드` → `② 분석DB 갱신` 실행
3. `분석DB_수도권` / `분석DB_지방` 시트가 자동 생성됨

### 대시보드 접속

1. GitHub Pages URL 접속
2. 영업부문 선택 + 비밀번호 입력
3. 대시보드 확인

---

## 업데이트 방법

### 데이터 갱신
- Google Sheets에서 원본DB 수정 → `분석DB 갱신` 실행
- **별도의 배포나 업데이트 불필요** (API가 자동으로 최신 데이터 반환)

### 화면 수정
- GitHub에서 `index.html`, `style.css`, `app.js` 수정 → Commit
- GitHub Pages가 자동으로 반영 (1~2분 소요)

### 서버 로직 수정
- Apps Script에서 `Code.gs` 수정 → **새 배포 생성** 필요
- 새 배포 URL이 바뀌면 `app.js`의 `API_URL`도 수정

---

## 문제 해결

| 문제 | 해결 |
|------|------|
| API 호출 시 오류 | Apps Script 배포가 "모든 사용자" 접근인지 확인 |
| 대시보드 0건 표시 | `분석DB 갱신`을 다시 실행했는지 확인 |
| 페이지 안 열림 | GitHub Pages 설정에서 branch가 main인지 확인 |
| CORS 오류 | API_URL이 정확한 배포 URL인지 확인 (/exec으로 끝나야 함) |
