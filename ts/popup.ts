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

// --- State Variables ---
let engine: MLCEngineInterface | null = null; // Engine instance
let isLoading: boolean = true; // Track initial loading state
let currentError: string | null = null;
let currentLanguage: string = 'ko'; // Default language
let autoSummaryEnabled: boolean = false; // Default auto summary setting

// Content script connection retry variables
let contentConnectionRetries = 0;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1500;

// --- Initialization ---
document.addEventListener('DOMContentLoaded', initPopup);

async function initPopup(): Promise<void> {
    console.log("[Popup] Initializing...");

    // Assign UI elements
    statusIndicator = document.getElementById('model-status-indicator');
    statusText = document.getElementById('model-status-text');
    statusDescription = document.getElementById('status-description');
    progressContainer = document.getElementById('progress-container');
    progressBarElement = document.getElementById('progress-bar');
    progressText = document.getElementById('progress-text');
    const languageSelect = document.getElementById('language-select') as HTMLSelectElement;
    const autoSummaryToggle = document.getElementById('auto-summary-toggle') as HTMLInputElement;

    // Load saved settings
    const savedSettings = await chrome.storage.local.get(['selectedLanguage', 'autoSummaryEnabled']);
    currentLanguage = savedSettings.selectedLanguage || 'ko';
    autoSummaryEnabled = savedSettings.autoSummaryEnabled || false;
    
    // Initialize UI with saved settings
    if (languageSelect) {
        languageSelect.value = currentLanguage;
        languageSelect.addEventListener('change', handleLanguageChange);
    }

    if (autoSummaryToggle) {
        autoSummaryToggle.checked = autoSummaryEnabled;
        autoSummaryToggle.addEventListener('change', handleAutoSummaryToggle);
    }
    
    // Update UI text based on loaded language *immediately*
    updateUIText(); 

    // Initialize progress bar UI
    ensureProgressBarExists();
    if (document.getElementById('loadingContainer')) {
        loadingBar = new Line('#loadingContainer', {
            strokeWidth: 4,
            easing: "easeInOut",
            duration: 1400,
            color: "#6e8efb", // Synthra blue
            trailColor: "#e0e0e0",
            trailWidth: 1,
            svgStyle: { width: "100%", height: "100%" },
        });
    }

    updateStatusUI('initializing', 0, null);

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

                updateStatusUI('loading', progress, null, conciseProgressText); 
                if (loadingBar) {
                    loadingBar.animate(report.progress); 
                }
            }
        });

        console.log("[Popup] Engine initialized successfully.");
        isLoading = false;
        updateStatusUI('ready', 100, null); // Set status to ready
        
        // Update UI again after engine status changes (might affect status descriptions)
        updateUIText();
        // Request summary if engine is ready and on a YouTube page
        requestSummaryIfApplicable();

    } catch (error: unknown) {
        const typedError = error instanceof Error ? error : new Error(String(error));
        console.error("[Popup] Engine initialization failed:", typedError);
        isLoading = false;
        currentError = `Engine initialization failed: ${typedError.message}`; // Use English error message internally?
        updateStatusUI('error', 0, currentError);
        // Update UI text AFTER setting error status
        updateUIText(); 
    }
}

function updateStatusUI(status: string, progress: number, errorMsg: string | null, progressTextOverride: string | null = null): void {
    if (!statusIndicator || !statusText || !statusDescription) {
        console.warn("[Popup] Status UI elements not found.");
        return;
    }
    
    const loadingContainer = document.getElementById('loadingContainer');
    statusIndicator.className = 'status-indicator'; 
    if (loadingContainer) loadingContainer.style.display = 'none';

    let baseTextKey = ''; // Use message keys for status text
    let descriptionKey = ''; // Use message keys for description
    let descriptionValue = ''; // Final description string

    switch (status) {
        case 'initializing':
        case 'loading':
            statusIndicator.classList.add('loading');
            baseTextKey = status === 'initializing' ? "statusInitializing" : "statusLoading";
            descriptionKey = status === 'initializing' ? "statusDescInitializing" : "statusDescLoading";
            descriptionValue = progressTextOverride || chrome.i18n.getMessage(descriptionKey) || descriptionKey;
            if (loadingContainer) loadingContainer.style.setProperty('display', 'block', 'important');
            break;
        case 'ready':
            statusIndicator.classList.add('ready');
            baseTextKey = "statusReady";
            descriptionKey = "statusDescReady";
            descriptionValue = chrome.i18n.getMessage(descriptionKey) || descriptionKey;
            if (loadingContainer) loadingContainer.style.setProperty('display', 'none', 'important');
            break;
        case 'error':
            statusIndicator.classList.add('error');
            baseTextKey = "statusError";
            descriptionKey = "statusDescError"; 
            const errorDetail = errorMsg || (chrome.i18n.getMessage("unknownError") || "Unknown error");
            descriptionValue = (chrome.i18n.getMessage(descriptionKey) || "Error: {error}").replace("{error}", errorDetail);
            if (loadingContainer) loadingContainer.style.setProperty('display', 'none', 'important');
            break;
        default: // idle
            statusIndicator.classList.add('idle');
            baseTextKey = "statusIdle";
            descriptionKey = "statusDescIdle";
            descriptionValue = chrome.i18n.getMessage(descriptionKey) || descriptionKey;
            if (loadingContainer) loadingContainer.style.setProperty('display', 'none', 'important');
            break;
    }

    // Set text content using keys first, then call updateUIText for translation
    statusText.textContent = chrome.i18n.getMessage(baseTextKey) || baseTextKey;
    statusDescription.textContent = descriptionValue;
}

