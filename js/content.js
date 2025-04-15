// Synthra - YouTube Transcript Extractor and Summarizer
// This script extracts transcript data from YouTube videos

// Global variables
let syntheraActive = false;
let transcriptData = null;
let summarizedData = null;
let currentVideoId = null;

// Initialize when DOM is fully loaded
document.addEventListener('DOMContentLoaded', initSynthra);

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getSummary') {
    getTranscript()
      .then(transcript => {
        chrome.runtime.sendMessage({
          action: 'processTranscript',
          transcript: transcript,
          videoId: currentVideoId,
          premium: message.premium || false
        });
      })
      .catch(error => {
        console.error('Error getting transcript:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep the message channel open for async response
  } else if (message.action === 'displaySummary') {
    displaySummary(message.summary);
    sendResponse({ success: true });
  }
});

// Initialize Synthra
function initSynthra() {
  // Extract video ID from URL
  const url = window.location.href;
  const videoIdMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\?]*)/);
  
  if (videoIdMatch && videoIdMatch[1]) {
    currentVideoId = videoIdMatch[1];
    console.log('Synthra initialized for video:', currentVideoId);
    
    // Add a button to the YouTube interface
    addSynthraButton();
    
    // Listen for video navigation events
    observeVideoChanges();
  }
}

// Add Synthra button to YouTube interface
function addSynthraButton() {
  // Wait for YouTube's control bar to be available
  const checkForControls = setInterval(() => {
    const controlsContainer = document.querySelector('.ytp-right-controls');
    if (controlsContainer) {
      clearInterval(checkForControls);
      
      // Check if button already exists
      if (!document.querySelector('.synthra-button')) {
        // Create button
        const synthraButton = document.createElement('button');
        synthraButton.className = 'ytp-button synthra-button';
        synthraButton.title = 'Summarize with Synthra';
        synthraButton.innerHTML = '<div style="background: linear-gradient(135deg, #6e8efb, #a777e3); border-radius: 4px; padding: 2px 8px; color: white; font-size: 12px;">Synthra</div>';
        
        // Add click event
        synthraButton.addEventListener('click', toggleSynthraSummary);
        
        // Add button to controls
        controlsContainer.prepend(synthraButton);
      }
    }
  }, 1000);
}

// Toggle Synthra summary panel
function toggleSynthraSummary() {
  if (!syntheraActive) {
    // Request summary from the background script
    chrome.runtime.sendMessage({ action: 'getSummary' });
    
    // Show loading indicator
    showLoadingIndicator();
  } else {
    // Remove summary panel
    const summaryPanel = document.querySelector('.synthra-summary-panel');
    if (summaryPanel) {
      summaryPanel.remove();
    }
  }
  
  syntheraActive = !syntheraActive;
}

// Show loading indicator while waiting for summary
function showLoadingIndicator() {
  const videoContainer = document.querySelector('.html5-video-container');
  if (!videoContainer) return;
  
  // Create loading panel
  const loadingPanel = document.createElement('div');
  loadingPanel.className = 'synthra-summary-panel synthra-loading';
  loadingPanel.innerHTML = `
    <div class="synthra-header">
      <h3>Synthra Summary</h3>
      <button class="synthra-close-btn">×</button>
    </div>
    <div class="synthra-content">
      <div class="synthra-loading-spinner"></div>
      <p>Extracting and summarizing video content...</p>
    </div>
  `;
  
  // Add close button functionality
  loadingPanel.querySelector('.synthra-close-btn').addEventListener('click', () => {
    loadingPanel.remove();
    syntheraActive = false;
  });
  
  // Add to page
  document.querySelector('#primary').prepend(loadingPanel);
}

