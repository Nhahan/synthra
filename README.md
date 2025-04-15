# Synthra - AI YouTube Transcript Summarizer

Synthra is a Chrome extension that uses AI to summarize YouTube video transcripts, helping users quickly understand the content of videos without watching them entirely.

## Features

- **Instant Summaries**: Get concise summaries of YouTube videos with a single click
- **Local AI Processing**: Uses WebLLM to run LLM models directly in your browser
- **GPU Acceleration**: Leverages WebGPU for fast local processing when available
- **Privacy-Focused**: All processing happens locally, no data sent to external servers
- **Free & Premium Tiers**: Basic summarization with the free model, advanced features with premium
- **Timestamps**: (Premium) Get summaries with timestamps to navigate to specific parts of videos
- **Related Topics**: (Premium) Discover related topics and concepts mentioned in the video

## How It Works

Synthra extracts the transcript from YouTube videos and processes it using locally-stored LLM models:

1. **Free version**: Uses a 1GB Gemma model for basic summarization
2. **Premium version**: Uses a more powerful 2GB Gemma model for detailed analysis and additional features

All processing happens locally within the browser using WebLLM, ensuring privacy and eliminating the need for server-based processing.

## Technology Stack

- **WebLLM**: For running LLM models in the browser
- **WebGPU**: For GPU acceleration when available
- **Web Workers**: For non-blocking UI experience
- **Chrome Extensions API**: For YouTube integration
- **GGUF Models**: Gemma 3 models in optimized format

## Installation

1. Download this repository
2. Install dependencies with `npm install`
3. Place the appropriate model files:
   - Free model: Place `gemma-3-1b-it-q4_0.gguf` in the `models/free_model/` directory
   - Premium model: Place `google_gemma-3-4b-it-IQ3_XS.gguf` in the `models/premium_model/` directory
4. Open Chrome and navigate to `chrome://extensions/`
5. Enable "Developer mode" (top right corner)
6. Click "Load unpacked" and select the Synthra directory
7. The extension should now be installed and ready to use

## Model Requirements

### Free Model
- Name: Gemma 3 1B Instruct (quantized)
- Size: ~1GB
- Format: GGUF (compatible with WebLLM)
- Performance: Good for basic summarization
- Max output tokens: 2048

### Premium Model
- Name: Gemma 3 4B Instruct (quantized)
- Size: ~2GB
- Format: GGUF (compatible with WebLLM)
- Performance: Better for detailed analysis and additional features
- Max output tokens: 4096

## Usage

1. Navigate to any YouTube video
2. Click the Synthra button that appears in the YouTube player controls
3. View the generated summary in the panel that appears
4. (Premium) Access additional features like timestamp navigation and related topics

## Development

### Project Structure

```
Synthra/
├── icons/              # Extension icons
├── js/                 # JavaScript files
│   ├── background.js   # Background service worker
│   ├── worker.js       # Web Worker for WebLLM processing
│   ├── content.js      # Content script for YouTube page
│   └── popup.js        # Popup UI script
├── models/             # LLM model files (not included in repo)
│   ├── free_model/     # 1GB model location
│   └── premium_model/  # 2GB model location
├── css/                # CSS stylesheets
├── popup.html          # Extension popup UI
├── premium.html        # Premium upgrade page
├── manifest.json       # Extension manifest
└── README.md           # Documentation
```

### Technology Stack

- JavaScript (ES6+)
- Chrome Extensions API
- WebLLM for LLM model execution
- WebGPU for GPU acceleration
- Web Workers for non-blocking UI
- CSS3 with Flexbox/Grid for layout

## Browser Compatibility

- **Chrome**: Fully compatible (version 113+ required for WebGPU)
- **Edge**: Compatible (WebGPU support required)
- **Firefox**: Not currently supported (pending WebGPU implementation)
- **Safari**: Not currently supported (pending WebGPU implementation)

For browsers without WebGPU support, Synthra will fall back to CPU processing, which may be significantly slower.

## Distribution

### Packaging for Distribution

To create a package for Chrome Web Store submission:

```bash
# Using npm script
npm run package

# Or directly using Node.js
node scripts/deploy.js
```

This will create a `synthra.zip` file that can be submitted to the Chrome Web Store.

### Working with Large Model Files

This project uses Git LFS (Large File Storage) for managing model files. To work with these files:

1. Install Git LFS from [git-lfs.github.com](https://git-lfs.github.com/)
2. After cloning, run:
   ```
   git lfs install
   git lfs pull
   ```

Note: The actual model files are excluded from the repository via `.gitignore` to avoid bloating the repository size. Users need to download the appropriate model files separately.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

For detailed development information, see the [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md).

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- This extension uses WebLLM for local LLM inference
- The models used are based on Google's Gemma models
- Special thanks to the MLC AI community for making WebLLM possible
- Thanks to the open-source AI community for making lightweight language models accessible

---

*Note: The actual LLM models are not included in this repository due to size constraints and licensing requirements. Users need to download compatible models separately and place them in the appropriate directories.* 