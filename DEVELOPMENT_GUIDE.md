# Synthra Development Guide

This document provides detailed information for developers working on the Synthra Chrome extension.

## Development Environment Setup

1. **Clone the repository:**
   ```
   git clone https://github.com/yourusername/synthra.git
   cd synthra
   ```

2. **Install dependencies:**
   ```
   npm install
   ```

3. **Install compatible LLM models:**
   - For the free version: Place a GGUF model (≤1GB) in the `models/free_model/` directory
   - For the premium version: Place a GGUF model (≤2GB) in the `models/premium_model/` directory

4. **Load the extension in Chrome:**
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in the top right)
   - Click "Load unpacked" and select the Synthra directory

5. **Development mode:**
   - Any changes to the extension files will require reloading the extension
   - Click the refresh icon on the extension card in `chrome://extensions/` after making changes

## Project Structure

### Core Files

- `manifest.json`: Extension configuration
- `js/background.js`: Service worker for model loading and coordination
- `js/worker.js`: Web Worker for running WebLLM models
- `js/content.js`: Content script injected into YouTube pages
- `js/popup.js`: Logic for the extension popup
- `popup.html`: Extension popup UI
- `premium.html`: Premium upgrade page

### Directory Structure

```
Synthra/
├── icons/                # Extension icons
├── js/                   # JavaScript files
│   ├── background.js     # Background service worker
│   ├── worker.js         # Web Worker for WebLLM processing
│   ├── content.js        # Content script for YouTube page
│   └── popup.js          # Popup UI script
├── css/                  # CSS stylesheets
│   └── content.css       # Styles for the YouTube page injections
├── models/               # LLM model files (not included in repo)
│   ├── free_model/       # Smaller model for free tier
│   │   └── gemma-3-1b-it-q4_0.gguf # Free model file
│   └── premium_model/    # Larger model for premium tier
│       └── google_gemma-3-4b-it-IQ3_XS.gguf # Premium model file
├── node_modules/         # NPM packages
│   └── @mlc-ai/web-llm/  # WebLLM library
├── popup.html            # Extension popup UI
├── premium.html          # Premium upgrade page
├── manifest.json         # Extension manifest
├── package.json          # NPM package configuration
├── README.md             # User documentation
└── DEVELOPMENT_GUIDE.md  # Developer documentation
```

## Model Integration

### WebLLM and GGUF Models

Synthra uses WebLLM to load and run GGUF (Generalized GPU Format) models directly in the browser using WebAssembly and WebGPU. This approach offers several advantages:

- **Privacy**: All processing happens locally in the browser
- **No server dependency**: Works offline after initial model download
- **GPU acceleration**: Uses WebGPU for hardware acceleration when available

### Web Worker Architecture

The extension uses a Web Worker architecture to separate model inference from the main UI thread:

1. `background.js`: Service worker that coordinates communication
2. `worker.js`: Web Worker that loads the model and runs inference
3. Communication happens through message passing

This architecture prevents UI freezing during model loading and inference operations.

### Integration Implementation

The actual model integration is implemented as follows:

```javascript
// In worker.js
async function loadFreeModel() {
  if (freeEngine || isModelLoading) return;
  
  try {
    isModelLoading = true;
    modelStatus = 'loading';
    
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
  } catch (error) {
    console.error('Error loading free model:', error);
    modelStatus = 'error';
    throw error;
  } finally {
    isModelLoading = false;
  }
}
```

### Transcript Processing

Processing YouTube transcripts happens in the `summarizeTranscript` function:

```javascript
// In worker.js
async function summarizeTranscript(transcriptText, isPremium) {
  const engine = isPremium ? premiumEngine : freeEngine;
  
  // Create chat completion
  const response = await engine.chat.completions.create({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.3,
    max_tokens: isPremium ? 4096 : 2048  // Optimal token limits for Gemma 3-4B and Gemma 3-1B
  });
  
  // Return formatted summary
  return isPremium ? 
    formatPremiumSummary(response.choices[0].message.content) : 
    formatFreeSummary(response.choices[0].message.content);
}
```

### Model Token Limits

Gemma models have specific token generation limits that need to be respected for optimal performance:

- **Gemma 3-1B (Free Model)**: 
  - Max input context: 32K tokens
  - Max output generation: 2048 tokens
  - Input text limit: 6000 characters (approximately)

- **Gemma 3-4B (Premium Model)**:
  - Max input context: 128K tokens
  - Max output generation: 4096 tokens
  - Input text limit: 12000 characters (approximately)

These limits are set in the `summarizeTranscript` function in `worker.js`. If you need to adjust these limits, be aware that:

1. Setting higher token limits than the model supports may cause unexpected behavior
2. Higher token limits increase memory usage and may cause performance issues
3. The exact character-to-token ratio varies by language and content type

## Feature Development

### Adding New Features

1. **Plan the feature**: Define what the feature should do and how it interacts with existing code
2. **Implement the feature**: Add the necessary code to the appropriate files
3. **Test the feature**: Test on different YouTube videos and scenarios
4. **Document the feature**: Update README.md and this development guide as needed

### YouTube Integration

The `content.js` file handles all interactions with the YouTube page. Key functions:

- `initSynthra()`: Initializes the extension on YouTube pages
- `addSynthraButton()`: Adds the Synthra button to YouTube's control bar
- `getTranscript()`: Extracts the transcript from the YouTube page
- `displaySummary()`: Shows the generated summary on the page

