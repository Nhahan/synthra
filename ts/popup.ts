// Synthra - Popup Script
// Interacts with the user and communicates with the Offscreen Document via the Service Worker.
// Uses a single, predefined AI model.

// --- Import necessary modules ---
// import "./popup.css"; // Removed CSS import
import { 
    MLCEngineInterface, 
    CreateExtensionServiceWorkerMLCEngine, 
    InitProgressReport, 
} from "@mlc-ai/web-llm";
import { TARGET_MODEL_ID } from './config'; // Import from config
// @ts-ignore
import { ProgressBar, Line } from "progressbar.js";

// --- Constants ---
// TARGET_MODEL_ID moved to config.ts

// --- UI Elements --- 
let statusIndicator: HTMLElement | null;
let statusText: HTMLElement | null;
let statusDescription: HTMLElement | null;
let progressContainer: HTMLElement | null;
let progressBarElement: HTMLElement | null; // Renamed to avoid conflict with ProgressBar instance
let progressText: HTMLElement | null;
let loadingBar: ProgressBar | null = null; // For progressbar.js instance
let loadingContainer: HTMLElement | null = null; // Container for loading bar

// --- State Variables ---
let engine: MLCEngineInterface | null = null; // Engine instance
let isLoading: boolean = true; // Track initial loading state
let currentError: string | null = null;
let currentLanguage: SupportedLanguage = 'ko'; // Default language
let autoSummarize: boolean = true; // Default auto summary setting

// Content script connection retry variables
let contentConnectionRetries = 0;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1500;

// --- 히스토리 관리를 위한 인터페이스 및 변수 추가 ---
interface SummaryHistory {
    videoId: string;
    title: string; 
    summary: string;
    timestamp: number;
    thumbnailUrl?: string;
}

let summaryHistories: SummaryHistory[] = [];
const MAX_HISTORY_COUNT = 10;

// 트랜스크립트 처리 관련 상수 추가
// 하드코딩 값 제거
// const MAX_TOKENS_LIMIT = 3500; // 안전하게 4096보다 작게 설정
const ESTIMATED_CHARS_PER_TOKEN = 3; // 한국어 기준 대략적인 추정치
// 모델 컨텍스트 창 크기에 기반한 문자 제한을 계산하기 위한 기본값
let MAX_TOKENS_LIMIT = 3000; // 기본값, 모델에서 실제 값을 가져오면 업데이트됨
let MAX_CHARS_LIMIT = MAX_TOKENS_LIMIT * ESTIMATED_CHARS_PER_TOKEN;

// 청크 크기 상수 정의
const MAX_CHARS_PER_CHUNK = 4000; // 한 청크당 최대 문자 수

// --- Initialization ---
document.addEventListener('DOMContentLoaded', initPopup);

