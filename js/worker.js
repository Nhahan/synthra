// Synthra - WebLLM Worker
// Handles LLM model loading and processing in a separate thread

// Import WebLLM
importScripts("../node_modules/@mlc-ai/web-llm/dist/web-llm.umd.js");

// Local variables
let freeEngine = null;
let premiumEngine = null;
let isModelLoading = false;
let modelStatus = 'idle'; // 'idle', 'loading', 'ready', 'error'

// Handle messages from main thread
self.onmessage = async function(event) {
  const data = event.data;
  
  switch (data.action) {
    case 'loadFreeModel':
      loadFreeModel()
        .then(() => {
          self.postMessage({
            action: 'modelLoaded',
            type: 'free',
            success: true
          });
        })
        .catch((error) => {
          self.postMessage({
            action: 'modelLoaded',
            type: 'free',
            success: false,
            error: error.message
          });
        });
      break;
      
    case 'loadPremiumModel':
      loadPremiumModel()
        .then(() => {
          self.postMessage({
            action: 'modelLoaded',
            type: 'premium',
            success: true
          });
        })
        .catch((error) => {
          self.postMessage({
            action: 'modelLoaded',
            type: 'premium',
            success: false,
            error: error.message
          });
        });
      break;
      
    case 'summarizeTranscript':
      try {
        const summary = await summarizeTranscript(
          data.transcript,
          data.isPremium
        );
        self.postMessage({
          action: 'summarizeResult',
          videoId: data.videoId,
          success: true,
          summary: summary
        });
      } catch (error) {
        self.postMessage({
          action: 'summarizeResult',
          videoId: data.videoId,
          success: false,
          error: error.message
        });
      }
      break;
      
    case 'checkStatus':
      self.postMessage({
        action: 'statusResult',
        modelStatus: modelStatus,
        freeModelLoaded: freeEngine !== null,
        premiumModelLoaded: premiumEngine !== null
      });
      break;
  }
};

// Function to load the free model
async function loadFreeModel() {
  if (freeEngine || isModelLoading) return;
  
  try {
    isModelLoading = true;
    modelStatus = 'loading';
    
    // Report loading status
    self.postMessage({
      action: 'statusUpdate',
      modelStatus: 'loading',
      type: 'free'
    });
    
    console.log('Loading free model...');
    
    // Configure custom model with local GGUF file
    const appConfig = {
      "model_list": [
        {
          "model_url": "../models/free_model/gemma-3-1b-it-q4_0.gguf",
          "model_id": "gemma-3-1b-it-q4_0",
          "local_id": "free_model"
        }
      ]
    };
    
    // Initialize progress callback
    const initProgressCallback = (report) => {
      console.log(`Loading progress: ${report.progress}, Phase: ${report.text}`);
      self.postMessage({
        action: 'loadingProgress',
        type: 'free',
        progress: report.progress,
        phase: report.text
      });
    };
    
    // Create MLCEngine instance with the free model
    freeEngine = new webllm.MLCEngine({
      initProgressCallback: initProgressCallback
    });
    
    // Load the model
    await freeEngine.reload("free_model", { appConfig });
    
    console.log('Free model loaded successfully');
    modelStatus = 'ready';
    
    // Report success
    self.postMessage({
      action: 'statusUpdate',
      modelStatus: 'ready',
      type: 'free'
    });
  } catch (error) {
    console.error('Error loading free model:', error);
    modelStatus = 'error';
    
    // Report error
    self.postMessage({
      action: 'statusUpdate',
      modelStatus: 'error',
      type: 'free',
      error: error.message
    });
    
    throw error;
  } finally {
    isModelLoading = false;
  }
}

// Function to load the premium model
async function loadPremiumModel() {
  if (premiumEngine || isModelLoading) return;
  
  try {
    isModelLoading = true;
    modelStatus = 'loading';
    
    // Report loading status
    self.postMessage({
      action: 'statusUpdate',
      modelStatus: 'loading',
      type: 'premium'
    });
    
    console.log('Loading premium model...');
    
    // Configure custom model with local GGUF file
    const appConfig = {
      "model_list": [
        {
          "model_url": "../models/premium_model/google_gemma-3-4b-it-IQ3_XS.gguf",
          "model_id": "google_gemma-3-4b-it-IQ3_XS",
          "local_id": "premium_model"
        }
      ]
    };
    
    // Initialize progress callback
    const initProgressCallback = (report) => {
      console.log(`Loading progress: ${report.progress}, Phase: ${report.text}`);
      self.postMessage({
        action: 'loadingProgress',
        type: 'premium',
        progress: report.progress,
        phase: report.text
      });
    };
    
    // Create MLCEngine instance with the premium model
    premiumEngine = new webllm.MLCEngine({
      initProgressCallback: initProgressCallback
    });
    
    // Load the model
    await premiumEngine.reload("premium_model", { appConfig });
    
    console.log('Premium model loaded successfully');
    modelStatus = 'ready';
    
    // Report success
    self.postMessage({
      action: 'statusUpdate',
      modelStatus: 'ready',
      type: 'premium'
    });
  } catch (error) {
    console.error('Error loading premium model:', error);
    modelStatus = 'error';
    
    // Report error
    self.postMessage({
      action: 'statusUpdate',
      modelStatus: 'error',
      type: 'premium',
      error: error.message
    });
    
    throw error;
  } finally {
    isModelLoading = false;
  }
}

// Generate summary using the selected model
async function summarizeTranscript(transcriptText, isPremium) {
  const engine = isPremium ? premiumEngine : freeEngine;
  
  if (!engine) {
    throw new Error(`${isPremium ? 'Premium' : 'Free'} model not loaded`);
  }
  
  try {
    // Prepare prompt for the LLM
    const systemPrompt = `You are an AI assistant that specializes in summarizing YouTube video transcripts. Provide a concise and informative summary.`;
    
    const userPrompt = `Here is the transcript from a YouTube video. Please provide a ${isPremium ? 'detailed' : 'concise'} summary:
    
    ${transcriptText.substring(0, isPremium ? 12000 : 6000)}`;  // Limit length to prevent token overflow
    
    // Create chat completion
    const response = await engine.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.3,  // Lower temperature for more deterministic summaries
      max_tokens: isPremium ? 4096 : 2048  // Optimal token limits for Gemma 3-4B and Gemma 3-1B
    });
    
    // Format the summary based on premium or free
    if (isPremium) {
      return formatPremiumSummary(response.choices[0].message.content);
    } else {
      return formatFreeSummary(response.choices[0].message.content);
    }
  } catch (error) {
    console.error("Error generating summary with model:", error);
    return `죄송합니다, 요약 생성 중 오류가 발생했습니다: ${error.message}`;
  }
}

// Format basic summary (free version)
function formatFreeSummary(summaryText) {
  return `
주요 내용 요약:
${summaryText}

* 무료 버전은 기본 요약만 제공합니다. 더 자세한 분석과 핵심 포인트는 프리미엄 버전으로 업그레이드하세요.
  `;
}

// Format advanced summary (premium version)
function formatPremiumSummary(summaryText) {
  return `
# 상세 요약 (프리미엄)

${summaryText}

* 프리미엄 버전으로 더 정확하고 상세한 요약을 이용해 주셔서 감사합니다.
  `;
}