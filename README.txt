v27_og_absolute_thumbnail

변경 내용
1. Teams/카카오톡 링크 미리보기용 OG 썸네일 경로를 절대주소로 변경했습니다.
2. 썸네일 이미지를 루트 경로 thumbnail.png에도 추가했습니다.
3. 미리보기 안정성을 위해 1200x630 규격 썸네일을 추가했습니다.
4. og:url, og:image:secure_url, twitter:image, image_src를 보강했습니다.

배포 방법
- ZIP 압축을 풀고 모든 파일을 GitHub Pages 저장소에 덮어쓰기
- 특히 index.html, thumbnail.png, assets/og/thumbnail.png가 모두 올라가야 함

공유 테스트 주소
https://newjuna.github.io/-Accident-DB/?v=27

주의
- 카카오톡/Teams는 이전 미리보기를 캐시할 수 있어 바로 안 바뀔 수 있습니다.
- 카카오톡은 OG 캐시 초기화 후 새 대화방에서 테스트하는 것이 가장 정확합니다.