async function initPopup(): Promise<void> {
    // 트랜스크립트 확인 로그 추가
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0] && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'getTranscript' }, (response) => {
                if (response && response.transcript) {
                    const previewText = response.transcript.slice(0, 200);
                    console.log("[Popup] 트랜스크립트 샘플 (첫 200자):", previewText);
                    console.log(`[Popup] 트랜스크립트 전체 길이: ${response.transcript.length}자`);
                } else {
                    console.log("[Popup] 트랜스크립트를 가져올 수 없음");
                }
            });
        }
    } catch (error) {
        console.error("[Popup] 트랜스크립트 확인 중 오류:", error);
    }

    // Assign UI elements
    statusIndicator = document.getElementById('model-status-indicator');
    statusText = document.getElementById('model-status-text');
    statusDescription = document.getElementById('status-description');
    progressContainer = document.getElementById('progress-container');
    progressBarElement = document.getElementById('progress-bar');
    progressText = document.getElementById('progress-text');
    const languageSelect = document.getElementById('language-select') as HTMLSelectElement;
    const autoSummarizeToggle = document.getElementById('autoSummarizeToggle') as HTMLInputElement;

    // Load saved settings - 초기값 강제 설정 (항상 true로 시작)
    await chrome.storage.local.set({ 
        autoSummarize: true,
        autoSummaryEnabled: true // 하위 호환성 유지
    });
    autoSummarize = true;
    console.log(`[Popup] 자동 요약 기능 강제 활성화됨`);
    
    // Initialize UI with saved settings
    if (languageSelect) {
        languageSelect.value = currentLanguage;
        languageSelect.addEventListener('change', handleLanguageChange);
    }

    if (autoSummarizeToggle) {
        autoSummarizeToggle.checked = true; // 항상 활성화 상태로 UI 설정
        autoSummarizeToggle.addEventListener('change', handleAutoSummaryToggle);
    }
    
    // Update UI text based on loaded language *immediately*
    updateUIText(); 

    // Initialize progress bar UI
    ensureProgressBarExists();
    
    if (loadingContainer) {
        // 프로그레스 바 초기화
        loadingBar = new Line(loadingContainer, {
            strokeWidth: 4,
            easing: "easeInOut",
            duration: 1400,
            color: "#6e8efb", // Synthra blue
            trailColor: "#e0e0e0",
            trailWidth: 1,
            svgStyle: { width: "100%", height: "100%" },
            text: {
                // 텍스트 표시 활성화
                value: '0%',
                alignToBottom: false,
                style: {
                    color: '#4E5968',
                    position: 'absolute',
                    right: '0',
                    top: '-20px',
                    padding: 0,
                    margin: 0,
                    fontSize: '12px',
                    fontWeight: 'normal'
                }
            },
            // 스텝 함수 추가
            step: (state: any, bar: any) => {
                const progress = Math.round(bar.value() * 100);
                bar.setText(`${progress}%`);
            }
        });
        
        // 초기 값 설정
        loadingBar.set(0); 
        loadingBar.setText('0%');
    }

    // 백그라운드 서비스 워커에서 엔진 상태를 확인하고 엔진을 초기화합니다 (항상)
    try {
        console.log("[Popup] Checking engine status from background service worker...");
        
        // 상태 업데이트 - EngineStatus 객체로 변경
        updateStatusUI({
            state: 'initializing',
            progress: 0,
            description: 'AI 엔진 상태 확인 중...'
        });
        
        const response = await chrome.runtime.sendMessage({ 
            action: 'checkEngineStatus',
            // 항상 모델을 초기화해야 함을 명시 (팝업 상태와 관계없이)
            forceInitialize: true 
        });
        console.log("[Popup] Engine status response:", response);
        
        if (response && response.isReady === true) {
            console.log("[Popup] Background reports engine is ready, using existing instance");
            // 엔진이 이미 준비되어 있음
            engine = await CreateExtensionServiceWorkerMLCEngine(TARGET_MODEL_ID, {
                initProgressCallback: undefined  // 이미 초기화되어 있으므로 콜백 불필요
            });
            console.log("[Popup] Engine reference obtained");
            isLoading = false;
            updateStatusUI({
                state: 'ready',
                progress: 100
            });
            // Update UI again after engine status changes (might affect status descriptions)
            updateUIText();
            // Request summary if engine is ready and on a YouTube page
            if (autoSummarize) {
                requestSummaryIfApplicable();
            }

            // 엔진 초기화 성공 후 모델 정보 가져오기
            if (engine) {
                try {
                    // 모델의 컨텍스트 윈도우 크기 가져오기 (모델별로 다를 수 있음)
                    const modelInfo = await engine.runtimeStatsText();
                    console.log("[Popup] 모델 정보:", modelInfo);
                    
                    // 컨텍스트 윈도우 크기 추출 시도
                    const contextSizeMatch = modelInfo.match(/context_window_size\s*:\s*(\d+)/i);
                    if (contextSizeMatch && contextSizeMatch[1]) {
                        const contextSize = parseInt(contextSizeMatch[1]);
                        if (!isNaN(contextSize) && contextSize > 0) {
                            // 컨텍스트 윈도우 크기의 80%만 사용 (안전 마진)
                            MAX_TOKENS_LIMIT = Math.floor(contextSize * 0.8);
                            MAX_CHARS_LIMIT = MAX_TOKENS_LIMIT * ESTIMATED_CHARS_PER_TOKEN;
                            console.log(`[Popup] 모델 컨텍스트 윈도우 크기: ${contextSize}, 사용 가능 토큰: ${MAX_TOKENS_LIMIT}`);
                        }
                    }
                    
                } catch (infoError) {
                    console.warn("[Popup] 모델 정보를 가져오는 데 실패했습니다:", infoError);
                    // 기본값 사용
                    const defaultContextSize = 4096; // 대부분의 MLC 모델에서 사용하는 일반적인 크기
                    MAX_TOKENS_LIMIT = Math.floor(defaultContextSize * 0.7); // 30% 안전 마진
                    MAX_CHARS_LIMIT = MAX_TOKENS_LIMIT * ESTIMATED_CHARS_PER_TOKEN;
                    console.log(`[Popup] 모델 정보를 가져오지 못해 기본값 사용: ${MAX_TOKENS_LIMIT} 토큰`);
                }
            }

            return;
        } else if (response && response.isInitializing === true) {
            // 백그라운드에서 이미 엔진 초기화가 진행 중인 경우
            console.log("[Popup] Background reports engine is initializing");
            
            // 재시도 중인지 확인하고 상태에 반영
            if (response.isRetrying) {
                const retryCount = response.retryCount || 0;
                const maxRetries = response.maxRetries || 3;
                const retryMsg = `재시도 중 (${retryCount}/${maxRetries})`;
                console.log(`[Popup] Engine initialization is retrying (${retryCount}/${maxRetries})`);
                
                // 재시도 상태로 UI 업데이트
                updateStatusUI({
                    state: 'retrying',
                    progress: response.progress || 0.5, // 백그라운드에서 전달받은 진행률 사용
                    retryCount: retryCount,
                    maxRetries: maxRetries,
                    description: retryMsg
                });
            } else {
                // 일반 초기화 중 상태
                updateStatusUI({
                    state: 'loading',
                    progress: response.progress || 0.5, // 백그라운드에서 전달받은 진행률 사용
                    description: '백그라운드에서 모델 로딩 중...'
                });
            }
            
            // 엔진 참조 생성 시도 (진행 상황 수신용)
            try {
                engine = await CreateExtensionServiceWorkerMLCEngine(TARGET_MODEL_ID, {
                    initProgressCallback: (report: InitProgressReport) => {
                        const progress = report.progress; // 0과 1 사이의 값으로 유지
                        console.log("[Popup] Engine Init Progress:", report.text, `${Math.floor(progress * 100)}%`);
                        
                        let conciseProgressText = '';
                        const match = report.text.match(/Fetching param cache\[(\d+\/\d+)\]: (\d+(?:\.\d+)?MB) fetched\. (\d+)% completed, (\d+) secs elapsed/);
                        if (match) {
                            conciseProgressText = `파일 [${match[1]}]: ${match[2]} 로딩 중. ${match[3]}% 완료, ${match[4]}초 경과.`;
                        } else if (report.text.includes('Finish loading')) {
                            conciseProgressText = `모델 로딩 완료. 초기화 중...`;
                            // 로딩이 완료되면 자동으로 준비 상태로 업데이트
                            if (report.progress >= 0.99) {
                                setTimeout(() => {
                                    isLoading = false;
                                    updateStatusUI({
                                        state: 'ready',
                                        progress: 1.0,
                                        description: '모델 준비 완료'
                                    });
                                    updateUIText();
                                }, 1000); // 약간의 지연 후 준비 상태로 변경
                            }
                        } else {
                            conciseProgressText = `로딩 중... ${Math.floor(progress * 100)}%`; 
                        }
                        
                        // 재시도 중인지 확인하고 상태 유지
                        if (response.isRetrying) {
                            const retryCount = response.retryCount || 0;
                            const maxRetries = response.maxRetries || 3;
                            updateStatusUI({
                                state: 'retrying',
                                progress: progress,
                                retryCount: retryCount,
                                maxRetries: maxRetries,
                                description: `재시도 중 (${retryCount}/${maxRetries}) - ${conciseProgressText}`
                            });
                        } else {
                            updateStatusUI({
                                state: 'loading',
                                progress: progress,
                                description: conciseProgressText
                            });
                        }
                        
                        // loadingBar가 있으면 항상 최신 상태로 업데이트
                        if (loadingBar) {
                            loadingBar.animate(progress);
                        }
                    }
                });
                
                // 엔진 참조를 획득했지만, 아직 초기화 중일 수 있음
                console.log("[Popup] Engine reference obtained while background is initializing");
                
                // 팝업 UI는 정상 작동하도록 조정
                updateUIText();
                return;
                
            } catch (err) {
                // 엔진 참조 생성 실패 - 심각한 오류가 아님
                console.warn("[Popup] Could not obtain engine reference, but will continue:", err);
                
                // 팝업 UI는 정상 작동하도록 조정
                updateUIText();
                return;
            }
        } else if (response && response.error) {
            // 초기화 오류 발생 - 비치명적 오류로 처리
            console.warn("[Popup] Background reports engine initialization error:", response.error);
            
            // 재시도 중인지 확인
            if (response.isRetrying) {
                const retryCount = response.retryCount || 0;
                const maxRetries = response.maxRetries || 3;
                console.log(`[Popup] Engine is retrying after error (${retryCount}/${maxRetries})`);
                
                // 오류가 있지만 재시도 중인 상태로 표시
                updateStatusUI({
                    state: 'retrying',
                    progress: 0,
                    retryCount: retryCount,
                    maxRetries: maxRetries,
                    description: `재시도 중 (${retryCount}/${maxRetries}) - 이전 오류: ${response.error}`
                });
                updateUIText();
                return;
            }
            
            // 타임아웃 오류면 직접 엔진 초기화 시도 (backend 오류시 직접 초기화)
            if (response.error.includes('timeout') || !response.isInitializing) {
                console.log("[Popup] Timeout or initialization error, attempting direct initialization");
                // 재시도할 예정이므로 continue 대신 바로 try 구문을 종료
                // 아래의 서비스 워커에 준비된 엔진이 없거나 오류 발생 시 새로 초기화 로직으로 진행됨
            } else {
                // isFatalError 플래그가 설정되지 않았으면 경고로만 표시하고 계속 진행
                if (!response.isFatalError) {
                    console.log("[Popup] Non-fatal error, proceeding with UI initialization");
                    
                    // 오류 메시지 표시하지만 치명적이지 않음
                    currentError = response.error;
                    updateStatusUI({
                        state: 'error',
                        progress: 0,
                        error: currentError
                    });
                    updateUIText();
                    return;
                }
                
                // 치명적 오류인 경우에만 예외 발생
                throw new Error(response.error);
            }
        } else {
            console.log("[Popup] Background reports engine is not ready, will initialize new instance");
            // 계속해서 새 엔진 인스턴스 초기화
        }
    } catch (err) {
        console.error("[Popup] Error checking engine status:", err);
        // 오류 발생 시 새 엔진 인스턴스 초기화
    }

    // 서비스 워커에 준비된 엔진이 없거나 오류 발생 시 새로 초기화
    console.log("[Popup] Initializing engine directly in popup");
    updateStatusUI({
        state: 'initializing',
        progress: 0,
        description: '팝업에서 직접 엔진 초기화 중...'
    });
    
    try {
        console.log(`[Popup] Initializing engine with model: ${TARGET_MODEL_ID}`);
        engine = await CreateExtensionServiceWorkerMLCEngine(TARGET_MODEL_ID, {
            initProgressCallback: (report: InitProgressReport) => {
                const progress = Math.floor(report.progress * 100);
                console.log("[Popup] Engine Init Progress:", report.text, `${progress}%`);

                // --- Extract and format progress text --- 
                let conciseProgressText = '';
                const match = report.text.match(/Fetching param cache\[(\d+\/\d+)\]: (\d+(?:\.\d+)?MB) fetched\. (\d+)% completed, (\d+) secs elapsed/);
                if (match) {
                    // Example: "Fetching cache[2/42]: 95MB fetched. 6% completed, 18 secs elapsed."
                    conciseProgressText = `[${match[1]}]: ${match[2]} fetched. ${match[3]}% completed, ${match[4]} secs elapsed.`;
                } else {
                    // Fallback if the format doesn't match
                    conciseProgressText = `로딩 중... ${progress}%`; 
                }
                // -----------------------------------------

                updateStatusUI({
                    state: 'loading',
                    progress: progress,
                    description: conciseProgressText
                }); 
                if (loadingBar) {
                    loadingBar.animate(report.progress); 
                }
            }
        });

        // 엔진 인스턴스가 실제로 생성되었는지 확인
        if (!engine) {
            throw new Error("Engine instance is null after initialization");
        }

        // 엔진 기능 테스트로 실제 작동하는지 확인
        try {
            await engine.chat?.completions?.create({
                messages: [{ role: "user", content: "test" }],
                max_tokens: 1,
                temperature: 0
            });
        } catch (testError) {
            console.error("[Popup] Engine function test failed:", testError);
            throw new Error("Engine initialization appeared to succeed but function test failed");
        }

        console.log("[Popup] Engine initialized successfully.");
        isLoading = false;
        updateStatusUI({
            state: 'ready',
            progress: 100
        });
        
        // Update UI again after engine status changes (might affect status descriptions)
        updateUIText();
        // Request summary if engine is ready and on a YouTube page and auto summary is enabled
        if (autoSummarize) {
            requestSummaryIfApplicable();
        }

    } catch (error: unknown) {
        const typedError = error instanceof Error ? error : new Error(String(error));
        console.error("[Popup] Engine initialization failed:", typedError);
        isLoading = false;
        currentError = `Engine initialization failed: ${typedError.message}`; // Use English error message internally?
        updateStatusUI({
            state: 'error',
            progress: 0,
            error: currentError
        });
        // Update UI text AFTER setting error status
        updateUIText(); 
    }

    // 기존 코드 이후에 추가
    // 히스토리 버튼과 복사 버튼 이벤트 리스너 설정
    const historyButton = document.getElementById('history-button');
    const copyButton = document.getElementById('copy-button');
    
    if (historyButton) {
        historyButton.addEventListener('click', toggleHistoryView);
    }
    
    if (copyButton) {
        copyButton.addEventListener('click', copySummaryToClipboard);
    }
    
    // 저장된 히스토리 로드
    loadSummaryHistories();
    
    // 로그 출력 테스트 (트랜스크립트 가져오기)
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    if (activeTab?.id && activeTab?.url?.includes("youtube.com/watch")) {
        try {
            console.log("[Popup] 트랜스크립트 요청 테스트 시작");
            const response = await chrome.tabs.sendMessage(activeTab.id, { action: "getTranscript" })
                .catch(err => {
                    console.error("[Popup] 트랜스크립트 요청 에러:", err);
                    return null;
                });
                
            if (response && response.transcript) {
                console.log("[Popup] 트랜스크립트 샘플(200자):", 
                    response.transcript.substring(0, 200));
            } else {
                console.log("[Popup] 트랜스크립트 응답 없음 또는 오류");
            }
        } catch (e) {
            console.error("[Popup] 트랜스크립트 요청 테스트 실패:", e);
        }
    }

    // 자동 요약 토글 초기화
    initAutoSummarizeToggle();
    
    // 설정 변경 감지 리스너 설정
    setupStorageListener();
}

