/// <reference lib="webworker"/>
import { 
    CreateExtensionServiceWorkerMLCEngine, 
    ExtensionServiceWorkerMLCEngineHandler, 
    MLCEngineInterface, // Keep necessary types
    ChatCompletionMessageParam,
    ChatOptions
} from "@mlc-ai/web-llm";
import { TARGET_MODEL_ID, SupportedLanguage } from './config'; // Import from config

interface TranscriptItem {
    timestamp: string;
    text: string;
}

interface BackgroundMessage {
    action: string;
    [key: string]: any; // Allow other properties
}

// --- Constants ---
let activeEngine: MLCEngineInterface | null = null;
let isEngineInitializing: boolean = false; // 엔진 초기화 진행 중 상태 추적
let engineInitError: string | null = null; // 초기화 오류 저장
let handler: ExtensionServiceWorkerMLCEngineHandler | undefined;

chrome.runtime.onConnect.addListener((port) => {
    console.log("[SW] Connection received, port name:", port.name);
    if (port.name === "web_llm_service_worker") { 
        console.log("[SW] Port name matches example, setting up handler...");
        if (handler === undefined) {
            handler = new ExtensionServiceWorkerMLCEngineHandler(port);
        } else {
            handler.setPort(port);
        }
        port.onMessage.addListener(handler.onmessage.bind(handler));
    } else {
        console.log("[SW] Port name does not match 'web_llm_service_worker', ignoring for handler setup.");
        // Handle other connections if necessary, or just ignore.
    }
});

// --- 엔진 자동 초기화 함수 ---
async function initializeEngine(): Promise<void> {
    // 이미 초기화 중이거나 엔진이 이미 활성화된 경우 중복 초기화 방지
    if (isEngineInitializing || activeEngine) {
        console.log("[SW] Engine already initializing or active, skipping initialization");
        return;
    }

    isEngineInitializing = true;
    engineInitError = null;

    try {
        console.log(`[SW] Starting automatic engine initialization with model: ${TARGET_MODEL_ID}`);
        
        // 안전한 엔진 초기화를 위해 타임아웃 추가 (60초에서 120초로 증가)
        const initPromise = CreateExtensionServiceWorkerMLCEngine(TARGET_MODEL_ID, {
            initProgressCallback: (report) => {
                const progress = Math.floor(report.progress * 100);
                console.log(`[SW] Engine Init Progress: ${report.text} ${progress}%`);
                
                // 더 많은 정보 로깅을 위한 상세 진행 상황 추출
                if (report.text && report.text.includes('Fetching param cache')) {
                    const match = report.text.match(/Fetching param cache\[(\d+\/\d+)\]: (\d+(?:\.\d+)?MB) fetched\. (\d+)% completed, (\d+) secs elapsed/);
                    if (match) {
                        console.log(`[SW] Cache progress: [${match[1]}]: ${match[2]} fetched. ${match[3]}% completed in ${match[4]} seconds`);
                    }
                }
                
                // 초기화가 완료되었고, 'Finish loading'이 포함되었을 때
                if (report.progress >= 0.99 && report.text && report.text.includes('Finish loading')) {
                    console.log("[SW] Engine init nearly complete, detected 'Finish loading' message");
                }
            }
        });
        
        // 엔진 초기화 타임아웃 - 120초로 증가
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
                reject(new Error("Engine initialization timed out after 120 seconds"));
            }, 120000); // 120초로 늘림
        });
        
        // 타임아웃과 초기화 중 먼저 완료되는 것 실행
        const engine = await Promise.race([initPromise, timeoutPromise]);

        // 엔진 기능 테스트
        try {
            await engine.chat?.completions?.create({
                messages: [{ role: "user", content: "test" }],
                max_tokens: 1,
                temperature: 0
            });
            
            // 테스트 성공 시 엔진 저장
            activeEngine = engine;
            console.log("[SW] Engine successfully initialized and tested");
            
            // 엔진 준비 완료 알림 전송 및 보류 중인 YouTube 탭 처리
            await notifyPopupsEngineReady();
        } catch (testError) {
            console.error("[SW] Engine function test failed:", testError);
            throw new Error("Engine initialization appeared to succeed but function test failed");
        }
    } catch (error) {
        const typedError = error instanceof Error ? error : new Error(String(error));
        console.error("[SW] Engine initialization failed:", typedError);
        engineInitError = typedError.message;
        activeEngine = null;
        
        // 타임아웃 오류 발생시 자동으로 재시도 트리거
        if (typedError.message.includes('timeout') && initRetryCount < MAX_INIT_RETRIES) {
            console.log("[SW] Timeout detected, automatically triggering retry");
            retryInitialization();
        }
    } finally {
        isEngineInitializing = false;
    }
}

// URL 변경에 대한 디바운싱 상수 
const URL_DEBOUNCE_TIME = 1500; // 1.5초

// 전역 설정 변수
let currentLanguage: SupportedLanguage = 'ko';
let autoSummarize = true; // 기본값 true로 변경

// 설정 로드 함수
async function loadSettings(): Promise<void> {
    chrome.storage.local.get(['selectedLanguage', 'autoSummarize', 'autoSummaryEnabled'], (result) => {
        if (result.selectedLanguage) {
            currentLanguage = result.selectedLanguage as SupportedLanguage;
            console.log(`[SW] Loaded language setting: ${currentLanguage}`);
        }
        
        // 두 개의 키 중 하나라도 true이면 자동 요약 활성화
        const isSummaryEnabled = result.autoSummaryEnabled === true || result.autoSummarize === true;
        autoSummarize = isSummaryEnabled;
        
        if (isSummaryEnabled) {
            console.log(`[SW] Loaded auto-summarize setting: ${autoSummarize}`);
            
            // 항상 두 키를 동기화하여 저장
            chrome.storage.local.set({ 
                autoSummarize: true, 
                autoSummaryEnabled: true 
            });
        } else {
            console.log(`[SW] Auto-summarize setting initialized to ${autoSummarize}`);
            
            // 비활성화된 경우 강제로 활성화
            autoSummarize = true;
            chrome.storage.local.set({ 
                autoSummarize: true, 
                autoSummaryEnabled: true 
            });
        }
    });
}