// Helper to ensure progress bar elements are in the DOM
function ensureProgressBarExists(): void {
    // ONLY ensure the container for progressbar.js exists
    let loadingContainer = document.getElementById('loadingContainer');

    if (!loadingContainer) {
        loadingContainer = document.createElement('div');
        loadingContainer.id = 'loadingContainer';
        loadingContainer.style.height = '8px'; // Adjusted height
        loadingContainer.style.width = '100%';
        loadingContainer.style.marginTop = '5px';
        loadingContainer.style.marginBottom = '5px'; // Add some margin below
        loadingContainer.style.display = 'none'; // Hide by default
        // Insert it after the status description
        document.getElementById('status-description')?.after(loadingContainer);
    }
}

// --- Language Handling ---
async function handleLanguageChange(event: Event): Promise<void> {
    const selectElement = event.target as HTMLSelectElement;
    currentLanguage = selectElement.value;
    console.log(`[Popup] Language changed to: ${currentLanguage}`);
    await chrome.storage.local.set({ selectedLanguage: currentLanguage });
    
    // Update all UI text immediately after language change
    updateUIText(); 
    
    // Re-request summary in the new language IF a summary was successfully displayed
    const summaryContainer = document.getElementById('summary-container');
    const summaryContent = document.getElementById('summary-content');
    if (engine && !isLoading && !currentError && summaryContainer && summaryContent && summaryContainer.style.display === 'block') {
        // Check if content is not a status message
        const isShowingStatus = 
            summaryContent.textContent === (chrome.i18n.getMessage("summaryLoading") || "...") ||
            summaryContent.textContent?.startsWith(chrome.i18n.getMessage("summaryErrorPrefix") || "Error") ||
            summaryContent.textContent === (chrome.i18n.getMessage("summaryNotApplicable") || "...");
        
        if (!isShowingStatus && summaryContent.textContent) { // Only re-request if showing actual summary content
             console.log("[Popup] Re-requesting summary due to language change.");
             requestSummaryIfApplicable(); 
        }
    }
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
    let baseKey = '';
    let descriptionKey = '';

    if (statusIndicatorClass.includes('loading') || statusIndicatorClass.includes('initializing')) {
        baseKey = statusIndicatorClass.includes('initializing') ? "statusInitializing" : "statusLoading";
        descriptionKey = statusIndicatorClass.includes('initializing') ? "statusDescInitializing" : "statusDescLoading";
    } else if (statusIndicatorClass.includes('ready')) {
        baseKey = "statusReady";
        descriptionKey = "statusDescReady";
    } else if (statusIndicatorClass.includes('error')) {
        baseKey = "statusError";
        descriptionKey = "statusDescError"; 
    } else { baseKey = "statusIdle"; descriptionKey = "statusDescIdle"; }

    statusText.textContent = chrome.i18n.getMessage(baseKey) || baseKey;
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
    try {
        // Get active tab and check for YouTube URL
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeTab = tabs[0];
        if (!activeTab || !activeTab.url || !activeTab.url.includes("youtube.com/watch")) {
            // Not a YouTube video page
            displaySummary('not_applicable', '');
            return;
        }

        // Show loading state
        displaySummary('loading');
        
        // Reset retry counter when making a new request
        contentConnectionRetries = 0;
        document.getElementById('error-message')?.style.setProperty('display', 'none', 'important');
        document.getElementById('retrying-message')?.style.setProperty('display', 'none', 'important');
        
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
            // Hide loading animation and show content with typing animation
            if (summaryLoading) {
                summaryLoading.style.display = "none";
            }
            summaryContent.innerHTML = ''; // Clear first
            
            // Split content by paragraphs and create animated elements
            const paragraphs = content.split('\n').filter(p => p.trim() !== '');
            paragraphs.forEach((paragraph, index) => {
                const p = document.createElement('p');
                p.textContent = paragraph;
                p.classList.add('typing-animation');
                // Delay each paragraph animation
                p.style.animationDelay = `${index * 0.5}s`;
                summaryContent.appendChild(p);
            });
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
        displaySummary('error', 'Tab ID not found');
        return;
    }

    try {
        console.log(`[Popup] Requesting transcript from tab ${tabId}...`);
        
        // Try to send message to content script
        const response = await chrome.tabs.sendMessage(tabId, { action: "getTranscript" })
            .catch((error) => {
                console.error("[Popup] Error sending message to content script:", error);
                throw new Error("Cannot connect to content script");
            });
            
        if (!response) {
            throw new Error("Empty response from content script");
        }

        if (response.error) {
            console.error("[Popup] Content script returned error:", response.error);
            throw new Error(response.error);
        }

        if (!response.transcript) {
            throw new Error("No transcript data received");
        }

        console.log(`[Popup] Received transcript (${response.transcript.length} chars). Generating summary...`);
        
        // Process transcript with WebLLM engine
        if (!engine) {
            throw new Error("Engine not initialized");
        }

        // Get the prompt based on the current language
        let prompt = `다음 유튜브 영상 대본의 내용을 3-5개의 중요 포인트로 요약해줘. 반드시 한국어로 답변해주세요:\n\n${response.transcript}`;
        if (currentLanguage === 'en') {
            prompt = `Summarize the following YouTube video transcript into 3-5 key points. Please respond in English only:\n\n${response.transcript}`;
        } else if (currentLanguage === 'ja') {
            prompt = `次のYouTubeビデオのトランスクリプトを3〜5つの重要なポイントに要約してください。必ず日本語で答えてください:\n\n${response.transcript}`;
        } else if (currentLanguage === 'zh') {
            prompt = `请将以下YouTube视频的文字记录总结为3-5个关键要点。请务必用中文回答:\n\n${response.transcript}`;
        }

        const completion = await engine.chatCompletion({
            messages: [{
                role: "user",
                content: prompt,
            }],
            temperature: 0.7,
            max_tokens: 500,
        });

        console.log("[Popup] Summary generated:", completion.choices[0].message.content);
        
        // Display the summary
        const summaryContent = completion.choices[0].message.content || "";
        displaySummary('success', summaryContent);

    } catch (error) {
        console.error(`[Popup] Error in requestTranscriptAndSummarize:`, error);
        
        // Check if it's a content script connection error
        if (error instanceof Error && 
            (error.message.includes("Cannot connect to content script") || 
             error.message.includes("Could not establish connection"))) {
            
            // Show error message
            const errorMessageEl = document.getElementById('error-message');
            if (errorMessageEl) {
                errorMessageEl.style.setProperty('display', 'block', 'important');
            }
            
            // Try to retry connection
            if (contentConnectionRetries < MAX_RETRIES) {
                contentConnectionRetries++;
                console.log(`[Popup] Retrying content script connection (${contentConnectionRetries}/${MAX_RETRIES})...`);
                
                // Show retrying message
                const retryingMessageEl = document.getElementById('retrying-message');
                if (retryingMessageEl) {
                    retryingMessageEl.style.setProperty('display', 'flex', 'important');
                }
                
                // Wait and retry
                setTimeout(() => {
                    requestTranscriptAndSummarize(tabId);
                }, RETRY_DELAY);
                return;
            }
        }
        
        // Display error in the summary section
        displaySummary('error', String(error));
    }
}