// UI 상태 업데이트
async function updateStatusUI(engineStatus: EngineStatus): Promise<void> {
    const statusSection = document.getElementById('status-section');
    const statusOnlyView = document.getElementById('status-only-view');
    const mainContent = document.getElementById('main-content');
    const summarySection = document.getElementById('summary-section');
    const loadingIndicator = document.getElementById('loading-indicator');
    const statusMessage = document.getElementById('status-message');
    const retryMessage = document.getElementById('retry-message');
    const errorMessage = document.getElementById('error-message');
    const retryButton = document.getElementById('retry-button');
    const statusDescription = document.getElementById('status-description');

    // 로딩 컨테이너 확인 및 표시/숨김 처리
    if (!loadingContainer) {
        ensureProgressBarExists();
    }

    // 재시도 상태 메시지 설정
    const setupRetryMessage = (count?: number, max?: number) => {
        if (retryMessage && count !== undefined && max !== undefined) {
            retryMessage.textContent = `재시도 중... (${count}/${max})`;
            retryMessage.style.display = 'block';
        }
    };

    // 오류 메시지 설정
    const setupErrorMessage = (error: string | null | undefined) => {
        if (errorMessage && error) {
            errorMessage.textContent = `오류: ${error}`;
            errorMessage.style.display = 'block';
            
            if (retryButton) {
                retryButton.style.display = 'inline-block';
            }
        } else if (errorMessage) {
            errorMessage.style.display = 'none';
            
            if (retryButton) {
                retryButton.style.display = 'none';
            }
        }
    };

    if (engineStatus) {
        const { state, progress, error, retryCount, maxRetries, description } = engineStatus;
    

        // 상태 표시등 업데이트
        if (statusIndicator) {
            // 모든 클래스 제거
            statusIndicator.classList.remove('loading', 'ready', 'error');
            
            // 상태에 따라 적절한 클래스 추가
            if (state === 'ready') {
                statusIndicator.classList.add('ready');
            } else if (state === 'error') {
                statusIndicator.classList.add('error');
            } else {
                // 로딩 중, 초기화 중, 재시도 중 모두 로딩 표시
                statusIndicator.classList.add('loading');
            }
        }

        // 로딩 상태 업데이트
        if (loadingIndicator) {
            if (state === 'initializing' || state === 'loading' || state === 'retrying') {
                loadingIndicator.style.display = 'block';
                const percentage = progress !== undefined ? Math.min(Math.round(progress * 100), 100) : 0;
                (loadingIndicator as HTMLElement).dataset.progress = `${percentage}%`;
            } else {
                loadingIndicator.style.display = 'none';
            }
        }

        // 진행률 표시 업데이트
        if (loadingContainer) {
            if (state === 'initializing' || state === 'loading' || state === 'retrying') {
                // 로딩 중인 경우에만 표시
                loadingContainer.style.display = 'block';
                
                if (loadingBar) {
                    // progress 값이 0과 1 사이의 소수여야 함
                    const normalizedProgress = progress !== undefined ? Math.min(progress, 1) : 0;
                    loadingBar.animate(normalizedProgress);
                    
                    // 진행률 텍스트 추가
                    const progressPercentage = Math.round(normalizedProgress * 100);
                    loadingBar.setText(`${progressPercentage}%`);
                }
            } else {
                // 로딩 중이 아니면 숨김
                loadingContainer.style.display = 'none';
            }
        }

        // 상태 메시지 업데이트
        if (statusMessage) {
            let message = '';
            
            switch (state) {
                case 'initializing':
                case 'loading':
                    message = description || '로딩 중...';
                    break;
                case 'retrying':
                    message = description || '엔진 재시작 중...';
                    setupRetryMessage(retryCount, maxRetries);
                    break;
                case 'ready':
                    message = '준비됨';
                    break;
                case 'error':
                    message = '오류 발생';
                    break;
                default:
                    message = '상태 확인 중...';
            }
            
            statusMessage.textContent = message;
        }
        
        // 상태 설명 업데이트
        if (statusDescription && description) {
            // description이 제공된 경우 직접 텍스트 설정
            statusDescription.textContent = description;
        }

        // 오류 메시지 설정
        setupErrorMessage(error);

        // 재시도 메시지 표시/숨김 처리
        if (retryMessage) {
            if (state === 'retrying' && retryCount !== undefined && maxRetries !== undefined) {
                retryMessage.style.display = 'block';
            } else {
                retryMessage.style.display = 'none';
            }
        }

        // UI 모드 전환: 준비 완료 시 메인 콘텐츠 표시, 그 외에는 상태 화면만 표시
        if (statusOnlyView && mainContent) {
            if (state === 'ready') {
                // 메인 콘텐츠 표시 모드
                statusOnlyView.style.display = 'none';
                mainContent.style.display = 'flex';
                
                // 요약 정보가 있는지 확인
                const summaryContent = document.getElementById('summary-content');
                if (summaryContent && summaryContent.textContent && summaryContent.textContent.trim() !== '') {
                    // 요약 내용이 있으면 summary-container 표시
                    const summaryContainer = document.getElementById('summary-container');
                    if (summaryContainer) {
                        summaryContainer.style.display = 'block';
                    }
                }
            } else {
                // 상태 화면 표시 모드
                statusOnlyView.style.display = 'flex';
                mainContent.style.display = 'none';
            }
        }
    }
}