// 스토리지 변경 감지
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
        // 언어 설정 변경 감지
        if (changes.selectedLanguage) {
            currentLanguage = changes.selectedLanguage.newValue as SupportedLanguage;
            console.log(`[SW] Language setting updated: ${currentLanguage}`);
        }
        
        // 자동 요약 설정 변경 감지 - 두 개의 키 모두 확인
        if (changes.autoSummarize || changes.autoSummaryEnabled) {
            // 두 키 중 하나라도 true면 활성화
            const oldAutoSummarize = changes.autoSummarize?.oldValue;
            const newAutoSummarize = changes.autoSummarize?.newValue;
            const oldAutoSummaryEnabled = changes.autoSummaryEnabled?.oldValue;
            const newAutoSummaryEnabled = changes.autoSummaryEnabled?.newValue;
            
            // 변경사항 로깅
            console.log(`[SW] Auto-summarize setting changed:`,
                       `autoSummarize: ${oldAutoSummarize} -> ${newAutoSummarize}`,
                       `autoSummaryEnabled: ${oldAutoSummaryEnabled} -> ${newAutoSummaryEnabled}`);
                       
            // 항상 true로 유지
            autoSummarize = true;
            
            // 키 동기화를 위해 두 키 모두 true로 설정
            chrome.storage.local.set({ 
                autoSummarize: true, 
                autoSummaryEnabled: true 
            });
            
            console.log(`[SW] Auto-summarize setting forced to enabled`);
        }
    }
});

// URL 업데이트 디바운싱을 위한 맵
// 탭 ID를 키로 하고, 타이머 ID와 타임스탬프를 값으로 가짐
interface PendingUpdate {
    timerId: any; // NodeJS.Timeout 타입이지만 호환성을 위해 any 사용
    url: string;
    timestamp: number;
}

const pendingUrlUpdates = new Map<number, PendingUpdate>();

// YouTube 네비게이션 처리 함수
function handleYouTubeNavigation(tabId: number, url: string): void {
    // YouTube 동영상 URL인지 확인
    if (!url || !url.includes('youtube.com/watch?')) {
        console.log(`[ServiceWorker] YouTube 동영상 URL이 아님: ${url}, 무시합니다`);
        return;
    }
    
    // 기존 대기 중인 타이머가 있는지 확인
    const existing = pendingUrlUpdates.get(tabId);
    if (existing) {
        // 이미 처리 중인 URL과 동일한지 확인
        if (existing.url === url) {
            console.log(`[ServiceWorker] 동일한 URL이 이미 탭 ${tabId}에서 처리 중, 건너뜁니다`);
            return;
        }
        
        // 이전 타이머 취소
        clearTimeout(existing.timerId);
        console.log(`[ServiceWorker] 탭 ${tabId}의 이전 타이머를 취소했습니다`);
    }
    
    // 새 타이머 설정
    const timerId = setTimeout(() => {
        console.log(`[ServiceWorker] 탭 ${tabId}의 URL 디바운스 타임아웃 트리거됨`);
        
        // 맵에서 항목 제거
        pendingUrlUpdates.delete(tabId);
        
        // 자동 요약 기능 항상 활성화
        autoSummarize = true;
        
        // 항상 요약 트리거
        console.log(`[ServiceWorker] 탭 ${tabId}에 대한 자동 요약을 트리거합니다`);
        triggerAutoSummarize(tabId, url);
        
    }, URL_DEBOUNCE_TIME);
    
    // 맵에 새 항목 추가
    pendingUrlUpdates.set(tabId, {
        timerId,
        url,
        timestamp: Date.now()
    });
    
    console.log(`[ServiceWorker] 탭 ${tabId}에 대한 URL 업데이트 등록됨, ${URL_DEBOUNCE_TIME}ms 후 처리 예정`);
}

// 자동 요약 트리거 함수
async function triggerAutoSummarize(tabId: number, url: string): Promise<void> {
    console.log(`[ServiceWorker] 자동 요약 트리거 시작 - 탭 ${tabId}, URL: ${url}`);
    
    // 자동 요약 기능이 항상 활성화된 상태로 유지
    autoSummarize = true;
    
    // YouTube URL이 아니면 무시
    if (!url.includes('youtube.com/watch?')) {
        console.log(`[ServiceWorker] YouTube 동영상 URL이 아니므로 요약 처리를 건너뜁니다.`);
        return;
    }
    
    // 현재 엔진 상태 확인
    const engineStatus = await getEngineStatus();
    
    if (!engineStatus.ready && !engineStatus.initializing) {
        console.log(`[ServiceWorker] 엔진이 준비되지 않았고 초기화 중이 아니므로, 초기화를 시작합니다.`);
        // 엔진이 준비되지 않았으면 초기화 시작
        try {
            await initEngine();
            console.log(`[ServiceWorker] 엔진 초기화가 성공적으로 시작되었습니다.`);
        } catch (error) {
            console.error(`[ServiceWorker] 엔진 초기화 실패:`, error);
            return;
        }
    }
    
    // 탭이 여전히 존재하는지 확인
    try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab || !tab.url || !tab.url.includes('youtube.com/watch?')) {
            console.log(`[ServiceWorker] 탭 ${tabId}이(가) 더 이상 존재하지 않거나 YouTube 동영상이 아닙니다.`);
            return;
        }
        
        // 현재 탭의 URL이 처리하려는 URL과 일치하는지 확인
        if (tab.url !== url) {
            console.log(`[ServiceWorker] 디바운스 시작 이후 탭 URL이 변경되었습니다. 중단합니다.`);
            console.log(`[ServiceWorker] 원본 URL: ${url}`);
            console.log(`[ServiceWorker] 현재 URL: ${tab.url}`);
            return;
        }
        
        // 탭에 트랜스크립트 요청 메시지 전송
        console.log(`[ServiceWorker] 탭 ${tabId}에서 트랜스크립트 요청 중...`);
        chrome.tabs.sendMessage(tabId, { action: 'getTranscript' }, async (response) => {
            if (chrome.runtime.lastError) {
                console.error(`[ServiceWorker] 탭 ${tabId}에 메시지 전송 오류:`, chrome.runtime.lastError);
                return;
            }
            
            if (!response || !response.transcript) {
                console.log(`[ServiceWorker] 탭 ${tabId}에서 트랜스크립트를 받지 못했습니다.`);
                return;
            }
            
            console.log(`[ServiceWorker] 탭 ${tabId}에서 트랜스크립트 수신, 길이: ${response.transcript.length}`);
            
            // 엔진이 준비되었는지 재확인
            const currentStatus = await getEngineStatus();
            if (!currentStatus.ready) {
                console.log(`[ServiceWorker] 엔진이 아직 준비되지 않았습니다. 나중에 처리하기 위해 트랜스크립트 저장 중...`);
                // 엔진이 준비되지 않았으면 트랜스크립트 저장 후 나중에 처리
                const title = response.title || '';
                const transcript = response.transcript || '';
                const url = tab.url || '';
                savePendingTranscript(tabId, transcript, url, title);
                return;
            }
            
            // 요약 처리
            const videoTitle = response.title || '';
            const videoTranscript = response.transcript || '';
            const videoUrl = tab.url || '';
            processTranscript(tabId, videoTranscript, videoUrl, videoTitle);
        });
    } catch (error) {
        console.error(`[ServiceWorker] 탭 ${tabId} 확인 중 오류 발생:`, error);
    }
}