// Additional messages for translation
const extraMessages = {
    'en': {
        'contentScriptError': 'Cannot connect to content script. Ensure the YouTube page is loaded and the extension is active.',
        'retrying': 'Retrying connection...'
    },
    'ko': {
        'contentScriptError': '컨텐츠 스크립트에 연결할 수 없습니다. YouTube 페이지가 로드되어 있고 확장 프로그램이 활성화되어 있는지 확인하세요.',
        'retrying': '다시 시도 중...'
    },
    'ja': {
        'contentScriptError': 'コンテンツスクリプトに接続できません。YouTubeページが読み込まれており、拡張機能が有効になっていることを確認してください。',
        'retrying': '再試行中...'
    },
    'zh': {
        'contentScriptError': '无法连接到内容脚本。请确保YouTube页面已加载且扩展程序处于活动状态。',
        'retrying': '正在重试...'
    }
};

// --- Auto Summary Toggle Handling ---
async function handleAutoSummaryToggle(event: Event): Promise<void> {
    const toggleElement = event.target as HTMLInputElement;
    autoSummaryEnabled = toggleElement.checked;
    console.log(`[Popup] Auto summary ${autoSummaryEnabled ? 'enabled' : 'disabled'}`);
    
    // Save setting to storage
    await chrome.storage.local.set({ autoSummaryEnabled });
    
    // If enabling, notify content script to potentially start auto summary
    if (autoSummaryEnabled) {
        // Get active tab and check for YouTube URL
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeTab = tabs[0];
        if (activeTab?.id && activeTab?.url?.includes("youtube.com/watch")) {
            console.log("[Popup] Notifying content script about auto summary setting change on active YouTube page");
            // Send message to background script to possibly trigger auto summary
            chrome.runtime.sendMessage({
                action: 'autoSummarySettingChanged',
                enabled: true,
                tabId: activeTab.id,
                language: currentLanguage
            });
        }
    }
}
