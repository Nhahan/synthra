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
*   **자동 모델 초기화:** 서비스 워커 활성화 시 백그라운드에서 자동으로 모델 초기화 시작.
*   **초기화 재시도 메커니즘:** 초기화 오류 발생 시 최대 3회까지 자동으로 재시도. 각 시도 간 10초 간격 부여.
*   **엔진 상태 추적:** 엔진의 초기화, 활성화, 오류, 재시도 상태를 추적하여 팝업과 공유.
*   **자동 요약 기능:** 항상 활성화 상태로 유지됩니다. 사용자가 비활성화하려고 하더라도 설정이 `true`로 재설정됩니다.
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
*   **통신 인터페이스:**
    *   `ping` 요청 처리: 콘텐츠 스크립트 활성화 상태 확인용.
    *   `getTranscript` 요청 처리: YouTube 트랜스크립트 추출 및 응답.
    *   `enableAutoSummary` 요청 처리: 자동 요약 기능 활성화/비활성화.

### `ts/popup.ts` (팝업 스크립트)

*   **UI 업데이트:** 엔진 상태(초기화, 로딩, 준비, 오류, 재시도) 표시.
*   **재시도 상태 시각화:** 엔진 초기화 재시도 상태를 명확히 표시하는 UI 요소와 애니메이션 제공.
*   **언어 선택:** 언어 드롭다운 제공 및 선택된 언어 저장/적용.
*   **자동 요약 기능:** UI에 토글 스위치가 있지만 실제로는 항상 활성화 상태로 유지됩니다. `handleAutoSummaryToggle` 함수가 이를 보장합니다.
*   **내용 정리 요청:** YouTube 페이지 확인 후 백그라운드에 `summarizeVideo` 메시지 전송.
*   **결과 표시:** 정리된 내용 표시 (`displaySummary`).
*   **프로그레스 바:** 로딩 진행률 표시.
*   **통신 인터페이스:**
    *   콘텐츠 스크립트 상태 확인 및 주입 (`ping` 요청).
    *   트랜스크립트 요청 시 콘텐츠 스크립트와 통신 (`getTranscript`).
    *   재시도 메커니즘: 콘텐츠 스크립트 연결 실패 시 최대 3번까지 재시도.

### 설정 관리

*   **자동 요약 설정:** 자동 요약 기능은 항상 활성화되어 있으며, 이는 다음과 같은 메커니즘에 의해 보장됩니다:
    *   `background.ts`의 `loadSettings` 함수: 항상 `autoSummarize`와 `autoSummaryEnabled`를 true로 설정
    *   `popup.ts`의 `handleAutoSummaryToggle` 함수: 사용자가 토글을 변경하더라도 항상 true 상태로 유지
    *   스토리지 변경 리스너: 설정이 false로 변경되려고 할 때 자동으로 true로 재설정
*   **사용자 피드백:** UI상에서는 토글이 변경 가능한 것처럼 보이지만, 실제로는 항상 활성화 상태를 유지합니다.

### `popup.html` (팝업 UI)

*   UI 구조 정의, `css/popup.css` 및 `dist/js/popup.js` 연결.
*   국제화를 위한 `data-i18n` 속성 사용.

### 국제화 (`_locales`)

*   `en` (영어), `ko` (한국어), `ja` (일본어), `zh` (중국어) 디렉토리 및 `messages.json` 파일.
*   각 언어별 번역은 해당 디렉토리의 `messages.json` 파일에 정의됩니다.
*   새 언어를 추가하려면 해당 언어 코드의 디렉토리를 생성하고 `messages.json` 파일을 작성한 후, `popup.html`의 언어 선택 드롭다운에 옵션을 추가해야 합니다.

## 빌드 및 실행

1.  `npm install`
2.  `npm run build`
3.  `chrome://extensions/`에서 `dist` 폴더 로드.

## 디버깅

*   **서비스 워커:** `chrome://extensions/` -> Synthra -> "서비스 워커".
*   **콘텐츠 스크립트:** YouTube 페이지 -> 개발자 도구 (F12) -> 콘솔.
*   **팝업:** 확장 프로그램 아이콘 우클릭 -> "팝업 검사".

### 콘텐츠 스크립트 연결 문제 디버깅

콘텐츠 스크립트와 팝업/백그라운드 간 통신에 문제가 발생하는 경우:

1. **콘텐츠 스크립트 로드 확인:**
   * YouTube 페이지 (watch URL)에서 개발자 도구 콘솔을 열고 `[Content]` 태그 로그 확인
   * `window.synthraInitialized` 값 확인 (true여야 함)

2. **수동 스크립트 주입 테스트:**
   * 콘솔에서 다음 명령 실행하여 수동으로 스크립트 주입 가능:
   ```javascript
   chrome.scripting.executeScript({
     target: { tabId: <현재_탭_ID> },
     files: ['js/content.js']
   });
   ```

3. **통신 테스트:**
   * 콘솔에서 수동으로 메시지 테스트:
   ```javascript
   chrome.tabs.sendMessage(<현재_탭_ID>, { action: "ping" });
   ```

4. **일반적인 해결책:**
   * 확장 프로그램 재로드
   * YouTube 페이지 새로고침
   * 브라우저 재시작
   * 캐시와 쿠키 정리

## 다음 단계 및 고려 사항

*   **`messages.json` 업데이트:** 필요한 메시지 키 추가/수정.
*   **오류 처리:** 사용자 피드백 강화.
*   **서비스 워커 생명주기:** 재로딩 최소화 방안 고려. 
*   **통신 안정성:** 콘텐츠 스크립트-팝업 간 통신 및 재시도 메커니즘 개선.
*   **초기화 안정성:** 여러 환경과 네트워크 상태에서의 엔진 초기화 안정성 개선 및 재시도 로직 최적화. 