// 대기 중인 트랜스크립트 저장
interface PendingTranscript {
    tabId: number;
    transcript: string;
    url: string;
    title: string;
    timestamp: number;
}

const pendingTranscripts: PendingTranscript[] = [];

function savePendingTranscript(tabId: number, transcript: string, url: string, title: string): void {
    // 이미 존재하는 항목 제거
    const existingIndex = pendingTranscripts.findIndex(pt => pt.tabId === tabId);
    if (existingIndex >= 0) {
        pendingTranscripts.splice(existingIndex, 1);
    }
    
    // 새 항목 추가
    pendingTranscripts.push({
        tabId,
        transcript,
        url,
        title,
        timestamp: Date.now()
    });
    
    console.log(`[SW] Saved pending transcript for tab ${tabId}, total pending: ${pendingTranscripts.length}`);
}

// 엔진 상태 확인 함수
async function getEngineStatus(): Promise<{ready: boolean, initializing: boolean}> {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'checkEngineStatus' }, (response) => {
            if (chrome.runtime.lastError || !response) {
                console.log(`[SW] Error checking engine status:`, chrome.runtime.lastError);
                resolve({ ready: false, initializing: false });
                return;
            }
            
            resolve({
                ready: response.ready === true,
                initializing: response.initializing === true
            });
        });
    });
}

// 엔진 초기화 함수
async function initEngine(): Promise<void> {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'initializeEngine' }, (response) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
                return;
            }
            
            if (!response || response.error) {
                reject(new Error(response?.error || 'Unknown error initializing engine'));
                return;
            }
            
            resolve();
        });
    });
}

// 엔진이 준비되면 대기 중인 트랜스크립트 처리
function processNextPendingTranscript(): void {
    if (pendingTranscripts.length === 0) {
        console.log(`[SW] No pending transcripts to process`);
        return;
    }
    
    console.log(`[SW] Processing ${pendingTranscripts.length} pending transcripts`);
    
    // 대기 중인 모든 트랜스크립트를 복사한 후 대기열 초기화
    const transcriptsToProcess = [...pendingTranscripts];
    pendingTranscripts.length = 0;
    
    // 대기 중인 각 트랜스크립트 처리
    for (const pendingItem of transcriptsToProcess) {
        // 탭이 여전히 존재하는지 확인
        chrome.tabs.get(pendingItem.tabId, (tab) => {
            if (chrome.runtime.lastError) {
                console.log(`[SW] Tab ${pendingItem.tabId} no longer exists, skipping`);
                return;
            }
            
            // 탭 URL이 변경되지 않았는지 확인
            if (tab.url !== pendingItem.url) {
                console.log(`[SW] Tab URL changed, skipping`);
                console.log(`[SW] Original: ${pendingItem.url}`);
                console.log(`[SW] Current: ${tab.url}`);
                return;
            }
            
            // 트랜스크립트 처리
            processTranscript(
                pendingItem.tabId,
                pendingItem.transcript,
                pendingItem.url,
                pendingItem.title
            );
        });
    }
}

// 엔진 상태 메시지 리스너
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'engineReady') {
        console.log(`[SW] Received engine ready notification`);
        // 엔진이 준비되면 대기 중인 트랜스크립트 처리
        processNextPendingTranscript();
    }
    
    // 다른 리스너에서 처리하도록 false 반환
    return false;
});

// 탭 업데이트 이벤트 리스너
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // URL이 변경된 경우에만 처리
    if (changeInfo.url) {
        console.log(`[SW] Tab ${tabId} URL changed: ${changeInfo.url}`);
        handleYouTubeNavigation(tabId, changeInfo.url);
    }
});

// --- 초기화 재시도 로직 수정 ---
let initRetryCount = 0;
const MAX_INIT_RETRIES = 3;
const RETRY_DELAY_MS = 5000; // 5초 후 재시도로 변경

