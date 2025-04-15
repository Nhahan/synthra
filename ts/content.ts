// Synthra - YouTube Transcript Extractor and Summarizer
// This script extracts transcript data using youtube-transcript library and responds to background script requests.

import { YoutubeTranscript, TranscriptResponse } from 'youtube-transcript';

// --- Type Definitions ---
// TranscriptItem is no longer needed here as we use TranscriptResponse from the library

// Extend the Window interface to include custom property
declare global {
    interface Window {
        synthraInitialized?: boolean;
        synthraButtonObserver?: MutationObserver; // Keep track of the observer
    }
}

// --- Global variables (with types) ---
let currentVideoId: string | null = null;
let isAutoSummaryEnabled: boolean = false;
let currentLanguage: string = 'ko';

// Initialize when the script is injected or page loads
if (document.readyState === "complete" || document.readyState === "interactive") {
    initSynthra();
} else {
    document.addEventListener('DOMContentLoaded', initSynthra);
}

// Initialize Synthra for the current page
async function initSynthra(): Promise<void> {
  // Debounce or ensure it only runs once per page context
  if (window.synthraInitialized) return;
  window.synthraInitialized = true;

  console.log("[Content] Initializing Synthra...");
  updateVideoId(); // Get current video ID
  
  // Load user settings
  const settings = await chrome.storage.local.get(['autoSummaryEnabled', 'selectedLanguage']);
  isAutoSummaryEnabled = settings.autoSummaryEnabled || false;
  currentLanguage = settings.selectedLanguage || 'ko';
  
  console.log(`[Content] Settings loaded: autoSummary=${isAutoSummaryEnabled}, language=${currentLanguage}`);

  if (currentVideoId) {
    console.log("[Content] Synthra initialized for video:", currentVideoId);
    
    // If auto summary is enabled, start the summary process after a short delay
    // to ensure the page is fully loaded
    if (isAutoSummaryEnabled) {
      console.log("[Content] Auto summary is enabled, will generate summary in 2 seconds");
      setTimeout(() => {
        triggerAutoSummary();
      }, 2000);
    }
  } else {
    console.log("[Content] Not a watch page or no video ID found.");
  }
  
  // Listen for YouTube navigation events (SPA behavior)
  observeNavigation();
}

// Function to trigger auto summary
async function triggerAutoSummary(): Promise<void> {
    if (!isAutoSummaryEnabled) {
        console.log("[Content] Auto summary is disabled, skipping...");
        return;
    }

    console.log("[Content] Starting auto summary process");
    
    try {
        // 트랜스크립트가 로드될 때까지 기다림 (최대 10초)
        let attempts = 0;
        const maxAttempts = 20; // 10초 (500ms * 20)
        
        // 스피너 요소가 존재할 때까지 대기
        while (attempts < maxAttempts) {
            if (hasTranscript()) {
                console.log("[Content] Transcript found, proceeding with summary");
                break;
            }
            
            console.log(`[Content] Waiting for transcript (attempt ${attempts + 1}/${maxAttempts})...`);
            await new Promise(resolve => setTimeout(resolve, 500));
            attempts++;
        }
        
        if (attempts >= maxAttempts) {
            console.log("[Content] Transcript not found after maximum attempts, aborting auto summary");
            return;
        }
        
        // 트랜스크립트를 가져와서 백그라운드 스크립트에 보내기
        const transcript = await getTranscript();
        if (!transcript) {
            console.log("[Content] Failed to get transcript for auto summary");
            return;
        }
        
        console.log(`[Content] Got transcript (${transcript.length} chars), sending request for auto summary`);
        
        // 백그라운드 또는 팝업에 트랜스크립트가 준비되었음을 알림
        chrome.runtime.sendMessage({
            action: "transcriptReady",
            transcript: transcript,
            videoId: currentVideoId
        });
    } catch (error) {
        console.error("[Content] Error during auto summary:", error);
    }
}

// Helper function to get current tab ID
async function getCurrentTabId(): Promise<number> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs && tabs.length > 0 && tabs[0].id) {
    return tabs[0].id;
  }
  throw new Error("Cannot determine current tab ID");
}

// Update currentVideoId based on URL
function updateVideoId(): void {
  const urlParams = new URLSearchParams(window.location.search);
  const newVideoId = urlParams.get('v');
  
  if (newVideoId !== currentVideoId) {
    console.log(`[Content] Video ID changed from ${currentVideoId} to ${newVideoId}`);
    currentVideoId = newVideoId;
    
    // If auto summary is enabled and we have a new video ID, generate a summary
    if (isAutoSummaryEnabled && currentVideoId) {
      console.log("[Content] New video detected with auto summary enabled, will generate summary in 2 seconds");
      setTimeout(() => {
        triggerAutoSummary();
      }, 2000);
    }
  }
}

