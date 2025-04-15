# Synthra

<p align="center">
  <img src="icons/icon128.png" alt="Synthra 로고" width="128" height="128">
</p>

AI 기반 Chrome 확장 프로그램으로, YouTube 비디오를 브라우저에서 직접, 오프라인으로, 개인 정보 보호를 최우선으로 하여 요약(내용 정리)합니다.

## 주요 기능

-   ✨ **즉각적인 내용 정리**: 페이지를 벗어나지 않고 YouTube 비디오의 핵심 내용을 간결하게 파악할 수 있습니다.
-   🔒 **개인 정보 최우선**: 모든 처리가 로컬에서 이루어집니다 - 어떠한 데이터도 브라우저 외부로 전송되지 않습니다.
-   🔌 **오프라인 지원**: 한 번 설치되면 인터넷 연결 없이도 작동합니다 (모델 로딩 완료 후).
-   🌐 **다국어 지원**: 팝업 UI 및 내용 정리를 **영어, 한국어, 일본어, 중국어**로 제공합니다. (팝업에서 언어 선택 가능)
-   🚀 **로컬 AI 모델**: WebLLM 기술을 사용하여 브라우저 내에서 직접 AI 모델을 실행합니다. (현재 Gemma 모델 사용)
-   📊 **맥락 기반 정리**: 비디오 스크립트를 기반으로 AI가 생성하는 구조화된 내용 정리.

## 설치 방법

### Chrome 웹 스토어 (권장)