// 초기화 재시도 함수
function retryInitialization(): void {
    if (initRetryCount < MAX_INIT_RETRIES) {
        initRetryCount++;
        console.log(`[SW] Scheduling retry ${initRetryCount}/${MAX_INIT_RETRIES} in ${RETRY_DELAY_MS/1000} seconds`);
        
        setTimeout(() => {
            console.log(`[SW] Executing retry ${initRetryCount}/${MAX_INIT_RETRIES}`);
            initializeEngine().catch(err => {
                console.error(`[SW] Retry ${initRetryCount} failed:`, err);
                // 재시도 실패 시 다시 재시도 예약
                retryInitialization();
            });
        }, RETRY_DELAY_MS);
    } else {
        console.error(`[SW] Exceeded maximum retry attempts (${MAX_INIT_RETRIES})`);
        // 최대 재시도 횟수 초과 시 오류 상태 업데이트
        engineInitError = `Engine initialization failed after ${MAX_INIT_RETRIES} retry attempts`;
        initRetryCount = 0; // 재시도 카운터 초기화
    }
}

// --- 지연된 백그라운드 초기화 ---
function scheduleBackgroundInitialization(): void {
    // 팝업 창 열림에 영향을 주지 않도록 5초 후에 초기화 시작
    console.log("[SW] Scheduling background initialization in 5 seconds");
    initRetryCount = 0; // 재시도 카운터 초기화
    
    setTimeout(() => {
        initializeEngine().catch(err => {
            console.error("[SW] Scheduled initialization failed:", err);
            // 오류 발생 시 재시도 로직 실행
            retryInitialization();
        });
    }, 5000);
}

// --- Service Worker Lifecycle (Keep for fast activation) ---
self.addEventListener('install', (event: Event) => { 
    console.log('[SW] Install event started.');
    (self as any).skipWaiting(); 
    console.log('[SW] skipWaiting() called.');
});

self.addEventListener('activate', (event: Event) => { 
    console.log('[SW] Activate event started.');
    
    // 서비스 워커 활성화 시 clients.claim()만 waitUntil에 포함
    (event as ExtendableEvent).waitUntil(
        (self as any).clients.claim().then(() => {
            console.log('[SW] clients.claim() successful.');
            
            // clients.claim이 완료된 후 지연된 초기화 예약
            scheduleBackgroundInitialization();
        }).catch((err: any) => {
            console.error('[SW] clients.claim() failed:', err);
            // 오류가 발생해도 초기화 시도
            scheduleBackgroundInitialization();
        })
    );
    
    console.log('[SW] Activate event finished registering waitUntil.');
});