// Display the generated summary
function displaySummary(summary) {
  // Remove any existing panels
  const existingPanel = document.querySelector('.synthra-summary-panel');
  if (existingPanel) {
    existingPanel.remove();
  }
  
  const videoContainer = document.querySelector('.html5-video-container');
  if (!videoContainer) return;
  
  // Create summary panel
  const summaryPanel = document.createElement('div');
  summaryPanel.className = 'synthra-summary-panel';
  
  // Format the summary with HTML
  const formattedSummary = formatSummary(summary);
  
  summaryPanel.innerHTML = `
    <div class="synthra-header">
      <h3>Synthra Summary</h3>
      <button class="synthra-close-btn">×</button>
    </div>
    <div class="synthra-content">
      ${formattedSummary}
    </div>
    <div class="synthra-footer">
      <span>Powered by Synthra AI</span>
      <a href="#" class="synthra-premium-link">Upgrade to Premium</a>
    </div>
  `;
  
  // Add close button functionality
  summaryPanel.querySelector('.synthra-close-btn').addEventListener('click', () => {
    summaryPanel.remove();
    syntheraActive = false;
  });
  
  // Add premium link functionality
  summaryPanel.querySelector('.synthra-premium-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({ action: 'openPremiumPage' });
  });
  
  // Add to page
  document.querySelector('#primary').prepend(summaryPanel);
}

// Format summary with HTML styling
function formatSummary(summary) {
  // Basic formatting - replace line breaks with HTML breaks
  let formatted = summary.replace(/\n/g, '<br>');
  
  // Add section headers if detected
  formatted = formatted.replace(/^([A-Z][^:]+):$/gm, '<h4>$1</h4>');
  
  // Highlight key points or timestamps
  formatted = formatted.replace(/\[(\d+:\d+)\]/g, '<span class="synthra-timestamp">[$1]</span>');
  formatted = formatted.replace(/(Key Points?:)/g, '<strong>$1</strong>');
  
  return formatted;
}

// Extract the transcript from YouTube
async function getTranscript() {
  // If we already have the transcript for current video, return it
  if (transcriptData && currentVideoId) {
    return transcriptData;
  }
  
  // Try to find and click on the "Show transcript" button
  try {
    // Open the menu if not already open
    const moreActionsButton = [...document.querySelectorAll('button')]
      .find(el => el.textContent.includes('More actions'));
    
    if (moreActionsButton) {
      moreActionsButton.click();
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Find and click "Show transcript" option
      const transcriptButton = [...document.querySelectorAll('tp-yt-paper-item')]
        .find(el => el.textContent.includes('Show transcript'));
      
      if (transcriptButton) {
        transcriptButton.click();
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Now extract the transcript
        const transcriptSegments = document.querySelectorAll('ytd-transcript-segment-renderer');
        
        if (transcriptSegments.length > 0) {
          transcriptData = Array.from(transcriptSegments).map(segment => {
            const timestamp = segment.querySelector('.segment-timestamp').textContent.trim();
            const text = segment.querySelector('.segment-text').textContent.trim();
            return { timestamp, text };
          });
          
          return transcriptData;
        } else {
          throw new Error('Transcript segments not found');
        }
      } else {
        throw new Error('Transcript button not found');
      }
    } else {
      throw new Error('More actions button not found');
    }
  } catch (error) {
    console.error('Error extracting transcript:', error);
    
    // Fallback: Try to find transcript through YouTube API
    // This would require additional implementation and possibly Google API keys
    
    throw new Error('Failed to extract transcript: ' + error.message);
  }
}

// Observe video changes to update for new videos
function observeVideoChanges() {
  let lastUrl = location.href;
  
  // Create a new observer
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      
      // Extract new video ID
      const videoIdMatch = lastUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\?]*)/);
      
      if (videoIdMatch && videoIdMatch[1]) {
        // Update current video ID
        currentVideoId = videoIdMatch[1];
        
        // Reset data
        transcriptData = null;
        summarizedData = null;
        syntheraActive = false;
        
        console.log('Synthra detected new video:', currentVideoId);
        
        // Ensure button is available on new video
        addSynthraButton();
      }
    }
  });
  
  // Start observing
  observer.observe(document, { subtree: true, childList: true });
} 