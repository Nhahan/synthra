// Synthra - Background Service Worker
// Handles LLM model loading and transcript summarization

// Global variables
let worker = null;
let isModelLoading = false;
let modelStatus = 'idle'; // 'idle', 'loading', 'ready', 'error'
let userSubscription = 'free'; // 'free' or 'premium'
let pendingRequests = new Map(); // Store pending requests with unique IDs

// Initialize when service worker is loaded
self.addEventListener('install', (event) => {
  console.log('Synthra service worker installed');
  initializeWorker();
  
  // Pre-load the free model
  loadFreeModel();
});

// Initialize WebWorker
function initializeWorker() {
  if (worker) {
    worker.terminate();
  }
  
  // Create a new WebWorker
  worker = new Worker(new URL('./worker.js', self.location));
  
  // Listen for messages from the worker
  worker.onmessage = (event) => {
    const data = event.data;
    
    switch (data.action) {
      case 'statusUpdate':
        modelStatus = data.modelStatus;
        break;
        
      case 'loadingProgress':
        console.log(`Model loading progress: ${data.progress}, Phase: ${data.phase}`);
        break;
        
      case 'modelLoaded':
        console.log(`${data.type.toUpperCase()} model loaded successfully: ${data.success}`);
        if (!data.success) {
          console.error(`Error loading ${data.type} model:`, data.error);
        }
        break;
        
      case 'summarizeResult':
        // Find the pending request
        const videoId = data.videoId;
        const pendingRequest = pendingRequests.get(videoId);
        if (pendingRequest) {
          if (data.success) {
            // Cache the summary
            const cacheKey = `summary_${videoId}_${pendingRequest.premium ? 'premium' : 'free'}`;
            chrome.storage.local.set({ [cacheKey]: data.summary });
            
            // Send the summary to the content script
            chrome.tabs.sendMessage(pendingRequest.tabId, {
              action: 'displaySummary',
              summary: data.summary
            });
          } else {
            // Handle error
            console.error('Error summarizing transcript:', data.error);
            chrome.tabs.sendMessage(pendingRequest.tabId, {
              action: 'displaySummary',
              summary: 'Error summarizing transcript: ' + data.error
            });
          }
          
          // Remove the pending request
          pendingRequests.delete(videoId);
        }
        break;
    }
  };
  
  // Handle worker errors
  worker.onerror = (error) => {
    console.error('WebWorker error:', error);
    modelStatus = 'error';
  };
}

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'processTranscript':
      processTranscript(message.transcript, message.videoId, message.premium, sender.tab.id)
        .then(() => {
          // Response will be sent asynchronously via the worker
        })
        .catch(error => {
          console.error('Error processing transcript:', error);
          chrome.tabs.sendMessage(sender.tab.id, {
            action: 'displaySummary',
            summary: 'Error summarizing transcript: ' + error.message
          });
        });
      return true; // Keep the message channel open for async response
      
    case 'checkModelStatus':
      if (worker) {
        worker.postMessage({ action: 'checkStatus' });
      }
      
      sendResponse({
        modelStatus: modelStatus,
        subscription: userSubscription
      });
      break;
      
    case 'openPremiumPage':
      chrome.tabs.create({ url: 'premium.html' });
      break;
      
    case 'loadModel':
      if (message.modelType === 'premium') {
        loadPremiumModel()
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: error.message }));
      } else {
        loadFreeModel()
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: error.message }));
      }
      return true; // Keep the message channel open for async response
      
    case 'upgradeSubscription':
      // This would typically involve a payment processor integration
      userSubscription = 'premium';
      chrome.storage.local.set({ subscription: 'premium' });
      sendResponse({ success: true });
      // Load the premium model
      loadPremiumModel();
      break;
  }
});

// Function to load the free model
async function loadFreeModel() {
  if (isModelLoading) return;
  
  try {
    isModelLoading = true;
    modelStatus = 'loading';
    
    console.log('Requesting free model load...');
    
    // Request the worker to load the free model
    worker.postMessage({ action: 'loadFreeModel' });
    
  } catch (error) {
    console.error('Error requesting free model load:', error);
    modelStatus = 'error';
    throw error;
  } finally {
    isModelLoading = false;
  }
}

// Function to load the premium model
async function loadPremiumModel() {
  if (isModelLoading) return;
  
  try {
    isModelLoading = true;
    modelStatus = 'loading';
    
    console.log('Requesting premium model load...');
    
    // Request the worker to load the premium model
    worker.postMessage({ action: 'loadPremiumModel' });
    
  } catch (error) {
    console.error('Error requesting premium model load:', error);
    modelStatus = 'error';
    throw error;
  } finally {
    isModelLoading = false;
  }
}

// Process the transcript data and generate a summary
async function processTranscript(transcript, videoId, premium = false, tabId) {
  if (!transcript || transcript.length === 0) {
    throw new Error('No transcript data available');
  }
  
  console.log(`Processing transcript for video: ${videoId}, Premium: ${premium}`);
  
  // Check for cached summary
  const cacheKey = `summary_${videoId}_${premium ? 'premium' : 'free'}`;
  const cachedData = await chrome.storage.local.get(cacheKey);
  
  if (cachedData && cachedData[cacheKey]) {
    console.log('Returning cached summary');
    return cachedData[cacheKey];
  }
  
  // Prepare transcript text
  const transcriptText = transcript.map(item => item.text).join(' ');
  
  // Store the request with tab ID for later response
  pendingRequests.set(videoId, { tabId, premium });
  
  // Request summarization from the worker
  worker.postMessage({
    action: 'summarizeTranscript',
    transcript: transcriptText,
    isPremium: premium,
    videoId: videoId
  });
}