// --- Message Listener (Re-added for Content Script communication) ---
chrome.runtime.onMessage.addListener((message: BackgroundMessage, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void): boolean | undefined => {
    const action = message.action;
    console.log(`[SW] onMessage: Received action: ${action} from sender:`, sender.tab?.id ? `tab ${sender.tab.id}` : "popup or other");

    // --- Handle Non-Async Actions First ---
    if (action === 'keepAlive') {
        console.log("[SW] Received keepAlive ping.");
        sendResponse({ success: true });
        return false;
    }
    
    // transcriptReady 메시지 처리 (콘텐츠 스크립트에서 전송)
    if (action === 'transcriptReady' && message.transcript) {
        console.log("[SW] Received transcriptReady message from content script");
        
        // 모든 팝업에 트랜스크립트 준비 완료 알림
        chrome.runtime.sendMessage({
            action: 'transcriptReady',
            transcript: message.transcript,
            videoId: message.videoId
        }).catch(err => {
            console.log("[SW] No active popups to notify about transcript ready status");
        });
        
        sendResponse({ success: true });
        return false;
    }

    // --- Handle Async Actions (Specifically processTranscript) --- 
    const handleAsyncAction = async (): Promise<any> => {
        let engine: MLCEngineInterface | null = null;
        try {
            switch (action) {
                case 'checkEngineStatus':
                    console.log("[SW] Checking engine status...");
                    
                    // forceInitialize 옵션 확인 - 팝업에서 무조건 초기화 요청 시
                    const forceInitialize = message.forceInitialize === true;
                    console.log(`[SW] Force initialize option: ${forceInitialize}`);
                    
                    // 오류 상태 명확하게 전달
                    if (engineInitError) {
                        console.warn("[SW] Returning engine error state:", engineInitError);
                        
                        // 재시도 중인지 확인
                        if (initRetryCount > 0) {
                            console.log(`[SW] Currently retrying initialization (${initRetryCount}/${MAX_INIT_RETRIES})`);
                            return { 
                                isReady: false, 
                                error: engineInitError,
                                isRetrying: true,
                                retryCount: initRetryCount,
                                maxRetries: MAX_INIT_RETRIES,
                                isInitializing: isEngineInitializing,
                                // 팝업이 강제로 열리지 않도록 안전 플래그 추가
                                isFatalError: false
                            };
                        }
                        
                        // 오류 상태이지만 재시도중이 아닌 경우 (재시도 소진 등)
                        const needsReinitialization = engineInitError.includes('timeout') || engineInitError.includes('failed');
                        
                        return { 
                            isReady: false, 
                            error: engineInitError,
                            isFatalError: false,
                            isInitializing: isEngineInitializing,
                            // 타임아웃 오류일 경우 팝업에서 재초기화 필요함을 알림
                            needsReinitialization: needsReinitialization
                        };
                    }
                    
                    // 엔진이 초기화 중인 경우
                    if (isEngineInitializing) {
                        console.log("[SW] Engine is currently initializing");
                        return { 
                            isReady: false, 
                            isInitializing: true,
                            // 팝업이 열릴 수 있도록 초기화 진행 중 상태 전달
                            initProgress: true,
                            // 재시도 중인지 정보 추가
                            isRetrying: initRetryCount > 0,
                            retryCount: initRetryCount,
                            maxRetries: MAX_INIT_RETRIES
                        };
                    }
                    
                    // 엔진이 활성화된 상태인 경우
                    if (activeEngine) {
                        try {
                            // 비동기 테스트의 타임아웃 추가
                            const testPromise = activeEngine.chat?.completions?.create({
                                messages: [{ role: "user", content: "test" }],
                                max_tokens: 1,
                                temperature: 0
                            });
                            
                            // 5초로 테스트 타임아웃 증가
                            const timeoutPromise = new Promise<never>((_, reject) => {
                                setTimeout(() => {
                                    reject(new Error("Engine test timed out"));
                                }, 5000); // 2초에서 5초로 증가
                            });
                            
                            // 테스트가 타임아웃 전에 완료되면 성공
                            await Promise.race([testPromise, timeoutPromise]);
                            
                            console.log("[SW] Engine is active and functional");
                            return { isReady: true };
                        } catch (err) {
                            console.log("[SW] Engine instance exists but failed functionality test:", err);
                            // Engine instance exists but is not functional
                            activeEngine = null;
                            
                            // 팝업 UI에 오류 메시지 대신 초기화 중 상태로 표시
                            if (!isEngineInitializing) {
                                // 실패한 경우 다시 초기화 시작
                                scheduleBackgroundInitialization();
                            }
                            return { 
                                isReady: false, 
                                isInitializing: true,
                                // 안전하게 재시도 중임을 알림
                                isRetrying: true,
                                retryCount: initRetryCount + 1,
                                maxRetries: MAX_INIT_RETRIES,
                                error: err instanceof Error ? err.message : String(err)
                            };
                        }
                    } else {
                        console.log("[SW] No active engine instance exists, starting initialization");
                        
                        // 엔진이 없는 경우 초기화 시작 - 무조건 또는 forceInitialize=true인 경우
                        if (!isEngineInitializing && (forceInitialize || true)) { // 현재는 항상 초기화
                            initRetryCount = 0; // 재시도 카운터 초기화
                            scheduleBackgroundInitialization();
                        }
                        
                        // 팝업이 열릴 수 있도록 상태 반환
                        return { 
                            isReady: false, 
                            isInitializing: true,
                            isFirstInit: !isEngineInitializing, // 첫 초기화 여부 표시
                            retryCount: initRetryCount,
                            maxRetries: MAX_INIT_RETRIES
                        };
                    }
                
                case 'summarizeVideo':
                    console.log("[SW] onMessage: Handling summarizeVideo request.");
                    if (!message.tabId) {
                        throw new Error("Missing 'tabId' in summarizeVideo message.");
                    }
                    if (!message.language) {
                        throw new Error("Missing 'language' in summarizeVideo message.");
                    }
                    const targetTabId = message.tabId;
                    const targetLanguage = message.language as SupportedLanguage;

                    // 1. Request transcript from content script
                    console.log(`[SW] Sending 'getTranscript' message to content script (tab: ${targetTabId}).`);
                    let transcriptText: string;
                    try {
                        const response = await chrome.tabs.sendMessage(targetTabId, { action: "getTranscript" });
                        if (response && response.transcript) {
                            transcriptText = response.transcript;
                            console.log(`[SW] Successfully received transcript from tab ${targetTabId}. Text length: ${transcriptText.length} chars`);
                        } else {
                            console.error(`[SW] Failed to get transcript from tab ${targetTabId}. Response:`, response);
                            throw new Error(response?.error || "No transcript received from content script.");
                        }
                    } catch (err: any) {
                        console.error(`[SW] Error during chrome.tabs.sendMessage to tab ${targetTabId}:`, err);
                        if (err.message?.includes("Could not establish connection")) {
                             throw new Error("Cannot connect to content script. Ensure the YouTube page is loaded and the extension is active.");
                        } else {
                            throw new Error(`Failed to get transcript: ${err.message || 'Unknown error'}`);
                        }
                    }

                    // 2. Get engine instance
                    console.log("[SW] Getting engine instance for summarizeVideo...");
                    if (activeEngine) {
                        engine = activeEngine;
                        console.log("[SW] Using existing engine instance");
                    } else {
                        engine = await CreateExtensionServiceWorkerMLCEngine(TARGET_MODEL_ID);
                        activeEngine = engine; // Store for future use
                        console.log("[SW] Created new engine instance");
                    }
                    
                    console.log("[SW] Engine instance obtained for summarizeVideo.");
                    if (!engine) {
                        throw new Error("Engine could not be initialized for summarization.");
                    }
                    
                    // 3. Generate structured summary
                    console.log(`[SW] Generating structured summary in ${targetLanguage}...`);
                    const structuredSummary = await generateSummaryInternal(engine, transcriptText, targetLanguage);
                    console.log('[SW] Structured summary generation complete.');
                    return { success: true, summary: structuredSummary };

                case 'autoSummarySettingChanged':
                    console.log(`[SW] Auto summary setting changed to: ${message.enabled}`);
                    autoSummarize = message.enabled === true;
                    
                    if (message.language) {
                        currentLanguage = message.language;
                    }
                    
                    // 설정이 변경되고, 자동 요약이 활성화된 경우, 현재 활성 탭이 유튜브 동영상이면 요약 시작
                    if (autoSummarize && message.tabId) {
                        // 탭 정보 확인
                        try {
                            const tab = await chrome.tabs.get(message.tabId);
                            if (tab.url?.includes('youtube.com/watch')) {
                                console.log(`[SW] Sending enableAutoSummary message to tab ${message.tabId}`);
                                
                                chrome.tabs.sendMessage(message.tabId, {
                                    action: "enableAutoSummary",
                                    enabled: true,
                                    language: currentLanguage
                                }).catch(error => {
                                    console.error(`[SW] Error enabling auto summary: ${error}`);
                                });
                            }
                        } catch (error) {
                            console.error(`[SW] Error checking tab info: ${error}`);
                        }
                    }
                    
                    return { success: true };

                case 'setAutoSummarize':
                    return handleSetAutoSummarize(message, sender, sendResponse);

                default:
                    console.warn(`[SW] onMessage: Unhandled async action: ${action}`);
                    return { success: false, error: `Unknown action for onMessage: ${action}` };
            }
        } catch (error: unknown) {
            const typedError = error instanceof Error ? error : new Error(String(error));
            console.error(`[SW] onMessage: Error handling action '${action}':`, typedError);
            return { success: false, error: typedError.message || 'Internal Service Worker Error in onMessage' };
        }
    };

    // Handle async actions based on type
    if (action === 'summarizeVideo' || action === 'autoSummarySettingChanged' || action === 'checkEngineStatus' || action === 'setAutoSummarize') { 
        handleAsyncAction().then(sendResponse);
        return true; // Indicate async response
    } else {
        // Check if it was keepAlive before warning
        if (action !== 'keepAlive') {
             console.warn(`[SW] Received unhandled action: ${action}`);
        }
        return false;
    }
});