// Helper to ensure progress bar elements are in the DOM
function ensureProgressBarExists(): void {
    // ONLY ensure the container for progressbar.js exists
    loadingContainer = document.getElementById('loadingContainer');

    if (!loadingContainer) {
        loadingContainer = document.createElement('div');
        loadingContainer.id = 'loadingContainer';
        loadingContainer.style.height = '8px'; // Adjusted height
        loadingContainer.style.width = '100%';
        loadingContainer.style.marginTop = '5px';
        loadingContainer.style.marginBottom = '5px'; // Add some margin below
        loadingContainer.style.display = 'block'; // Show by default (changed from 'none')
        // Insert it after the status description
        document.getElementById('status-description')?.after(loadingContainer);
    } else {
        loadingContainer.style.display = 'block'; // Make sure it's visible
    }
}

// --- Language Handling ---
async function handleLanguageChange(event: Event): Promise<void> {
    const selectElement = event.target as HTMLSelectElement;
    currentLanguage = selectElement.value as SupportedLanguage;
    console.log(`[Popup] Language changed to: ${currentLanguage}`);
    await chrome.storage.local.set({ selectedLanguage: currentLanguage });
    
    // 언어 변경 후 상태 UI 업데이트
    const status: EngineStatus = {
        state: isLoading ? 'initializing' : currentError ? 'error' : 'ready',
        progress: 0,
        error: currentError
    };
    updateStatusUI(status);
}

// Update UI text based on currentLanguage
function updateUIText(): void {
    console.log(`[Popup] Updating UI text for language: ${currentLanguage}`);
    // Update elements with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        if (key) {
            const localizedString = chrome.i18n.getMessage(key);
            if (localizedString) {
                // Directly set textContent for elements tagged with data-i18n
                element.textContent = localizedString;
            } else {
                console.warn(`[Popup] No translation found for key: ${key} in language ${currentLanguage}`);
            }
        }
    });

    // Update dynamic status and summary texts separately
    updateDynamicStatusText();
    updateDynamicSummaryText();
}

// Helper to update status texts based on current state and language
function updateDynamicStatusText(): void {
    if (!statusText || !statusDescription) return;
    const statusIndicatorClass = statusIndicator?.className || '';
    let baseTextKey = '';
    let descriptionKey = '';

    if (statusIndicatorClass.includes('loading') || statusIndicatorClass.includes('initializing')) {
        if (statusDescription?.textContent?.includes('재시도 중')) {
            // 재시도 상태 처리
            baseTextKey = "statusRetrying";
            descriptionKey = "statusDescRetrying";
        } else {
            baseTextKey = statusIndicatorClass.includes('initializing') ? "statusInitializing" : "statusLoading";
            descriptionKey = statusIndicatorClass.includes('initializing') ? "statusDescInitializing" : "statusDescLoading";
        }
    } else if (statusIndicatorClass.includes('ready')) {
        baseTextKey = "statusReady";
        descriptionKey = "statusDescReady";
    } else if (statusIndicatorClass.includes('error')) {
        baseTextKey = "statusError";
        descriptionKey = "statusDescError"; 
    } else { baseTextKey = "statusIdle"; descriptionKey = "statusDescIdle"; }

    statusText.textContent = chrome.i18n.getMessage(baseTextKey) || baseTextKey;
    
    // 재시도 상태인 경우 기존 텍스트 유지 (원본 메시지 포맷 유지)
    if (baseTextKey === "statusRetrying" && statusDescription?.textContent?.includes('재시도 중')) {
        // 재시도 상태 메시지는 그대로 유지
        return;
    }
    
    let desc = chrome.i18n.getMessage(descriptionKey) || descriptionKey;
    if (descriptionKey === "statusDescError" && currentError) {
        const errorDetail = currentError || (chrome.i18n.getMessage("unknownError") || "Unknown error");
        desc = (chrome.i18n.getMessage("statusDescErrorPlaceholder") || "Error: {error}").replace("{error}", errorDetail);
    }
    statusDescription.textContent = desc;
}

// Helper to update summary status/placeholder text based on language
function updateDynamicSummaryText(): void {
    const summaryContent = document.getElementById('summary-content');
    const summaryContainer = document.getElementById('summary-container');
    if (!summaryContainer || !summaryContent || summaryContainer.style.display === 'none') return;

    const currentText = summaryContent.textContent || "";
    // Check which status message is currently displayed and translate it
    // Need to check against default English strings or use a state variable
    if (summaryStatus === 'loading') { // Assuming summaryStatus variable exists
        summaryContent.textContent = chrome.i18n.getMessage("summaryLoading") || "Generating summary...";
    } else if (summaryStatus === 'error') {
        const errorDetail = currentError || (chrome.i18n.getMessage("unknownError") || "Unknown error");
        summaryContent.textContent = `${chrome.i18n.getMessage("summaryErrorPrefix") || "Error"}: ${errorDetail}`;
    } else if (summaryStatus === 'not_applicable') {
        summaryContent.textContent = chrome.i18n.getMessage("summaryNotApplicable") || "Must be on a YouTube video page.";
    }
    // Do not modify if status is 'success'
}

// --- Summary Handling ---
let summaryStatus: 'idle' | 'loading' | 'success' | 'error' | 'not_applicable' = 'idle'; // Add state variable

