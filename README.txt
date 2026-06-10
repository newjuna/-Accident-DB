v14 Teams 공유용 자동 최신 접속 버전

목적
- 담당자가 모바일에서 Teams 링크만 눌러도 최신 화면으로 접속되게 하기 위한 버전입니다.
- 사용자가 ?v=15 같은 값을 붙이거나, 모바일 캐시를 직접 삭제하지 않아도 되도록 구성했습니다.

핵심 처리
1. index.html이 매 접속마다 최신 style.css를 자동으로 불러옵니다.
2. index.html이 매 접속마다 최신 app.js를 자동으로 불러옵니다.
3. start.html을 추가했습니다.
   - Teams 공유용 링크로 사용하면 됩니다.
   - 사용자는 start.html 링크만 누르면 되고, 내부에서 자동으로 최신 index.html로 이동합니다.

GitHub Pages 업로드 파일
- index.html
- app.js
- style.css
- logo.png
- start.html

Code.gs
- 변경 없음
- Apps Script 재배포 필요 없음

Teams 공유 권장 방식
1. GitHub Pages에 위 파일을 덮어씁니다.
2. 1~3분 기다립니다.
3. Teams에는 아래 형태의 링크를 공유합니다.

   https://계정명.github.io/저장소명/start.html

사용자 안내 문구 예시
- 아래 링크로 접속해 주세요.
- 모바일에서도 접속 가능합니다.
- 접속 후 영업부문 선택 및 비밀번호 입력 후 이용하시면 됩니다.

주의
- Teams 앱 내부 브라우저가 회사 정책상 외부 사이트 스크립트를 막는 경우에는 Chrome/Safari로 열어야 할 수 있습니다.
- 하지만 일반적인 캐시 문제는 start.html과 자동 최신 로딩으로 대부분 해결됩니다.