// --- Helper Functions (Re-added) --- 

async function processTranscriptInternal(engine: MLCEngineInterface, transcript: TranscriptItem[] | string, videoId: string | undefined, language: SupportedLanguage): Promise<string> {
    console.warn("[SW] processTranscriptInternal called - consider using summarizeVideo flow from popup.");
    if (!engine) {
        throw new Error("Engine instance is missing for processing transcript.");
    }
    if (!transcript || (Array.isArray(transcript) && transcript.length === 0) || (typeof transcript === 'string' && transcript.trim() === '')) {
        throw new Error('No transcript data available');
    }
    
    let transcriptText: string;
    if (Array.isArray(transcript)) {
        transcriptText = transcript.map((item: TranscriptItem) => item.text).join(' ');
    } else {
        transcriptText = transcript;
    }

    console.log(`[SW] Generating summary for video ${videoId || 'Unknown'} (lang: ${language}) via processTranscriptInternal...`);
    try {
        const summary = await generateSummaryInternal(engine, transcriptText, language);
        console.log(`[SW] Summary generated for video ${videoId || 'Unknown'}.`);
        return summary;
    } catch (error: unknown) { 
         const typedError = error instanceof Error ? error : new Error(String(error)); 
         console.error(`[SW] Failed during summary generation for ${videoId || 'Unknown'}:`, typedError);
         throw new Error(`Summary generation failed: ${typedError.message}`); 
    }
}

async function generateSummaryInternal(engine: MLCEngineInterface, transcript: string, language: SupportedLanguage, maxLength: number = 500): Promise<string> {
    if (!engine.chat || typeof engine.chat.completions?.create !== 'function') {
        throw new Error("엔진 인스턴스가 로드되었지만 chat completions API가 없습니다.");
    }

    // 입력 트랜스크립트 유효성 검사
    if (!transcript || transcript.trim() === '') {
        console.error("[SW] 트랜스크립트가 비어 있습니다");
        const errorMessages: { [key in SupportedLanguage]: string } = {
            en: "No transcript data available",
            ko: "트랜스크립트 데이터가 없습니다",
            ja: "トランスクリプトデータがありません",
            zh: "没有文字记录数据"
        };
        throw new Error(errorMessages[language] || errorMessages['en']);
    }

    const maxInputLength = 10000; 
    let truncatedTranscript = transcript.length > maxInputLength
        ? transcript.substring(0, maxInputLength) + '...\n(트랜스크립트가 너무 길어서 잘렸습니다)'
        : transcript;
        
    // 트랜스크립트 미리보기 로깅 개선 (처음 300자만)
    const previewLength = 300;
    const transcriptPreview = transcript.substring(0, previewLength) + (transcript.length > previewLength ? '...' : '');
    console.log(`[SW] 트랜스크립트 미리보기 (처음 ${previewLength}자): "${transcriptPreview}"`);
    console.log(`[SW] 트랜스크립트 전체 길이: ${transcript.length}자`);
    
    // 언어별 프롬프트 정의
    const prompts: { [key in SupportedLanguage]: string } = {
        en: `Please provide a structured summary of the key points from the following transcript in English. Present the main ideas clearly and concisely. Transcript:\n\n${truncatedTranscript}\n\nStructured Summary:`,
        ko: `다음 스크립트의 핵심 내용을 한국어로 구조화하여 명확하게 정리해 주세요. 주요 아이디어를 간결하게 제시해야 합니다. 스크립트:\n\n${truncatedTranscript}\n\n정리된 내용:`,
        ja: `以下のトランスクリプトの要点を日本語で構造化し、明確にまとめてください。 主要なアイデアを簡潔に提示してください。 トランスクリプト:\n\n${truncatedTranscript}\n\n整理された内容:`,
        zh: `请用中文结构化地总结以下文字记录的要点，清晰地呈现主要观点。 文字记录：\n\n${truncatedTranscript}\n\n结构化摘要:`
    };
    const prompt = prompts[language] || prompts['en'];

    try {
        console.log(`[SW] 언어: ${language}로 요약 생성 중...`);
        
        const messages: ChatCompletionMessageParam[] = [{ role: "user", content: prompt }]; 
        const chatOpts: ChatOptions = {
            temperature: 0.7,
            top_p: 0.95,
        };

        // 요약 생성 시작 시간 기록
        const startTime = Date.now();
        console.log(`[SW] 채팅 완성 API 호출 중 (언어: ${language})...`);

        const reply = await engine.chat.completions.create({
            messages: messages,
            max_tokens: maxLength, 
            temperature: chatOpts.temperature,
            top_p: chatOpts.top_p,
        });

        // 요약 생성 완료 시간 및 소요 시간 계산
        const endTime = Date.now();
        const durationSecs = ((endTime - startTime) / 1000).toFixed(2);
        console.log(`[SW] 채팅 완성 응답 수신 완료 (소요 시간: ${durationSecs}초)`);
        
        const summaryText = reply.choices[0]?.message?.content?.trim() || ""; 
        
        if (!summaryText) {
            console.warn("[SW] 요약 생성 결과가 비어 있습니다");
            // 언어별 오류 메시지 제공
            const errorMessages: { [key in SupportedLanguage]: string } = {
                en: "(Could not generate summary)",
                ko: "(요약을 생성하지 못했습니다)",
                ja: "(要約を生成できませんでした)",
                zh: "(未能生成摘要)"
            };
            return errorMessages[language] || errorMessages['en'];
        }
        
        // 요약 결과 미리보기 로깅 (처음 300자만)
        const summaryPreviewLength = 300;
        const summaryPreview = summaryText.substring(0, summaryPreviewLength) + (summaryText.length > summaryPreviewLength ? '...' : '');
        console.log(`[SW] 요약 미리보기 (처음 ${summaryPreviewLength}자): "${summaryPreview}"`);
        console.log(`[SW] 요약 전체 길이: ${summaryText.length}자, 소요 시간: ${durationSecs}초`);
        
        return summaryText;
        
    } catch (error: unknown) { 
        const typedError = error instanceof Error ? error : new Error(String(error)); 
        console.error(`[SW] 채팅 완성 중 오류 발생 (generateSummaryInternal, 언어: ${language}):`, typedError);
        
        // 언어별 오류 메시지 제공
        const errorMessages: { [key in SupportedLanguage]: string } = {
            en: `AI Generation Failed: ${typedError.message || 'Unknown error'}`,
            ko: `AI 요약 생성 실패: ${typedError.message || '알 수 없는 오류'}`,
            ja: `AI生成に失敗しました: ${typedError.message || '不明なエラー'}`,
            zh: `AI 生成失败: ${typedError.message || '未知错误'}`
        };
        throw new Error(errorMessages[language] || errorMessages['en']);
    }
}