When making changes to YouTube integration, be aware that YouTube's DOM structure may change over time, requiring updates to selectors and extraction logic.

## WebLLM Configuration

### Model Configuration

WebLLM models can be configured with various parameters:

- `model_url`: Path to the GGUF model file
- `model_id`: Unique identifier for the model
- `local_id`: Local identifier used within the application

### Chat Completion Parameters

When generating summaries, you can control model behavior with parameters:

- `temperature`: Controls randomness (lower = more deterministic)
- `max_tokens`: Maximum length of generated response
- `top_p`: Top-p sampling (nucleus sampling)
- `top_k`: Top-k sampling
- `repetition_penalty`: Penalizes repetition

### Troubleshooting WebLLM Issues

Common issues with WebLLM:

1. **WebGPU not available**: Falls back to CPU which is much slower
2. **Model too large**: Browser may crash if model exceeds available memory
3. **CORS issues**: Make sure models are accessible to the extension

## Testing

### Manual Testing

Test the extension thoroughly on various YouTube videos:

1. Videos with transcripts in different languages
2. Videos with auto-generated transcripts
3. Videos with manually created transcripts
4. Videos of different lengths
5. Videos with different types of content (lectures, music, tutorials, etc.)

### Debugging

Use Chrome's developer tools to debug the extension:

1. View background script logs: Go to `chrome://extensions/`, find Synthra, and click "background page" under "Inspect views"
2. View content script logs: Right-click on a YouTube page, select "Inspect", and check the Console tab
3. Debug popup: Right-click the extension icon, select "Inspect popup"
4. Debug worker: Check the Console for worker-related errors

## Distribution

### Preparing for Release

1. Update version number in `manifest.json`
2. Update copyright year in footer sections
3. Test thoroughly on multiple YouTube videos
4. Create a zip file of the extension folder for submission

### Packaging the Extension

The project includes built-in packaging functionality:

```bash
# Using the npm script
npm run package

# Or using the deployment script directly
node scripts/deploy.js
```

This will create a `synthra.zip` file that can be submitted to the Chrome Web Store. The packaging script:

1. Validates critical files are present
2. Creates model directory placeholders if needed
3. Excludes unnecessary files (node_modules, git files, etc.)
4. Creates a zip archive suitable for Web Store submission

### Chrome Web Store Submission

To publish on the Chrome Web Store:

1. Create a developer account on the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/)
2. Pay the one-time developer registration fee
3. Create a new item and upload the `synthra.zip` file
4. Fill out all required information and submit for review

### Distribution Considerations

When distributing the extension, be aware of:

1. **Model Size**: The Gemma models are large files (1-2GB). Consider:
   - Having users download models separately
   - Hosting models on a CDN and loading them dynamically
   - Using smaller quantized models for better distribution

2. **Privacy Policy**: Since the extension processes user data (YouTube transcripts), you should provide a privacy policy that explains:
   - What data is collected
   - How the data is processed
   - Whether any data is transmitted to servers

3. **Terms of Use**: Provide clear terms of use that outline:
   - Acceptable use of the extension
   - Limitations of liability
   - User guidelines

4. **Model License Compliance**: Ensure compliance with Gemma model license terms, including:
   - Including proper attribution
   - Adhering to usage restrictions
   - Disclosing open-source components

## Git LFS for Model Files

The repository is configured to use Git LFS (Large File Storage) for managing large model files. This configuration is defined in the `.gitattributes` file:

```
# Git LFS configuration

# Model files
*.gguf filter=lfs diff=lfs merge=lfs -text
*.bin filter=lfs diff=lfs merge=lfs -text
*.wasm filter=lfs diff=lfs merge=lfs -text

# Track all files in models directory with Git LFS
models/**/* filter=lfs diff=lfs merge=lfs -text
```

For developers working with this repository:

1. **Install Git LFS**: If you haven't already, install Git LFS: https://git-lfs.github.com/

2. **Set up Git LFS**: After cloning the repository, run:
   ```
   git lfs install
   git lfs pull
   ```

3. **Working with model files**: When committing new model files, Git LFS will automatically handle them according to the patterns in `.gitattributes`.

Note that while Git LFS tracks these files, the actual model files are excluded from the repository using `.gitignore` to avoid bloating the repository. Users and developers need to download the models separately.

## Resources

- [Chrome Extensions Documentation](https://developer.chrome.com/docs/extensions/)
- [WebLLM Documentation](https://webllm.mlc.ai/docs/)
- [WebGPU Documentation](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)
- [WebAssembly Documentation](https://webassembly.org/docs/overview/)
- [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference)

## Troubleshooting

### Common Issues

1. **Extension not loading**: Verify manifest.json is valid and all required files are present
2. **Model loading fails**: Check model format compatibility and file paths
3. **WebGPU not available**: Ensure Chrome version supports WebGPU or try enabling it with flags
4. **Transcript extraction fails**: YouTube may have changed its DOM structure, requiring content.js updates
5. **Summary not displaying**: Check content.js for DOM insertion issues
6. **Worker communication fails**: Verify message passing between background and worker

### Getting Help

If you're stuck, check these resources:

1. Review the issues in the GitHub repository
2. Consult the Chrome Extensions documentation
3. Check WebLLM documentation and examples
4. Search for similar problems on Stack Overflow
5. Reach out to the project maintainers through GitHub issues 