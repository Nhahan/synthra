# Synthra 개발 가이드 (한국어)

이 가이드는 Synthra 유튜브 비디오 요약 Chrome 확장 프로그램을 이해, 수정 또는 확장하려는 개발자를 위한 포괄적인 정보를 제공합니다.

## 프로젝트 구조

```
synthra/
├── css/ 
├── icons/ 
├── ts/ # TypeScript 소스 파일
│ ├── background.ts 
│ ├── content.ts 
│ ├── popup.ts 
│ └── config.ts 
├── dist/ 
│ └── js/ 
├── locales/ 
├── node_modules/ 
├── manifest.json 
├── popup.html 
├── webpack.config.js 
├── babel.config.js 
├── package.json 
├── tsconfig.json
└── README.md 
└── DEVELOPMENT_GUIDE.md # 본 파일
```

## 기술 스택

*   **언어:** TypeScript
*   **핵심 라이브러리:** WebLLM (@mlc-ai/web-llm), youtube-transcript
*   **번들러:** Webpack
*   **트랜스파일러:** Babel
*   **UI:** HTML, CSS
*   **국제화:** `chrome.i18n` API, `_locales`
*   **확장 프로그램 API:** Chrome Extensions Manifest V3
*   **공유 설정:** `ts/config.ts` (모델 ID 등)

## 주요 컴포넌트 및 로직

### `background.ts` (서비스 워커)

*   **WebLLM 엔진 관리:** 엔진 인스턴스 초기화 및 관리 (`ts/config.ts`의 `TARGET_MODEL_ID` 사용).
*   **메시지 처리:**
    *   Popup으로부터 `summarizeVideo` 요청 수신 (언어 포함).
    *   Content Script에 `getTranscript` 메시지 전송.
    *   Content Script로부터 스크립트 수신 후 WebLLM에 정리 요청 (`generateSummaryInternal`).
    *   정리된 내용을 Popup으로 전송.
*   **프롬프트:** 요청 언어로 "핵심 내용을 구조화하여 명확하게 정리"하도록 프롬프트 구성.

### `ts/content.ts` (콘텐츠 스크립트)

*   **YouTube 페이지 연동:** 페이지 로드 및 탐색 감지 (`observeNavigation`).
*   **스크립트 추출:** `youtube-transcript` 라이브러리를 사용하여 스크립트 추출 (`getTranscript`).
*   **메시지 처리:** 백그라운드로부터 `getTranscript` 요청 수신 및 스크립트 응답.

### `ts/popup.ts` (팝업 스크립트)

*   **UI 업데이트:** 엔진 상태(초기화, 로딩, 준비, 오류) 표시.
*   **언어 선택:** 언어 드롭다운 제공 및 선택된 언어 저장/적용.
*   **내용 정리 요청:** YouTube 페이지 확인 후 백그라운드에 `summarizeVideo` 메시지 전송.
*   **결과 표시:** 정리된 내용 표시 (`displaySummary`).
*   **프로그레스 바:** 로딩 진행률 표시.

### `popup.html` (팝업 UI)

*   UI 구조 정의, `css/popup.css` 및 `dist/js/popup.js` 연결.
*   국제화를 위한 `data-i18n` 속성 사용.

### 국제화 (`_locales`)

*   `en`, `ko`, `ja`, `zh` 디렉토리 및 `messages.json` 파일.

## 빌드 및 실행

1.  `npm install`
2.  `npm run build`
3.  `chrome://extensions/`에서 `dist` 폴더 로드.

## 디버깅

*   **서비스 워커:** `chrome://extensions/` -> Synthra -> "서비스 워커".
*   **콘텐츠 스크립트:** YouTube 페이지 -> 개발자 도구 (F12) -> 콘솔.
*   **팝업:** 확장 프로그램 아이콘 우클릭 -> "팝업 검사".

## 다음 단계 및 고려 사항

*   **`messages.json` 업데이트:** 필요한 메시지 키 추가/수정.
*   **오류 처리:** 사용자 피드백 강화.
*   **서비스 워커 생명주기:** 재로딩 최소화 방안 고려. 