// 요약 결과 저장 함수 추가
async function saveSummaryToStorage(videoId: string, title: string, summary: string, thumbnailUrl?: string): Promise<void> {
    try {
        console.log(`[SW] 요약 저장 시작 (비디오 ID: ${videoId})`);
        
        // 기존 히스토리 불러오기
        const result = await chrome.storage.local.get('summaryHistories');
        let summaryHistories: any[] = result.summaryHistories || [];
        
        // 같은 비디오ID의 기존 항목 제거
        summaryHistories = summaryHistories.filter((item: any) => item.videoId !== videoId);
        
        // 새 항목 추가
        const newHistory = {
            videoId,
            title: title || '제목 없음',
            summary,
            timestamp: Date.now(),
            thumbnailUrl: thumbnailUrl || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
        };
        
        summaryHistories.unshift(newHistory);
        
        // 최대 개수 제한 (10개)
        const MAX_HISTORY_COUNT = 10;
        if (summaryHistories.length > MAX_HISTORY_COUNT) {
            summaryHistories = summaryHistories.slice(0, MAX_HISTORY_COUNT);
        }
        
        // 저장
        await chrome.storage.local.set({ summaryHistories });
        console.log(`[SW] 요약 저장 완료 (비디오 ID: ${videoId}), 현재 히스토리 개수: ${summaryHistories.length}`);
    } catch (error) {
        console.error(`[SW] 요약 저장 중 오류:`, error);
    }
}

// 트랜스크립트 처리 함수 수정
async function processTranscript(tabId: number, transcript: string, url: string, title: string): Promise<void> {
    try {
        console.log(`[ServiceWorker] 탭 ${tabId}의 트랜스크립트 처리 중 (URL: ${url})`);
        
        // 자동 요약 기능이 항상 활성화됨
        autoSummarize = true;
        
        // 활성 엔진 준비 상태 확인
        if (!activeEngine) {
            console.error(`[ServiceWorker] 탭 ${tabId}: 활성 엔진이 준비되지 않았습니다`);
            chrome.runtime.sendMessage({
                type: "summarize_error", 
                error: "엔진이 준비되지 않았습니다. 다시 시도해 주세요."
            }).catch(err => {
                console.log("[ServiceWorker] 오류를 알릴 활성 팝업이 없습니다");
            });
            return;
        }
        
        // 트랜스크립트 유효성 검사
        if (!transcript || transcript.trim() === '') {
            console.error(`[ServiceWorker] 탭 ${tabId}: 비어있는 트랜스크립트`);
            chrome.runtime.sendMessage({
                type: "summarize_error", 
                error: "트랜스크립트가 비어 있습니다. 비디오에 자막이 있는지 확인해 주세요."
            }).catch(err => {
                console.log("[ServiceWorker] 오류를 알릴 활성 팝업이 없습니다");
            });
            return;
        }
        
        // 비디오 ID 추출
        const videoId = extractVideoId(url);
        if (!videoId) {
            console.error(`[ServiceWorker] 탭 ${tabId}: 유효하지 않은 YouTube URL (${url})`);
            chrome.runtime.sendMessage({
                type: "summarize_error", 
                error: "유효한 YouTube 비디오 URL이 아닙니다."
            }).catch(err => {
                console.log("[ServiceWorker] 오류를 알릴 활성 팝업이 없습니다");
            });
            return;
        }
        
        console.log(`[ServiceWorker] 탭 ${tabId}: 비디오 ID ${videoId}, 제목 "${title || '제목 없음'}" 요약 생성 중...`);
        
        chrome.runtime.sendMessage({ 
            type: "summarize_start", 
            transcript: transcript,
            videoId: videoId,
            title: title || '제목 없음'
        }).catch(err => {
            // 팝업이 닫혔을 수 있으므로 오류 무시
            console.log("[ServiceWorker] 시작을 알릴 활성 팝업이 없습니다. 백그라운드에서 계속 진행합니다");
        });
        
        // 요약 생성 시작 시간 기록
        const startTime = Date.now();
        
        // 요약 생성
        const summary = await generateSummaryInternal(
            activeEngine, 
            transcript, 
            currentLanguage as SupportedLanguage,
            500 // 최대 토큰 수
        );
        
        // 소요 시간 계산
        const durationSecs = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[ServiceWorker] 탭 ${tabId}: 요약 생성 완료 (소요 시간: ${durationSecs}초)`);
        
        // 요약 결과에서 접두사 제거
        let cleanSummary = summary;
        const prefixesToRemove = [
            "다음 유튜브 영상 대본의 내용을 3-5개의 중요 포인트로 요약해줍니다.",
            "다음 유튜브 영상 대본의 내용을 3-5개의 중요 포인트로 요약해줘.",
            "다음 유튜브 영상 대본의 내용을 3~5개의 중요 포인트로 요약해줍니다.",
            "다음 유튜브 영상 대본의 내용을 요약하면:",
            "요약:",
        ];
        
        // 접두사 제거
        for (const prefix of prefixesToRemove) {
            if (cleanSummary.startsWith(prefix)) {
                cleanSummary = cleanSummary.substring(prefix.length).trim();
                break;
            }
        }
        
        // 요약 결과 저장
        await saveSummaryToStorage(videoId, title, cleanSummary);
        
        // 요약 결과 전송
        const summaryResult = {
            type: "summarize_result",
            summary: cleanSummary,
            videoId: videoId,
            title: title || "제목 없음",
            timestamp: Date.now()
        };
        
        // 팝업으로 요약 결과 전송 - 팝업이 닫혔을 가능성이 있으므로 오류 무시
        chrome.runtime.sendMessage(summaryResult).catch(err => {
            console.log("[ServiceWorker] 결과를 알릴 활성 팝업이 없습니다. 이미 스토리지에 저장되었습니다");
        });
        
        // 컨텐츠 스크립트로 요약 결과 전송
        chrome.tabs.sendMessage(tabId, summaryResult).catch(error => {
            console.warn(`[ServiceWorker] 탭 ${tabId}에 메시지 전송 실패:`, error);
        });
        
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[ServiceWorker] 탭 ${tabId} 트랜스크립트 처리 중 오류 발생:`, error);
        
        chrome.runtime.sendMessage({ 
            type: "summarize_error", 
            error: `요약 생성 실패: ${errorMessage}`
        }).catch(err => {
            console.log("[ServiceWorker] 오류를 알릴 활성 팝업이 없습니다");
        });
    }
}

