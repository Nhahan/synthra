# Synthra

<div align="center">

![image](https://github.com/user-attachments/assets/1e1db796-e328-49b8-935c-cb1225beda73)

</div>

WebLLM 기반 YouTube 영상 요약 정리 크롬 확장 프로그램.

## 주요 기능

- **즉각적인 내용 정리**: 페이지를 벗어나지 않고 YouTube 비디오의 핵심 내용을 간결하게 파악할 수 있습니다.
- **개인 정보 최우선**: 모든 처리가 로컬에서 이루어집니다 - 어떠한 데이터도 브라우저 외부로 전송되지 않습니다.
- **다국어 지원**: 팝업 UI 및 내용 정리를 **영어, 한국어, 일본어, 중국어**로 제공합니다.
- **로컬 AI 모델**: WebLLM 기술을 사용하여 브라우저 내에서 직접 AI 모델을 실행합니다.
- **맥락 기반 정리**: 비디오 스크립트를 기반으로 AI가 생성하는 구조화된 내용 정리.

## 설치 방법

### Chrome 웹 스토어

1.  [Chrome 웹 스토어의 Synthra 페이지](https://chrome.google.com/webstore/detail/synthra/abc123) 방문 (비활성화)
2.  "Chrome에 추가" 클릭
3.  확장 프로그램이 자동으로 설치됩니다.

## 사용 방법

1.  YouTube 비디오 페이지로 이동합니다.
2.  브라우저 툴바에서 Synthra 확장 프로그램 아이콘을 클릭하여 팝업을 엽니다.
3.  AI 엔진이 로딩될 때까지 잠시 기다립니다 (진행률 표시).
4.  엔진 로딩이 완료되면 팝업 창에 현재 비디오의 정리된 내용이 자동으로 표시됩니다.
5.  팝업 오른쪽 상단의 드롭다운 메뉴에서 원하는 정리 언어(한국어, 영어, 일본어, 중국어)를 선택할 수 있습니다. 언어 변경 시 내용이 해당 언어로 다시 정리됩니다.

## 개인 정보 보호 정책

Synthra는 개인 정보 보호를 핵심 원칙으로 설계되었습니다:

-   모든 처리는 사용자의 기기 내 로컬 환경에서 이루어집니다.
-   어떠한 데이터도 외부 서버로 전송되지 않습니다.
-   사용자 데이터는 수집되거나 저장되지 않습니다.
-   추적 또는 분석 기능이 포함되어 있지 않습니다.

## 주요 업데이트

### 버전 1.0.3
- 자동 요약 기능 항상 활성화 - 자동 요약 기능이 항상 활성화 상태로 유지되도록 개선되어 사용자 경험을 향상시켰습니다.
- 설정 일관성 개선 - 백그라운드와 팝업 간 설정 동기화 문제 해결

### 버전 1.0.2
- 엔진 초기화 안정성 개선 - 오류 발생 시 자동 재시도 기능 추가 및 UI에 재시도 상태 표시
- 재시도 UI 디자인 개선 - 더 명확한 상태 표시 및 애니메이션 추가

### 버전 1.0.1
- 중국어 지원 추가 - 이제 팝업 UI와 요약 기능이 중국어로도 제공됩니다.
- 반응형 디자인 개선 - 다양한 화면 크기에 최적화된 UI 제공. 