// Synthra Extension Deployment Script
// This script creates a zip package of the extension for Chrome Web Store submission

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Define paths and settings
const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_FILE = path.join(ROOT_DIR, 'synthra.zip');
const EXCLUDED_PATTERNS = [
  // Version control
  '.git', '.gitignore', '.gitattributes', '.github',
  // Build artifacts and dependencies
  'node_modules', '.DS_Store', '*.zip', '*.log',
  // Development files
  '.vscode', '.idea',
  // Large model files (they need to be downloaded separately)
  '*.gguf', '*.bin', '*.wasm',
  'models/free_model/*.gguf', 'models/premium_model/*.gguf',
  // Scripts directory itself
  'scripts'
];

// Function to create the exclude pattern string for the zip command
function getExcludePattern() {
  return EXCLUDED_PATTERNS.map(pattern => `'${pattern}'`).join(' ');
}

// Function to check and ensure model directories exist
function ensureModelDirectories() {
  const freeModelDir = path.join(ROOT_DIR, 'models', 'free_model');
  const premiumModelDir = path.join(ROOT_DIR, 'models', 'premium_model');
  
  if (!fs.existsSync(freeModelDir)) {
    fs.mkdirSync(freeModelDir, { recursive: true });
    fs.writeFileSync(path.join(freeModelDir, '.gitkeep'), '');
  }
  
  if (!fs.existsSync(premiumModelDir)) {
    fs.mkdirSync(premiumModelDir, { recursive: true });
    fs.writeFileSync(path.join(premiumModelDir, '.gitkeep'), '');
  }
  
  // Create instructions file for model download
  const instructionsPath = path.join(ROOT_DIR, 'models', 'README.md');
  if (!fs.existsSync(instructionsPath)) {
    const instructions = `# Synthra Model Files

Place model files in the appropriate directories:

## Free Model (Gemma 3 1B)
- Download the Gemma 3 1B instruction-tuned model in GGUF format
- Place in \`free_model/\` directory as \`gemma-3-1b-it-q4_0.gguf\`

## Premium Model (Gemma 3 4B)
- Download the Gemma 3 4B instruction-tuned model in GGUF format
- Place in \`premium_model/\` directory as \`google_gemma-3-4b-it-IQ3_XS.gguf\`

You can download these models from:
- Hugging Face: https://huggingface.co/google
- Kaggle: https://www.kaggle.com/models/google/gemma-3
`;
    fs.writeFileSync(instructionsPath, instructions);
  }
}

// Function to create the zip package
function createPackage() {
  console.log('Creating extension package...');
  
  // Remove any existing package
  if (fs.existsSync(OUTPUT_FILE)) {
    console.log('Removing existing package...');
    fs.unlinkSync(OUTPUT_FILE);
  }
  
  // Create the zip file using system command
  const excludePattern = getExcludePattern();
  const command = `cd "${ROOT_DIR}" && zip -r "${OUTPUT_FILE}" . -x ${excludePattern}`;
  
  try {
    execSync(command, { stdio: 'inherit' });
    
    // Check if the file was created successfully
    if (fs.existsSync(OUTPUT_FILE)) {
      const stats = fs.statSync(OUTPUT_FILE);
      const fileSizeInMB = stats.size / (1024 * 1024);
      console.log(`\nPackage created successfully: ${OUTPUT_FILE} (${fileSizeInMB.toFixed(2)} MB)`);
      console.log('\nNote: Model files are excluded from the package to reduce size.');
      console.log('End users will need to download model files separately as explained in models/README.md');
    } else {
      console.error('Error: Package file was not created.');
      process.exit(1);
    }
  } catch (error) {
    console.error('Error creating package:', error.message);
    process.exit(1);
  }
}

// Function to validate critical files
function validateCriticalFiles() {
  const criticalFiles = [
    'manifest.json',
    'js/worker.js',
    'js/background.js',
    'js/content.js',
    'popup.html'
  ];
  
  console.log('Validating critical files...');
  
  const missingFiles = criticalFiles.filter(file => !fs.existsSync(path.join(ROOT_DIR, file)));
  
  if (missingFiles.length > 0) {
    console.error('Error: The following critical files are missing:');
    missingFiles.forEach(file => console.error(`- ${file}`));
    process.exit(1);
  }
  
  console.log('All critical files present.');
}

// Main function
function main() {
  console.log('Starting Synthra extension packaging process...');
  
  // Ensure model directories exist
  ensureModelDirectories();
  
  // Validate critical files
  validateCriticalFiles();
  
  // Create the package
  createPackage();
  
  console.log('\nPackaging complete!');
  console.log('\nYou can now upload the synthra.zip file to the Chrome Web Store Developer Dashboard.');
  console.log('Visit: https://chrome.google.com/webstore/devconsole/');
}

// Run the main function
main(); 