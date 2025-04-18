/**
 * The target MLC-Chat model ID to be used by both background and popup scripts.
 * Ensure this matches a model compatible with the WebLLM library being used.
 */
export const TARGET_MODEL_ID = "Llama-3.2-3B-Instruct-q4f16_1-MLC";

/**
 * Supported languages for summarization and UI localization.
 */
export type SupportedLanguage = 'en' | 'ko' | 'ja' | 'zh'; 