async function requestSummaryIfApplicable(): Promise<void> {
    // 자동 요약이 꺼져 있으면 요약을 표시하지 않음
    if (!autoSummarize) {
        console.log("[Popup] Auto summary disabled, skipping summary request");
        const summaryContainer = document.getElementById('summary-container');
        if (summaryContainer) {
            summaryContainer.style.display = 'none';
        }
        return;
    }

    try {
        // Get active tab and check for YouTube URL
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeTab = tabs[0];
        if (!activeTab || !activeTab.url || !activeTab.url.includes("youtube.com/watch")) {
            // Not a YouTube video page
            displaySummary('not_applicable', '');
            return;
        }

        // 엔진이 준비되지 않았으면 요약을 표시하지 않음
        if (!engine || isLoading || currentError) {
            console.log("[Popup] Engine not ready, skipping summary request");
            return;
        }

        // Show loading state
        displaySummary('loading');
        
        // Reset retry counter when making a new request
        contentConnectionRetries = 0;
        document.getElementById('error-message')?.style.setProperty('display', 'none', 'important');
        document.getElementById('retrying-message')?.style.setProperty('display', 'none', 'important');
        
        // 먼저 콘텐츠 스크립트가 존재하는지 확인하기 위해 ping 메시지 전송
        try {
            console.log(`[Popup] Checking if content script is loaded on tab ${activeTab.id}...`);
            const pingResponse = await chrome.tabs.sendMessage(activeTab.id!, { action: "ping" })
                .catch(error => {
                    console.warn(`[Popup] Ping failed:`, error);
                    throw error;
                });
                
            if (pingResponse && pingResponse.status === "alive") {
                console.log(`[Popup] Content script is loaded, proceeding...`);
            } else {
                throw new Error("Content script ping returned unexpected response");
            }
        } catch (pingError) {
            // 콘텐츠 스크립트가 응답하지 않으면, 스크립트를 수동으로 주입
            console.log(`[Popup] Content script not responding, attempting to inject it...`);
            try {
                // scripting API를 사용하여 콘텐츠 스크립트 주입
                await chrome.scripting.executeScript({
                    target: { tabId: activeTab.id! },
                    files: ['js/content.js']
                });
                console.log(`[Popup] Successfully injected content script`);
                
                // 스크립트가 초기화될 시간을 주기 위해 대기 (더 길게 설정)
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // 주입 후 다시 ping 시도하여 확인
                try {
                    const pingRetryResponse = await chrome.tabs.sendMessage(activeTab.id!, { action: "ping" });
                    if (!pingRetryResponse || pingRetryResponse.status !== "alive") {
                        throw new Error("Content script did not respond properly after injection");
                    }
                    console.log(`[Popup] Content script verified after injection`);
                } catch (pingRetryError) {
                    console.error(`[Popup] Content script verification failed after injection:`, pingRetryError);
                    throw new Error("Content script did not initialize properly after injection");
                }
            } catch (injectError) {
                console.error(`[Popup] Failed to inject content script:`, injectError);
                displaySummary('error', 'Failed to inject content script. Please reload the YouTube page.');
                return;
            }
        }
        
        // Try to get transcript
        await requestTranscriptAndSummarize(activeTab.id);
    } catch (error) {
        console.error("[Popup] Error in requestSummaryIfApplicable:", error);
        displaySummary('error', String(error || 'Unknown error'));
    }
}

function displaySummary(status: 'loading' | 'success' | 'error' | 'not_applicable', content: string = ""): void {
    const summaryContainer = document.getElementById('summary-container');
    const summaryContent = document.getElementById('summary-content');
    const summaryLoading = document.getElementById('summary-loading');

    if (!summaryContainer || !summaryContent) {
        console.error("[Popup] Summary UI elements not found.");
        return;
    }

    summaryStatus = status; // Update the status state
    summaryContainer.style.display = "block";
    
    // Hide loading animation by default
    if (summaryLoading) {
        summaryLoading.style.display = 'none';
    }

    switch (status) {
        case "loading":
            // Show loading animation
            summaryContent.textContent = '';
            if (summaryLoading) {
                summaryLoading.style.display = "flex";
            }
            break;
        case "success":
            // 로딩 숨기고 내용을 바로 표시 (애니메이션 없이)
            if (summaryLoading) {
                summaryLoading.style.display = "none";
            }
            
            // 내용을 바로 표시
            summaryContent.innerHTML = ''; // 기존 내용 삭제
            summaryContent.textContent = content; // 텍스트로 내용 설정 (HTML 태그 없이)
            
            // 성공적으로 요약이 생성되면 자동 저장
            saveSummary(true);
            break;
        case "error":
            currentError = content; // Store the error detail
            if (summaryLoading) {
                summaryLoading.style.display = "none";
            }
            summaryContent.textContent = `${chrome.i18n.getMessage("summaryErrorPrefix") || "Error"}: ${content}`;
            break;
        case "not_applicable":
            currentError = null; // Clear error when not applicable
            if (summaryLoading) {
                summaryLoading.style.display = "none";
            }
            summaryContent.textContent = chrome.i18n.getMessage("summaryNotApplicable") || "Must be on a YouTube video page.";
            break;
        default:
            summaryContainer.style.display = "none";
            break;
    }
    
    // Update texts after changing content
    updateDynamicStatusText(); // Ensure main status text is also up-to-date
}

// New function to handle transcript request with retries
async function requestTranscriptAndSummarize(tabId?: number): Promise<void> {
    if (!tabId) {
        displaySummary('error', '탭 ID를 찾을 수 없습니다');
        return;
    }

    try {
        console.log(`[Popup] 트랜스크립트 요청 중... (탭 ID: ${tabId})`);
        
        // 콘텐츠 스크립트에 메시지 전송
        const response = await chrome.tabs.sendMessage(tabId, { action: "getTranscript" })
            .catch((error) => {
                console.error("[Popup] 콘텐츠 스크립트 메시지 전송 오류:", error);
                throw new Error(`콘텐츠 스크립트 연결 실패: ${error.message || "알 수 없는 오류"}`);
            });
            
        if (!response) {
            throw new Error("콘텐츠 스크립트에서 응답이 없습니다");
        }

        if (response.error) {
            console.error("[Popup] 콘텐츠 스크립트에서 오류 반환:", response.error);
            throw new Error(response.error);
        }

        if (!response.transcript) {
            throw new Error("트랜스크립트 데이터가 없습니다");
        }

        const transcriptLength = response.transcript.length;
        console.log(`[Popup] 트랜스크립트 수신 완료 (${transcriptLength} 글자). 요약 생성 중...`);
        console.log("[Popup] 트랜스크립트 샘플:", response.transcript.substring(0, 200));
        
        // 트랜스크립트를 처리하여 요약 생성
        await processTranscriptAndSummarize(response.transcript, response.videoId);

    } catch (error) {
        console.error(`[Popup] requestTranscriptAndSummarize 오류:`, error);
        
        // 콘텐츠 스크립트 연결 오류 처리
        if (error instanceof Error && 
            (error.message.includes("콘텐츠 스크립트 연결 실패") || 
             error.message.includes("Could not establish connection"))) {
            
            // 오류 메시지 표시
            const errorMessageEl = document.getElementById('error-message');
            if (errorMessageEl) {
                errorMessageEl.style.setProperty('display', 'block', 'important');
            }
            
            // 재시도 로직
            if (contentConnectionRetries < MAX_RETRIES) {
                contentConnectionRetries++;
                console.log(`[Popup] 콘텐츠 스크립트 연결 재시도 중 (${contentConnectionRetries}/${MAX_RETRIES})...`);
                
                // 재시도 메시지 표시
                const retryingMessageEl = document.getElementById('retrying-message');
                if (retryingMessageEl) {
                    retryingMessageEl.style.setProperty('display', 'flex', 'important');
                }
                
                // 대기 후 재시도
                setTimeout(() => {
                    requestTranscriptAndSummarize(tabId);
                }, RETRY_DELAY);
                return;
            }
        } else if (error instanceof Error && error.message.includes("ContextWindowSizeExceededError")) {
            // 컨텍스트 윈도우 크기 초과 오류 처리
            console.error("[Popup] 컨텍스트 윈도우 크기 초과 오류가 발생했습니다. 트랜스크립트를 분할하여 처리합니다.");
            try {
                // 트랜스크립트 다시 요청 및 분할 처리
                const response = await chrome.tabs.sendMessage(tabId, { action: "getTranscript" });
                if (response && response.transcript) {
                    const basePrompt = getPromptForLanguage(currentLanguage);
                    const summaryContent = await processLongTranscript(response.transcript, basePrompt);
                    console.log("[Popup] 분할 처리 후 요약 생성 완료:", summaryContent);
                    displaySummary('success', summaryContent);
                    return;
                }
            } catch (innerError) {
                console.error("[Popup] 분할 처리 중 오류:", innerError);
            }
        }
        
        // 다른 모든 오류는 요약 화면에 표시
        displaySummary('error', String(error));
    }
}

