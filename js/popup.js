// Synthra - Popup Script
// Handles the popup UI interactions

document.addEventListener('DOMContentLoaded', initPopup);

// Initialize the popup
function initPopup() {
  // Check model status
  checkModelStatus();
  
  // Add event listeners
  document.getElementById('upgrade-button').addEventListener('click', upgradeSubscription);
  document.getElementById('load-premium-model').addEventListener('click', loadPremiumModel);
  
  // Check for subscription status
  chrome.storage.local.get('subscription', (data) => {
    if (data.subscription === 'premium') {
      updateSubscriptionUI('premium');
    }
  });
  
  // Set up automatic status refresh
  setInterval(checkModelStatus, 3000);
}

// Check the status of models
function checkModelStatus() {
  chrome.runtime.sendMessage({ action: 'checkModelStatus' }, (response) => {
    if (response) {
      updateStatusUI(response.modelStatus);
      updateSubscriptionUI(response.subscription);
    }
  });
}

// Update the UI based on model status
function updateStatusUI(status) {
  const statusIndicator = document.getElementById('model-status-indicator');
  const statusText = document.getElementById('model-status-text');
  const statusDescription = document.getElementById('status-description');
  
  // Remove all status classes
  statusIndicator.classList.remove('loading', 'ready', 'error');
  
  // Update UI based on status
  switch (status) {
    case 'loading':
      statusIndicator.classList.add('loading');
      statusText.textContent = '모델 로딩 중...';
      statusDescription.textContent = '모델을 로드하는 중입니다. 잠시만 기다려주세요.';
      break;
      
    case 'ready':
      statusIndicator.classList.add('ready');
      statusText.textContent = '모델 준비됨';
      statusDescription.textContent = '요약 기능을 사용할 준비가 되었습니다. 유튜브 동영상에서 Synthra 버튼을 클릭하세요.';
      break;
      
    case 'error':
      statusIndicator.classList.add('error');
      statusText.textContent = '모델 로딩 오류';
      statusDescription.textContent = '모델 로딩 중 오류가 발생했습니다. 다시 시도해주세요.';
      break;
      
    default:
      statusIndicator.classList.add('loading');
      statusText.textContent = '모델 상태 확인 중...';
      statusDescription.textContent = '모델 상태를 확인하는 중입니다.';
  }
}

// Update UI based on subscription status
function updateSubscriptionUI(subscription) {
  const subscriptionBadge = document.getElementById('subscription-badge');
  const premiumControls = document.getElementById('premium-controls');
  const upgradeButton = document.getElementById('upgrade-button');
  
  if (subscription === 'premium') {
    // Update badge
    subscriptionBadge.textContent = '프리미엄';
    subscriptionBadge.classList.remove('free');
    subscriptionBadge.classList.add('premium');
    
    // Show premium controls
    premiumControls.style.display = 'block';
    
    // Hide or modify upgrade button
    upgradeButton.textContent = '구독 관리';
  } else {
    // Update badge
    subscriptionBadge.textContent = '무료';
    subscriptionBadge.classList.remove('premium');
    subscriptionBadge.classList.add('free');
    
    // Hide premium controls
    premiumControls.style.display = 'none';
    
    // Show upgrade button
    upgradeButton.textContent = '프리미엄으로 업그레이드';
  }
}

// Handle subscription upgrade
function upgradeSubscription() {
  // In a real application, this would open a payment flow
  // For demo purposes, we'll just simulate an upgrade
  
  chrome.storage.local.get('subscription', (data) => {
    if (data.subscription === 'premium') {
      // If already premium, open subscription management page
      chrome.tabs.create({ url: 'subscription.html' });
    } else {
      // Otherwise, simulate upgrade process
      chrome.tabs.create({ url: 'premium.html' });
      
      // For demo: automatically set to premium after delay
      // In a real app, this would happen after payment confirmation
      setTimeout(() => {
        chrome.runtime.sendMessage({ action: 'upgradeSubscription' }, (response) => {
          if (response && response.success) {
            updateSubscriptionUI('premium');
          }
        });
      }, 1000);
    }
  });
}

// Load the premium model
function loadPremiumModel() {
  const loadButton = document.getElementById('load-premium-model');
  loadButton.disabled = true;
  loadButton.textContent = '모델 로딩 중...';
  
  chrome.runtime.sendMessage({ action: 'loadModel', modelType: 'premium' }, (response) => {
    if (response && response.success) {
      loadButton.textContent = '프리미엄 모델 로드됨';
    } else {
      loadButton.textContent = '로딩 실패, 다시 시도';
      loadButton.disabled = false;
    }
  });
} 