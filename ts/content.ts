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
  if (!currentVideoId || !isAutoSummaryEnabled) {
    console.log("[Content] Auto summary skipped: no video ID or feature disabled");
    return;
  }
  
  console.log(`[Content] Triggering auto summary for video ${currentVideoId} in ${currentLanguage}`);
  
  try {
    // Get transcript
    const transcript = await getTranscript();
    if (!transcript) {
      console.error("[Content] Cannot generate auto summary: failed to get transcript");
      return;
    }
    
    // Request summary from background script
    const response = await chrome.runtime.sendMessage({
      action: 'summarizeVideo',
      tabId: await getCurrentTabId(),
      language: currentLanguage
    });
    
    console.log("[Content] Auto summary result:", response);
    
    // Optionally display the summary on the page or notify the user
    // This could be a notification, badge, or UI element
    if (response && response.success && response.summary) {
      // For now, we'll just leave this for popup to handle
      console.log("[Content] Auto summary generated successfully");
    }
  } catch (error) {
    console.error("[Content] Error during auto summary generation:", error);
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

// --- Message Listener (for requests from background script) ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log(`[Content] Received message: ${message.action} from ${sender.id}`);
    
    if (message.action === "getTranscript") {
        console.log("[Content] Processing 'getTranscript' request...");
        getTranscript() // Call the updated getTranscript function
            .then(transcriptText => { // Expecting string | null now
                if (!transcriptText) {
                    // Send specific error if extraction failed but didn't throw (e.g., no video ID)
                    console.error("[Content] Failed to get transcript for background request (returned null).");
                    sendResponse({ error: "Could not extract transcript (video ID missing or other issue)." });
                } else {
                    console.log("[Content] Successfully extracted transcript. Sending back to background.");
                    sendResponse({ transcript: transcriptText }); // Send the string directly
                }
            })
            .catch(error => {
                // Catch errors thrown by getTranscript (library errors, empty transcript errors)
                const typedError = error instanceof Error ? error : new Error(String(error));
                console.error("[Content] Error in getTranscript promise:", typedError);
                sendResponse({ error: `Failed to get transcript: ${typedError.message}` }); // Send the specific error message
            });
        return true; // Indicate asynchronous response
    } 
    else if (message.action === "autoSummaryEnabled") {
        console.log("[Content] Processing 'autoSummaryEnabled' message");
        // Update settings and trigger auto summary if on a video page
        isAutoSummaryEnabled = true;
        if (message.language) {
            currentLanguage = message.language;
        }
        
        if (currentVideoId) {
            console.log("[Content] Auto summary enabled and on video page, triggering summary");
            triggerAutoSummary();
        }
        
        sendResponse({ success: true });
        return false;
    }
    
    console.warn(`[Content] Received unhandled action: ${message.action}`);
    return false;
});

console.log("[Content] Script loaded and message listener added.");

// Ensure the file is treated as a module for global augmentation
export {}; 