// 현재 언어에 맞는 프롬프트 반환
function getPromptForLanguage(language: SupportedLanguage): string {
    switch (language) {
        case 'en':
            return "Summarize the following YouTube video transcript into 3-5 key points. Please respond in English only:";
        case 'ja':
            return "次のYouTubeビデオのトランスクリプトを3〜5つの重要なポイントに要約してください。必ず日本語で答えてください:";
        case 'zh':
            return "请将以下YouTube视频的文字记录总结为3-5个关键要点。请务必用中文回答:";
        case 'ko':
        default:
            return "다음 유튜브 영상 대본의 내용을 3-5개의 중요 포인트로 요약해줘. 반드시 한국어로 답변해주세요:";
    }
}

// 트랜스크립트를 청크로 분할하는 함수 
function splitTranscriptIntoChunks(transcript: string, maxCharsPerChunk: number): string[] {
    const chunks: string[] = [];
    let start = 0;
    
    while (start < transcript.length) {
        let end = Math.min(start + maxCharsPerChunk, transcript.length);
        
        // 단어나 문장이 잘리지 않게 조정
        if (end < transcript.length) {
            // 마침표, 물음표, 느낌표로 끝나는 문장 경계 찾기
            const sentenceEnd = transcript.lastIndexOf('.', end);
            const questionEnd = transcript.lastIndexOf('?', end);
            const exclamationEnd = transcript.lastIndexOf('!', end);
            
            // 가장 가까운 문장 끝 경계 찾기
            const boundaryPosition = Math.max(
                sentenceEnd > start ? sentenceEnd + 1 : start,
                questionEnd > start ? questionEnd + 1 : start,
                exclamationEnd > start ? exclamationEnd + 1 : start
            );
            
            end = boundaryPosition > start ? boundaryPosition : end;
        }
        
        chunks.push(transcript.substring(start, end).trim());
        start = end;
    }
    
    return chunks;
}

// 긴 트랜스크립트를 처리하는 함수
async function processLongTranscript(transcript: string, basePrompt: string): Promise<string> {
    // 트랜스크립트를 여러 청크로 분할
    console.log(`[Popup] 긴 트랜스크립트 처리 시작`);
    const chunks = splitTranscriptIntoChunks(transcript, MAX_CHARS_PER_CHUNK);
    console.log(`[Popup] 트랜스크립트가 ${chunks.length}개 청크로 분할되었습니다`);

    // 각 청크에 대한 요약 생성
    const chunkSummaries: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
        console.log(`[Popup] 청크 ${i + 1}/${chunks.length} 처리 중...`);
        const chunkPrompt = `${basePrompt} 이것은 ${chunks.length}개 부분 중 ${i + 1}번째 부분입니다.\n\n${chunks[i]}`;
        
        try {
            // engine이 null이 아닌지 확인
            if (!engine) {
                console.error('[Popup] 엔진이 초기화되지 않았습니다.');
                continue;
            }
            
            // engine.chat.completions.create 사용
            const completion = await engine.chat.completions.create({
                messages: [{
                    role: "user",
                    content: chunkPrompt,
                }],
                temperature: 0.7,
                max_tokens: 500,
            });
            
            const summary = completion.choices[0].message.content || "";
            chunkSummaries.push(summary);
        } catch (error) {
            console.error(`[Popup] 청크 ${i + 1} 처리 중 오류:`, error);
        }
    }

    // 전체 요약이 필요한 경우
    if (chunks.length > 1 && chunkSummaries.length > 0) {
        console.log(`[Popup] 최종 요약 생성 중...`);
        const combinedSummary = chunkSummaries.join("\n\n");
        const finalPrompt = `다음은 비디오 트랜스크립트의 여러 부분에 대한 요약입니다. 이 요약들을 하나의 일관된 요약으로 통합해주세요:\n\n${combinedSummary}`;
        
        try {
            // engine이 null이 아닌지 확인
            if (!engine) {
                console.error('[Popup] 엔진이 초기화되지 않았습니다.');
                return chunkSummaries.join("\n\n");
            }
            
            // engine.chat.completions.create 사용
            const completion = await engine.chat.completions.create({
                messages: [{
                    role: "user",
                    content: finalPrompt,
                }],
                temperature: 0.7,
                max_tokens: 500,
            });
            
            return completion.choices[0].message.content || combinedSummary;
        } catch (error) {
            console.error('[Popup] 최종 요약 생성 중 오류:', error);
            return chunkSummaries.join("\n\n");
        }
    }

    return chunkSummaries.join("\n\n");
}

// SupportedLanguage 타입 정의
type SupportedLanguage = 'ko' | 'en' | 'ja' | 'zh';

// 엔진 상태 인터페이스
interface EngineStatus {
    state: 'initializing' | 'loading' | 'ready' | 'error' | 'retrying';
    progress?: number;
    error?: string | null;
    retryCount?: number;
    maxRetries?: number;
    description?: string;
}

// contentScriptPort 선언
let contentScriptPort: chrome.runtime.Port | null = null;

// checkTranscriptAvailable 함수 추가
async function checkTranscriptAvailable(): Promise<boolean> {
  if (!contentScriptPort) return false;

  return new Promise((resolve) => {
    const messageId = Date.now().toString();
    const listener = (response: any) => {
      if (response.id === messageId) {
        contentScriptPort?.onMessage.removeListener(listener);
        resolve(response.hasTranscript || false);
      }
    };

    contentScriptPort.onMessage.addListener(listener);
    contentScriptPort.postMessage({
      action: 'checkTranscript',
      id: messageId
    });

    // 3초 후 타임아웃
    setTimeout(() => {
      contentScriptPort?.onMessage.removeListener(listener);
      resolve(false);
    }, 3000);
  });
}

// 초기 엔진 상태 확인 함수 수정
async function checkInitialEngineStatus(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ action: "getEngineStatus" });
    console.log("[Popup] Initial engine status:", response);
    
    isLoading = response.status !== 'ready';
    currentError = response.error || null;
    
    const status: EngineStatus = {
      state: response.status,
      progress: response.progress || 0,
      error: response.error || null
    };
    
    if (response.status === 'retrying') {
      status.retryCount = response.retryCount || 0;
      status.maxRetries = response.maxRetries || 3;
    }
    
    await updateStatusUI(status);
  } catch (error) {
    console.error("[Popup] Error getting initial engine status:", error);
    
    const status: EngineStatus = {
      state: 'error',
      error: error instanceof Error ? error.message : String(error)
    };
    
    await updateStatusUI(status);
  }
}

// 메시지 리스너 내의 updateStatusUI 호출 부분 수정
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "updateEngineStatus") {
    console.log("[Popup] Received engine status update:", message);
    
    isLoading = message.status !== 'ready';
    currentError = message.error || null;
    
    const status: EngineStatus = {
      state: message.status,
      progress: message.progress || 0,
      error: message.error || null
    };
    
    if (message.status === 'retrying') {
      status.retryCount = message.retryCount || 0;
      status.maxRetries = message.maxRetries || 3;
    }
    
    updateStatusUI(status);
  }
  // ... existing code ...
});

// updateEngineStatus 함수 수정
function updateEngineStatus(request: any): void {
    const { status } = request;

    console.log(`[Popup] Received engine status update:`, status);

    if (status) {
        // 상태값 캐스팅 및 처리
        const state = status.state as EngineStatus['state'];
        const progress = status.progress || 0;
        const error = status.error || null;
        const retryCount = status.retryCount;
        const maxRetries = status.maxRetries;
        const description = status.description;

        const engineStatus: EngineStatus = {
            state,
            progress,
            error,
            retryCount,
            maxRetries,
            description
        };

        isLoading = state === 'initializing' || state === 'retrying' || state === 'loading';
        currentError = error;
        
        updateStatusUI(engineStatus);
    }
}