/**
 * YouTube URL에서 비디오 ID를 추출합니다.
 * 다양한 YouTube URL 형식을 지원합니다.
 */
function extractVideoId(url: string): string | null {
    if (!url || typeof url !== 'string') {
        console.warn("[SW] extractVideoId: 유효하지 않은 URL 입력");
        return null;
    }
    
    try {
        const urlObj = new URL(url);
        
        // youtube.com/watch?v=VIDEO_ID 형식
        if (urlObj.hostname.includes('youtube.com') && urlObj.pathname === '/watch') {
            return urlObj.searchParams.get('v');
        }
        
        // youtu.be/VIDEO_ID 형식
        if (urlObj.hostname === 'youtu.be') {
            return urlObj.pathname.substring(1); // 첫 '/' 제거
        }
        
        // youtube.com/embed/VIDEO_ID 형식
        if (urlObj.hostname.includes('youtube.com') && urlObj.pathname.startsWith('/embed/')) {
            return urlObj.pathname.split('/')[2];
        }
        
        // youtube.com/v/VIDEO_ID 형식
        if (urlObj.hostname.includes('youtube.com') && urlObj.pathname.startsWith('/v/')) {
            return urlObj.pathname.split('/')[2];
        }
        
        console.warn(`[SW] extractVideoId: 지원되지 않는 YouTube URL 형식 (${url})`);
        return null;
        
    } catch (error) {
        console.error('[SW] extractVideoId: URL 파싱 오류:', error);
        return null;
    }
}

// 엔진 초기화 완료 후 자동으로 보류 중인 요약 처리
async function notifyPopupsEngineReady(): Promise<void> {
    console.log("[ServiceWorker] 엔진 준비 완료 상태를 모든 팝업에 알림");
    
    // 모든 extension 창에 메시지 전송
    chrome.runtime.sendMessage({
        action: 'engineReady'
    }).catch(err => {
        // 오류 무시 - 활성 팝업이 없는 경우일 수 있음
        console.log("[ServiceWorker] 엔진 준비 상태를 알릴 활성 팝업이 없습니다");
    });
    
    // 자동 요약 기능 항상 활성화
    autoSummarize = true;
    
    // 엔진이 초기화되었으므로 보류 중인 모든 YouTube 탭에서 자동 요약 시작
    console.log("[ServiceWorker] 엔진이 준비되었습니다. 현재 열려있는 YouTube 탭 확인 중...");
    try {
        const tabs = await chrome.tabs.query({url: "*://*.youtube.com/watch?*"});
        console.log(`[ServiceWorker] ${tabs.length}개의 YouTube 동영상 탭 발견`);
        
        for (const tab of tabs) {
            if (tab.id && tab.url) {
                console.log(`[ServiceWorker] YouTube 탭 ${tab.id} 처리 중: ${tab.url}`);
                handleYouTubeNavigation(tab.id, tab.url);
            }
        }
    } catch (error) {
        console.error("[ServiceWorker] YouTube 탭 검색 중 오류 발생:", error);
    }
}

// setAutoSummarize 메시지 핸들러
function handleSetAutoSummarize(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void): void {
    // 항상 활성화된 상태로 유지
    autoSummarize = true;
    
    // 설정 저장 - 두 키 모두 저장
    chrome.storage.local.set({ 
        autoSummarize: true,
        autoSummaryEnabled: true
    });
    
    // 언어도 함께 업데이트 (제공된 경우)
    if (message.language) {
        currentLanguage = message.language as SupportedLanguage;
    }
    
    console.log(`[SW] Auto-summarize maintained as enabled`);
    
    // tabId가 제공된 경우, 해당 탭에 대해 자동 요약 수행
    if (message.tabId) {
        chrome.tabs.get(message.tabId, (tab) => {
            if (chrome.runtime.lastError) {
                console.error(`[SW] Error getting tab ${message.tabId}:`, chrome.runtime.lastError);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
                return;
            }
            
            if (tab.url && tab.url.includes('youtube.com/watch?')) {
                console.log(`[SW] Triggering auto-summarize for tab ${message.tabId}`);
                triggerAutoSummarize(message.tabId, tab.url);
                sendResponse({ success: true, triggered: true });
            } else {
                console.log(`[SW] Tab ${message.tabId} is not a YouTube video, not triggering`);
                sendResponse({ success: true, triggered: false });
            }
        });
        return;
    }
    
    sendResponse({ success: true });
}

// 초기화 시 설정 로드
loadSettings(); 