1.  [Chrome 웹 스토어의 Synthra 페이지](https://chrome.google.com/webstore/detail/synthra/abc123) 방문 (링크는 예시입니다)
2.  "Chrome에 추가" 클릭
3.  확장 프로그램이 자동으로 설치됩니다.

### 수동 설치 (개발자용)

1.  [릴리스 페이지](https://github.com/username/synthra/releases)에서 최신 릴리스를 다운로드합니다 (링크는 예시입니다). 또는 코드를 직접 빌드합니다 (`npm run build` 실행 후 `dist` 폴더 사용).
2.  압축 파일을 해제합니다 (해당하는 경우).
3.  Chrome에서 `chrome://extensions/`로 이동합니다.
4.  오른쪽 상단의 "개발자 모드"를 활성화합니다.
5.  "압축 해제된 확장 프로그램을 로드합니다."를 클릭하고, 압축 해제된 폴더 또는 `dist` 폴더를 선택합니다.

## 사용 방법

1.  YouTube 비디오 페이지로 이동합니다.
2.  브라우저 툴바에서 Synthra 확장 프로그램 아이콘을 클릭하여 팝업을 엽니다.
3.  AI 엔진이 로딩될 때까지 잠시 기다립니다 (진행률 표시).
4.  엔진 로딩이 완료되면 팝업 창에 현재 비디오의 정리된 내용이 자동으로 표시됩니다.
5.  팝업 오른쪽 상단의 드롭다운 메뉴에서 원하는 정리 언어(한국어, 영어, 일본어, 중국어)를 선택할 수 있습니다. 언어 변경 시 내용이 해당 언어로 다시 정리됩니다.

## 개발

개발 과정, 프로젝트 구조, 가이드라인 등에 대한 자세한 내용은 [개발 가이드 (DEVELOPMENT_GUIDE.md)](DEVELOPMENT_GUIDE.md)를 참조하십시오.

## 아키텍처

Synthra는 서비스 워커 아키텍처를 사용하여 모든 처리가 로컬 브라우저에서 발생합니다:

1.  **콘텐츠 스크립트 (`ts/content.ts`)**: YouTube 페이지에서 `youtube-transcript` 라이브러리를 사용하여 비디오 스크립트를 추출합니다. 백그라운드로부터 스크립트 요청을 받아 응답합니다.
2.  **백그라운드 서비스 워커 (`ts/background.ts`)**: WebLLM을 사용하여 AI 모델을 로드하고 실행합니다. 팝업으로부터 내용 정리 요청을 받아 처리하고, 콘텐츠 스크립트와 통신하여 스크립트를 가져옵니다.
3.  **팝업 UI (`popup.html`, `ts/popup.ts`)**: 확장 프로그램 설정(언어 선택) 및 상태 표시, 정리된 내용 표시를 담당합니다. 백그라운드와 통신하여 상태를 확인하고 내용 정리를 요청합니다.

모든 핵심 AI 처리는 WebLLM을 통해 서비스 워커 내에서 직접 이루어집니다.

## 개인 정보 보호 정책

Synthra는 개인 정보 보호를 핵심 원칙으로 설계되었습니다:

-   모든 처리는 사용자의 기기 내 로컬 환경에서 이루어집니다.
-   어떠한 데이터도 외부 서버로 전송되지 않습니다.
-   사용자 데이터는 수집되거나 저장되지 않습니다.
-   추적 또는 분석 기능이 포함되어 있지 않습니다.

## FAQ

### 인터넷 연결 없이 어떻게 작동하나요?

Synthra는 확장 프로그램을 설치할 때 AI 모델을 다운로드합니다. 그 후 모든 AI 처리는 인터넷 연결 없이 브라우저에서 직접 이루어집니다. 단, YouTube 비디오 자체를 보거나 스크립트를 가져오려면 인터넷 연결이 필요합니다.

### 왜 팝업을 열 때마다 모델 로딩이 표시되나요?

Synthra는 Chrome의 Manifest V3 규격에 따라 서비스 워커에서 AI 모델을 실행합니다. 브라우저 자원을 효율적으로 사용하기 위해, 서비스 워커는 일정 시간 사용하지 않으면 자동으로 중지될 수 있습니다. 

최신 버전(1.0.1+)에서는 확장 프로그램이 활성화될 때 백그라운드에서 자동으로 모델을 초기화하므로, 팝업을 여는 시점에 따라 다음과 같은 상태가 표시될 수 있습니다:

- 모델 초기화가 이미 완료된 경우: 즉시 "준비 완료" 상태가 표시됩니다.
- 모델 초기화가 진행 중인 경우: "로딩 중" 상태가 표시되며, 백그라운드에서 초기화가 완료될 때까지 기다립니다.
- 브라우저가 서비스 워커를 종료한 후: 새로운 초기화 과정이 시작됩니다.
- 초기화 오류 발생 시: 자동으로 최대 3회까지 초기화를 재시도합니다. 팝업 UI에서 "재시도 중" 상태와 함께 시각적으로 표시됩니다.

이러한 방식은 개인 정보 보호를 위해 모든 처리를 로컬에서 수행하는 기술적 특성입니다. 저희는 로딩 시간을 최소화하고 안정성을 높이기 위해 지속적으로 개선하고 있습니다.

### "콘텐츠 스크립트에 연결할 수 없음" 오류가 발생합니다. 어떻게 해결하나요?

이 오류는 확장 프로그램이 YouTube 페이지의 콘텐츠 스크립트와 통신할 수 없을 때 발생합니다. 다음 방법으로 해결해 보세요:

1. YouTube 페이지를 새로고침한 후 다시 시도하세요.
2. YouTube 페이지가 완전히 로드된 후 확장 프로그램을 사용하세요.
3. 브라우저 개발자 도구에서 콘솔 오류가 있는지 확인하세요.
4. 확장 프로그램을 비활성화했다가 다시 활성화해 보세요.
5. 브라우저를 재시작해 보세요.

위 방법으로도 해결되지 않는 경우, 확장 프로그램을 제거한 후 다시 설치해 보세요.

### 사용 가능한 AI 모델은 무엇인가요?

현재 Google의 Gemma 모델 (gemma-2-2b-it)을 사용하여 브라우저 내에서 실행됩니다.

### Synthra가 브라우저 속도를 느리게 만드나요?

AI 모델은 사용자가 팝업을 열어 내용 정리를 요청할 때만 로드 및 실행됩니다. 대부분의 최신 컴퓨터에서 눈에 띄는 속도 저하 없이 실행되도록 최적화되었습니다.

### 어떤 브라우저를 지원하나요?

현재 Synthra는 Google Chrome 및 Chromium 기반 브라우저(예: Edge, Brave, Opera)에서 사용할 수 있습니다. Firefox 지원은 향후 계획 중입니다.

## 감사의 말

-   [WebLLM](https://webllm.mlc.ai/) - 브라우저 기반 추론 엔진 제공
-   [Gemma](https://ai.google.dev/gemma) - 기반 모델 제공
-   [youtube-transcript](https://github.com/Kakulukian/youtube-transcript) - 유튜브 스크립트 추출 라이브러리
-   [Chrome Extensions API](https://developer.chrome.com/docs/extensions/) - 확장 프로그램 프레임워크

## Technology Stack

- **WebLLM**: For running LLM models in the browser
- **WebGPU**: For GPU acceleration when available
- **Web Workers**: For non-blocking UI experience
- **Chrome Extensions API**: For YouTube integration
- **GGUF Models**: Gemma 3 models in optimized format

## Installation

1. Download this repository
2. Install dependencies with `npm install`
3. Place the appropriate model files:
   - Free model: Place `gemma-3-1b-it-q4_0.gguf` in the `models/free_model/` directory
   - Premium model: Place `google_gemma-3-4b-it-IQ3_XS.gguf` in the `models/premium_model/` directory
4. Open Chrome and navigate to `chrome://extensions/`
5. Enable "Developer mode" (top right corner)
6. Click "Load unpacked" and select the Synthra directory
7. The extension should now be installed and ready to use

## Usage

1. Navigate to any YouTube video
2. Click the Synthra button that appears in the YouTube player controls
3. View the generated summary in the panel that appears

## Development

### Project Structure

```
Synthra/
├── icons/              # Extension icons
├── js/                 # JavaScript files
│   ├── background.js   # Background service worker
│   ├── worker.js       # Web Worker for WebLLM processing
│   ├── content.js      # Content script for YouTube page
│   └── popup.js        # Popup UI script
├── models/             # LLM model files (not included in repo)
│   ├── free_model/     # 1GB model location
│   └── premium_model/  # 2GB model location
├── css/                # CSS stylesheets
├── popup.html          # Extension popup UI
├── premium.html        # Premium upgrade page
├── manifest.json       # Extension manifest
└── README.md           # Documentation
```

### Technology Stack

- JavaScript (ES6+)
- Chrome Extensions API
- WebLLM for LLM model execution
- WebGPU for GPU acceleration
- Web Workers for non-blocking UI
- CSS3 with Flexbox/Grid for layout

## Browser Compatibility

- **Chrome**: Fully compatible (version 113+ required for WebGPU)
- **Edge**: Compatible (WebGPU support required)
- **Firefox**: Not currently supported (pending WebGPU implementation)
- **Safari**: Not currently supported (pending WebGPU implementation)

For browsers without WebGPU support, Synthra will fall back to CPU processing, which may be significantly slower.

## Distribution

### Packaging for Distribution

To create a package for Chrome Web Store submission:

```bash
# Using npm script
npm run package

# Or directly using Node.js
node scripts/deploy.js
```

This will create a `synthra.zip` file that can be submitted to the Chrome Web Store.

### Working with Large Model Files

This project uses Git LFS (Large File Storage) for managing model files. To work with these files:

1. Install Git LFS from [git-lfs.github.com](https://git-lfs.github.com/)
2. After cloning, run:
   ```
   git lfs install
   git lfs pull
   ```

Note: The actual model files are excluded from the repository via `.gitignore` to avoid bloating the repository size. Users need to download the appropriate model files separately.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

For detailed development information, see the [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md).

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- This extension uses WebLLM for local LLM inference
- The models used are based on Google's Gemma models
- Special thanks to the MLC AI community for making WebLLM possible
- Thanks to the open-source AI community for making lightweight language models accessible

---

*Note: The actual LLM models are not included in this repository due to size constraints and licensing requirements. Users need to download compatible models separately and place them in the appropriate directories.*

## 주요 업데이트

### 버전 1.0.2
- 엔진 초기화 안정성 개선 - 오류 발생 시 자동 재시도 기능 추가 및 UI에 재시도 상태 표시
- 재시도 UI 디자인 개선 - 더 명확한 상태 표시 및 애니메이션 추가

### 버전 1.0.1
- 중국어 지원 추가 - 이제 팝업 UI와 요약 기능이 중국어로도 제공됩니다.
- 반응형 디자인 개선 - 다양한 화면 크기에 최적화된 UI 제공. 