// 히스토리 섹션 토글 함수
function toggleHistoryView(): void {
    const mainContent = document.getElementById('main-content');
    const historyContent = document.getElementById('history-content');
    const historyButton = document.getElementById('history-button');
    
    if (!mainContent || !historyContent || !historyButton) return;
    
    if (historyContent.style.display === 'none' || historyContent.style.display === '') {
        // 히스토리 보기로 전환
        mainContent.style.display = 'none';
        historyContent.style.display = 'block';
        historyButton.textContent = '돌아가기';
        
        // 히스토리 UI 렌더링
        renderHistoryItems();
    } else {
        // 메인 화면으로 돌아가기
        mainContent.style.display = 'flex';
        historyContent.style.display = 'none';
        historyButton.textContent = '히스토리';
    }
}

// 현재 요약 저장 함수
async function saveSummary(skipUIUpdate: boolean = false): Promise<void> {
    try {
        const summaryContent = document.getElementById('summary-content');
        if (!summaryContent || !summaryContent.textContent || summaryContent.textContent.trim() === '') {
            console.log("[Popup] 저장할 요약 내용이 없습니다.");
            return;
        }
        
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeTab = tabs[0];
        if (!activeTab?.url?.includes("youtube.com/watch")) {
            console.log("[Popup] YouTube 영상 페이지가 아닙니다.");
            return;
        }
        
        const url = new URL(activeTab.url);
        const videoId = url.searchParams.get('v');
        if (!videoId) {
            console.log("[Popup] 비디오 ID를 찾을 수 없습니다.");
            return;
        }
        
        // 새로운 히스토리 항목 생성
        const newHistory: SummaryHistory = {
            videoId,
            title: activeTab.title?.replace(' - YouTube', '') || '제목 없음',
            summary: summaryContent.textContent.trim(),
            timestamp: Date.now(),
            thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
        };
        
        // 같은 비디오에 대한 기존 항목 제거
        summaryHistories = summaryHistories.filter(item => item.videoId !== videoId);
        
        // 새 항목 추가
        summaryHistories.unshift(newHistory);
        
        // 최대 개수 제한
        if (summaryHistories.length > MAX_HISTORY_COUNT) {
            summaryHistories = summaryHistories.slice(0, MAX_HISTORY_COUNT);
        }
        
        // 저장
        await chrome.storage.local.set({ summaryHistories });
        
        // 저장 완료 메시지 표시 (UI 업데이트 스킵 옵션)
        if (!skipUIUpdate) {
            const copyButton = document.getElementById('copy-button');
            if (copyButton) {
                const originalClassName = copyButton.className;
                copyButton.classList.add('copied');
                
                setTimeout(() => {
                    copyButton.className = originalClassName;
                }, 2000);
            }
        }
        
        console.log("[Popup] 요약이 자동 저장되었습니다.");
    } catch (error) {
        console.error("[Popup] 요약 저장 중 오류:", error);
    }
}

// 저장된 히스토리 불러오기
async function loadSummaryHistories(): Promise<void> {
    try {
        const result = await chrome.storage.local.get('summaryHistories');
        if (result.summaryHistories) {
            summaryHistories = result.summaryHistories;
            console.log(`[Popup] ${summaryHistories.length}개의 저장된 요약 히스토리를 불러왔습니다.`);
        } else {
            console.log("[Popup] 저장된 요약 히스토리가 없습니다.");
        }
    } catch (error) {
        console.error("[Popup] 히스토리 로드 중 오류:", error);
    }
}

// 히스토리 항목 렌더링
function renderHistoryItems(): void {
    const historyContainer = document.getElementById('history-items');
    if (!historyContainer) return;
    
    historyContainer.innerHTML = '';
    
    if (summaryHistories.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'empty-history';
        emptyMessage.textContent = '저장된 요약이 없습니다.';
        historyContainer.appendChild(emptyMessage);
        return;
    }
    
    summaryHistories.forEach((history, index) => {
        const historyItem = document.createElement('div');
        historyItem.className = 'history-item';
        
        const date = new Date(history.timestamp);
        const formattedDate = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
        
        historyItem.innerHTML = `
            <div class="history-header">
                <div class="history-thumbnail">
                    <img src="${history.thumbnailUrl || ''}" alt="${history.title}" />
                </div>
                <div class="history-info">
                    <h3 class="history-title">${history.title}</h3>
                    <span class="history-date">${formattedDate}</span>
                </div>
            </div>
            <div class="history-summary">${history.summary}</div>
            <div class="history-actions">
                <button class="delete-history" data-index="${index}">삭제</button>
                <a href="https://www.youtube.com/watch?v=${history.videoId}" target="_blank" class="view-video">영상 보기</a>
            </div>
        `;
        
        historyContainer.appendChild(historyItem);
    });
    
    // 삭제 버튼에 이벤트 리스너 추가
    document.querySelectorAll('.delete-history').forEach(button => {
        button.addEventListener('click', (e) => {
            const index = parseInt((e.target as HTMLElement).dataset.index || '0');
            deleteHistoryItem(index);
        });
    });
}

// 히스토리 항목 삭제
async function deleteHistoryItem(index: number): Promise<void> {
    if (index < 0 || index >= summaryHistories.length) return;
    
    // 항목 삭제
    summaryHistories.splice(index, 1);
    
    // 저장
    await chrome.storage.local.set({ summaryHistories });
    
    // UI 업데이트
    renderHistoryItems();
    
    console.log(`[Popup] 히스토리 항목 ${index}가 삭제되었습니다.`);
}

// 요약 내용 복사 함수 추가
async function copySummaryToClipboard(): Promise<void> {
    const summaryContent = document.getElementById('summary-content');
    if (!summaryContent || !summaryContent.textContent || summaryContent.textContent.trim() === '') {
        console.log("[Popup] 복사할 요약 내용이 없습니다.");
        return;
    }
    
    try {
        await navigator.clipboard.writeText(summaryContent.textContent);
        console.log("[Popup] 요약 내용이 클립보드에 복사되었습니다.");
        
        // 복사 성공 표시
        const copyButton = document.getElementById('copy-button');
        if (copyButton) {
            const originalClassName = copyButton.className;
            copyButton.classList.add('copied');
            
            setTimeout(() => {
                copyButton.className = originalClassName;
            }, 2000);
        }
    } catch (error) {
        console.error("[Popup] 클립보드 복사 중 오류:", error);
    }
}

/**
 * 자동 요약 설정 초기화 및 이벤트 처리
 */
function initAutoSummarizeToggle() {
    const autoSummarizeToggle = document.getElementById('autoSummarizeToggle') as HTMLInputElement;
    if (!autoSummarizeToggle) return;

    // 저장된 설정 가져오기 (두 키 모두 확인)
    chrome.storage.local.get(['autoSummarize', 'autoSummaryEnabled'], (result) => {
        // 두 설정 중 하나라도 true면 활성화
        const isEnabled = result.autoSummarize === true || result.autoSummaryEnabled === true;
        autoSummarize = isEnabled; // 로컬 변수 업데이트
        autoSummarizeToggle.checked = isEnabled;
        console.log(`[Popup] Loaded auto-summarize setting: ${isEnabled}`);
    });

    // 토글 변경 이벤트 처리
    autoSummarizeToggle.addEventListener('change', handleAutoSummaryToggle);
}

/**
 * 스토리지 변경을 감지하는 리스너 설정 - 디버깅 로그 추가
 */