// --- Transcript Extraction (using youtube-transcript library) ---
async function getTranscript(): Promise<string | null> {
    updateVideoId(); // Ensure currentVideoId is up-to-date

    if (!currentVideoId) {
        console.warn("[Content] Cannot fetch transcript without video ID.");
        return null;
    }

    console.log(`[Content] Attempting to extract transcript for video ID: ${currentVideoId} using youtube-transcript library...`);
    try {
        // Attempt to fetch transcript, potentially specifying language preferences if needed
        // const transcriptResponse: TranscriptResponse[] = await YoutubeTranscript.fetchTranscript(currentVideoId, { lang: 'ko' }); // Example: Prefer Korean
        const transcriptResponse: TranscriptResponse[] = await YoutubeTranscript.fetchTranscript(currentVideoId);
        
        if (!transcriptResponse || transcriptResponse.length === 0) {
            console.warn(`[Content] youtube-transcript returned empty data for video ID: ${currentVideoId}. Might be disabled or unavailable.`);
            throw new Error("Transcript data is empty or unavailable for this video.");
        }

        // Combine transcript items into a single string with newlines
        const fullTranscriptText = transcriptResponse.map((item: TranscriptResponse) => item.text).join('\n');
        
        console.log(`[Content] Successfully extracted transcript using library. Length: ${fullTranscriptText.length}`);
        
        return fullTranscriptText;

    } catch (error: unknown) {
        const typedError = error instanceof Error ? error : new Error(String(error));
        console.error(`[Content] Error extracting transcript using youtube-transcript library for video ID ${currentVideoId}:`, typedError);
        // Rethrow a more user-friendly message potentially
        throw new Error(`Transcript extraction failed: ${typedError.message}`);
    }
}

// --- Navigation Observer --- 
function observeNavigation(): void {
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      console.log(`[Content] Navigation detected: ${lastUrl} -> ${url}`);
      lastUrl = url;
      // Check if it's a watch page navigation
      if (url.includes("youtube.com/watch")) {
          console.log("[Content] Navigated to a watch page. Updating video ID.");
          // Use setTimeout to allow YouTube page to potentially settle before getting video ID
          setTimeout(() => {
              updateVideoId();
              // No need to call initSynthra() here anymore as the script is persistent
          }, 500); 
      } else {
          console.log("[Content] Navigated away from a watch page.");
          currentVideoId = null; // Clear video ID if not on a watch page
      }
      // No need to reset synthraInitialized or close panel as UI is in popup
    }
  });
  observer.observe(document.body, { subtree: true, childList: true }); // Observe body for broader changes
}

// Listen for messages from the popup or background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log(`[Content] Received message: ${request.action} from ${sender.id}`);
    
    // Ping 요청에 응답하여 컨텐츠 스크립트가 활성화되어 있음을 확인
    if (request.action === "ping") {
        console.log("[Content] Ping received, sending response");
        sendResponse({ status: "alive" });
        return true;
    }

    if (request.action === "enableAutoSummary") {
        console.log("[Content] Processing 'enableAutoSummary' message");
        isAutoSummaryEnabled = request.enabled === true;
        if (request.language) {
            currentLanguage = request.language;
        }
        
        if (isAutoSummaryEnabled && isYouTubeVideoPage()) {
            console.log("[Content] Auto summary enabled and on video page, triggering summary");
            // 현재 비디오 ID 업데이트 후 요약 시작
            updateVideoId();
            triggerAutoSummary();
        }
        sendResponse({ success: true });
        return true; // 비동기 응답 지원
    }
    
    if (request.action === "getTranscript") {
        console.log("[Content] Processing 'getTranscript' request...");
        
        // 비동기 함수를 이용해 스크립트 가져오기
        getTranscript().then((transcript) => {
            if (transcript) {
                console.log("[Content] Successfully extracted transcript. Sending back to background.");
                sendResponse({ transcript: transcript });
            } else {
                console.error("[Content] Failed to get transcript for background request (returned null).");
                sendResponse({ error: "Could not extract transcript (video ID missing or other issue)." });
            }
        }).catch((error) => {
            const typedError = error instanceof Error ? error : new Error(String(error));
            console.error("[Content] Error in getTranscript promise:", typedError);
            sendResponse({ error: `Failed to get transcript: ${typedError.message}` });
        });
        
        return true;
    }
    
    console.warn(`[Content] Received unhandled action: ${request.action}`);
    return false;
});

console.log("[Content] Script loaded and message listener added.");

// Ensure the file is treated as a module for global augmentation
export {};

// 유튜브 비디오 페이지인지 확인하는 함수
function isYouTubeVideoPage(): boolean {
    return location.href.includes("youtube.com/watch") && !!getVideoIdFromUrl();
}

// URL에서 비디오 ID 추출
function getVideoIdFromUrl(): string | null {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('v');
}

// 트랜스크립트 있는지 확인하는 함수
function hasTranscript(): boolean {
    // YouTube의 트랜스크립트 버튼이나 컨테이너가 있는지 확인
    const transcriptButton = document.querySelector('button[aria-label*="transcript" i], button[aria-label*="자막" i]');
    if (transcriptButton) {
        return true;
    }
    
    // 또는 YouTube의 텍스트 트랙 (CC) 확인
    const video = document.querySelector('video');
    if (video && video.textTracks && video.textTracks.length > 0) {
        return true;
    }
    
    return false;
} 