function setupStorageListener() {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
            // 자동 요약 설정 변경 감지
            if (changes.autoSummarize) {
                console.log(`[Popup] Storage 변경 감지: autoSummarize ${changes.autoSummarize.oldValue} -> ${changes.autoSummarize.newValue}`);
                
                const autoSummarizeToggle = document.getElementById('autoSummarizeToggle') as HTMLInputElement;
                const newValue = changes.autoSummarize.newValue === true;
                
                // 로컬 변수와 UI 모두 업데이트
                autoSummarize = newValue;
                
                if (autoSummarizeToggle) {
                    autoSummarizeToggle.checked = newValue;
                    console.log(`[Popup] 토글 상태 업데이트: ${newValue ? '활성화됨' : '비활성화됨'}`);
                }
                
                console.log(`[Popup] 자동 요약 설정이 스토리지에서 업데이트됨: ${newValue ? '활성화됨' : '비활성화됨'}`);
            }
            
            // 언어 설정 변경 감지
            if (changes.selectedLanguage) {
                const langValue = changes.selectedLanguage.newValue;
                currentLanguage = langValue;
                const langSelector = document.getElementById('languageSelector') as HTMLSelectElement;
                if (langSelector) {
                    langSelector.value = langValue;
                }
                // 언어 변경에 따른 UI 업데이트 (이 함수가 없는 경우 주석 처리)
                // updateUILanguage(langValue);
            }
        }
    });
}

// --- Auto Summary Toggle Handling --- 개선
async function handleAutoSummaryToggle(event: Event): Promise<void> {
    const toggleElement = event.target as HTMLInputElement;
    const newValue = toggleElement.checked;
    
    console.log(`[Popup] 토글 이벤트 발생 - 이전: ${autoSummarize ? '활성화됨' : '비활성화됨'}, 새값: ${newValue ? '활성화됨' : '비활성화됨'}`);
    
    // 로컬 상태 업데이트
    autoSummarize = newValue;
    console.log(`[Popup] 자동 요약 기능 ${autoSummarize ? '활성화됨' : '비활성화됨'}`);
    
    // 설정 저장 - 하나의 키만 사용
    try {
        await chrome.storage.local.set({ 
            autoSummarize: newValue,
            autoSummaryEnabled: newValue // 하위 호환성 유지
        });
        console.log(`[Popup] 스토리지에 설정 저장 완료: ${newValue ? '활성화됨' : '비활성화됨'}`);
    } catch (error) {
        console.error(`[Popup] 설정 저장 오류:`, error);
    }
    
    // 백그라운드 스크립트에 설정 변경 직접 알림
    try {
        // 활성화된 YouTube 탭 찾기
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeTab = tabs[0];
        console.log(`[Popup] 현재 활성 탭:`, activeTab?.id, activeTab?.url);
        
        console.log(`[Popup] 백그라운드에 설정 변경 알림 전송 시작`);
        
        // 백그라운드에 설정 변경 알림 전송
        chrome.runtime.sendMessage({
            action: 'setAutoSummarize',
            enabled: newValue,
            tabId: activeTab?.id,
            language: currentLanguage
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error(`[Popup] 백그라운드 메시지 전송 오류:`, chrome.runtime.lastError);
            } else {
                console.log(`[Popup] 백그라운드 응답:`, response);
            }
        });
        
        console.log(`[Popup] 백그라운드에 설정 변경 알림 전송 완료`);
        
        // 토글이 켜져 있고 엔진이 준비되어 있다면 즉시 요약 처리
        if (newValue && engine && !isLoading && !currentError) {
            requestSummaryIfApplicable();
        } else if (!newValue) {
            // 자동 요약이 꺼진 경우, 요약 섹션 숨기기
            const summaryContainer = document.getElementById('summary-container');
            if (summaryContainer) {
                summaryContainer.style.display = 'none';
            }
        }
    } catch (error) {
        console.error("[Popup] 자동 요약 설정 변경 알림 오류:", error);
    }
}

// 백그라운드에서 엔진이 준비되면 자동으로 요약 처리할 수 있도록 수신 리스너 추가
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.action === 'engineReady') {
        console.log("[Popup] Received engine ready notification from background");
        
        // 엔진 준비 완료 상태로 UI 업데이트
        isLoading = false;
        updateStatusUI({
            state: 'ready',
            progress: 100
        });
        updateUIText();
        
        // 엔진 참조 생성 (필요한 경우)
        if (!engine) {
            console.log("[Popup] Creating engine reference after background notification");
            CreateExtensionServiceWorkerMLCEngine(TARGET_MODEL_ID)
                .then(engineInstance => {
                    engine = engineInstance;
                    console.log("[Popup] Engine reference created");
                    
                    // 자동 요약이 활성화되어 있으면 요약 처리
                    if (autoSummarize) {
                        requestSummaryIfApplicable();
                    }
                })
                .catch(error => {
                    console.error("[Popup] Failed to create engine reference:", error);
                });
        } else if (autoSummarize) {
            // 엔진 참조가 이미 있으면 바로 요약 처리
            requestSummaryIfApplicable();
        }
        
        return true;
    }
    
    // 트랜스크립트가 준비되었을 때 자동 요약 처리
    if (message && message.action === 'transcriptReady' && message.transcript) {
        console.log("[Popup] 콘텐츠 스크립트로부터 트랜스크립트 준비 알림 수신");
        
        // 자동 요약이 활성화되었고 엔진이 준비되었을 때만 처리
        if (autoSummarize && engine && !isLoading && !currentError) {
            console.log("[Popup] 자동 요약 활성화됨, 트랜스크립트 처리 중...");
            processTranscriptAndSummarize(message.transcript, message.videoId);
        } else {
            console.log("[Popup] 자동 요약 비활성화되었거나 엔진이 준비되지 않았습니다. 트랜스크립트 처리 건너뜀");
        }
        
        return true;
    }
    
    return undefined;
});

// 트랜스크립트 처리 및 요약 생성 함수
async function processTranscriptAndSummarize(transcript: string, videoId?: string): Promise<void> {
    if (!transcript) {
        console.error("[Popup] No transcript provided");
        return;
    }
    
    try {
        console.log(`[Popup] Processing transcript (${transcript.length} chars) for summary`);
        
        // 요약 로딩 상태 표시
        displaySummary('loading');
        
        // 엔진이 초기화되었는지 확인
        if (!engine) {
            throw new Error("엔진이 초기화되지 않았습니다");
        }
        
        // 현재 언어에 맞는 프롬프트 생성
        const basePrompt = getPromptForLanguage(currentLanguage);
        
        // 트랜스크립트 길이 확인 및 처리
        let summaryContent = '';
        if (transcript.length > MAX_CHARS_LIMIT) {
            // 트랜스크립트가 너무 길 경우 청크로 분할하여 처리
            console.log(`[Popup] 트랜스크립트가 너무 깁니다 (${transcript.length} 글자). 청크로 분할하여 처리합니다.`);
            summaryContent = await processLongTranscript(transcript, basePrompt);
        } else {
            // 일반적인 처리
            const prompt = `${basePrompt}\n\n${transcript}`;
            
            // engine.chat.completions.create 사용
            console.log(`[Popup] 요약 생성 API 호출 중...`);
            const completion = await engine.chat.completions.create({
                messages: [{
                    role: "user",
                    content: prompt,
                }],
                temperature: 0.7,
                max_tokens: 500,
            });
            
            summaryContent = completion.choices[0].message.content || "";
        }
        
        console.log("[Popup] Summary generated:", summaryContent);
        
        // 요약 내용 표시
        displaySummary('success', summaryContent);
        
    } catch (error) {
        console.error("[Popup] Error processing transcript:", error);
        displaySummary('error', String(error));
    }
}
