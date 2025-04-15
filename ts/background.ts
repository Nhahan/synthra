/// <reference lib="webworker"/>
// Synthra - Background Service Worker
// Uses ExtensionServiceWorkerMLCEngineHandler based on WebLLM examples

import { 
    CreateExtensionServiceWorkerMLCEngine, 
    ExtensionServiceWorkerMLCEngineHandler, 
    MLCEngineInterface, // Keep necessary types
    ChatCompletionMessageParam,
    ChatOptions
} from "@mlc-ai/web-llm";
import { TARGET_MODEL_ID, SupportedLanguage } from './config'; // Import from config

// --- Type Definitions ---
// SupportedLanguage moved to config.ts

interface TranscriptItem { // Keep for internal use if needed, though content script uses different source now
    timestamp: string;
    text: string;
}

interface BackgroundMessage {
    action: string;
    [key: string]: any; // Allow other properties
}

// --- Constants ---
// TARGET_MODEL_ID moved to config.ts

console.log("[SW] Service Worker starting...");

// --- Engine Handler Setup ---
let handler: ExtensionServiceWorkerMLCEngineHandler | undefined;

chrome.runtime.onConnect.addListener((port) => {
    console.log("[SW] Connection received, port name:", port.name);
    if (port.name === "web_llm_service_worker") { 
        console.log("[SW] Port name matches example, setting up handler...");
        if (handler === undefined) {
            handler = new ExtensionServiceWorkerMLCEngineHandler(port);
        } else {
            handler.setPort(port);
        }
        port.onMessage.addListener(handler.onmessage.bind(handler));
    } else {
        console.log("[SW] Port name does not match 'web_llm_service_worker', ignoring for handler setup.");
        // Handle other connections if necessary, or just ignore.
    }
});

// --- Service Worker Lifecycle (Keep for fast activation) ---
self.addEventListener('install', (event: Event) => { 
    console.log('[SW] Install event started.');
    (self as any).skipWaiting(); 
    console.log('[SW] skipWaiting() called.');
});

self.addEventListener('activate', (event: Event) => { 
    console.log('[SW] Activate event started.');
    (event as ExtendableEvent).waitUntil(
        (self as any).clients.claim().then(() => {
            console.log('[SW] clients.claim() successful.');
        }).catch((err: any) => {
            console.error('[SW] clients.claim() failed:', err);
        })
    );
    console.log('[SW] Activate event finished registering waitUntil.');
});

// --- Message Listener (Re-added for Content Script communication) ---
chrome.runtime.onMessage.addListener((message: BackgroundMessage, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void): boolean | undefined => {
    const action = message.action;
    console.log(`[SW] onMessage: Received action: ${action} from sender:`, sender.tab?.id ? `tab ${sender.tab.id}` : "popup or other");

    // --- Handle Non-Async Actions First ---
    if (action === 'keepAlive') {
        console.log("[SW] Received keepAlive ping.");
        sendResponse({ success: true });
        return false;
    }

    // --- Handle Async Actions (Specifically processTranscript) --- 
    const handleAsyncAction = async (): Promise<any> => {
        let engine: MLCEngineInterface | null = null;
        try {
            switch (action) {
                case 'summarizeVideo':
                    console.log("[SW] onMessage: Handling summarizeVideo request.");
                    if (!message.tabId) {
                        throw new Error("Missing 'tabId' in summarizeVideo message.");
                    }
                    if (!message.language) {
                        throw new Error("Missing 'language' in summarizeVideo message.");
                    }
                    const targetTabId = message.tabId;
                    const targetLanguage = message.language as SupportedLanguage;

                    // 1. Request transcript from content script
                    console.log(`[SW] Sending 'getTranscript' message to content script (tab: ${targetTabId}).`);
                    let transcriptText: string;
                    try {
                        const response = await chrome.tabs.sendMessage(targetTabId, { action: "getTranscript" });
                        if (response && response.transcript) {
                            transcriptText = response.transcript;
                            console.log(`[SW] Successfully received transcript from tab ${targetTabId}. Text: ${transcriptText}`);
                        } else {
                            console.error(`[SW] Failed to get transcript from tab ${targetTabId}. Response:`, response);
                            throw new Error(response?.error || "No transcript received from content script.");
                        }
                    } catch (err: any) {
                        console.error(`[SW] Error during chrome.tabs.sendMessage to tab ${targetTabId}:`, err);
                        if (err.message?.includes("Could not establish connection")) {
                             throw new Error("Cannot connect to content script. Ensure the YouTube page is loaded and the extension is active.");
                        } else {
                            throw new Error(`Failed to get transcript: ${err.message || 'Unknown error'}`);
                        }
                    }

                    // 2. Get engine instance
                    console.log("[SW] Getting engine instance for summarizeVideo...");
                    engine = await CreateExtensionServiceWorkerMLCEngine(TARGET_MODEL_ID);
                    console.log("[SW] Engine instance obtained for summarizeVideo.");
                    if (!engine) {
                        throw new Error("Engine could not be initialized for summarization.");
                    }
                    
                    // 3. Generate structured summary
                    console.log(`[SW] Generating structured summary in ${targetLanguage}...`);
                    const structuredSummary = await generateSummaryInternal(engine, transcriptText, targetLanguage);
                    console.log('[SW] Structured summary generation complete.');
                    return { success: true, summary: structuredSummary };

                default:
                    console.warn(`[SW] onMessage: Unhandled async action: ${action}`);
                    return { success: false, error: `Unknown action for onMessage: ${action}` };
            }
        } catch (error: unknown) {
            const typedError = error instanceof Error ? error : new Error(String(error));
            console.error(`[SW] onMessage: Error handling action '${action}':`, typedError);
            return { success: false, error: typedError.message || 'Internal Service Worker Error in onMessage' };
        }
    };

    // Handle async actions based on type
    if (action === 'summarizeVideo') { 
        handleAsyncAction().then(sendResponse);
        return true; // Indicate async response
    } else {
        // Check if it was keepAlive before warning
        if (action !== 'keepAlive') {
             console.warn(`[SW] Received unhandled action: ${action}`);
        }
        return false;
    }
});

// --- Helper Functions (Re-added) --- 

async function processTranscriptInternal(engine: MLCEngineInterface, transcript: TranscriptItem[] | string, videoId: string | undefined, language: SupportedLanguage): Promise<string> {
    console.warn("[SW] processTranscriptInternal called - consider using summarizeVideo flow from popup.");
    if (!engine) {
        throw new Error("Engine instance is missing for processing transcript.");
    }
    if (!transcript || (Array.isArray(transcript) && transcript.length === 0) || (typeof transcript === 'string' && transcript.trim() === '')) {
        throw new Error('No transcript data available');
    }
    
    let transcriptText: string;
    if (Array.isArray(transcript)) {
        transcriptText = transcript.map((item: TranscriptItem) => item.text).join(' ');
    } else {
        transcriptText = transcript;
    }

    console.log(`[SW] Generating summary for video ${videoId || 'Unknown'} (lang: ${language}) via processTranscriptInternal...`);
    try {
        const summary = await generateSummaryInternal(engine, transcriptText, language);
        console.log(`[SW] Summary generated for video ${videoId || 'Unknown'}.`);
        return summary;
    } catch (error: unknown) { 
         const typedError = error instanceof Error ? error : new Error(String(error)); 
         console.error(`[SW] Failed during summary generation for ${videoId || 'Unknown'}:`, typedError);
         throw new Error(`Summary generation failed: ${typedError.message}`); 
    }
}

async function generateSummaryInternal(engine: MLCEngineInterface, transcript: string, language: SupportedLanguage, maxLength: number = 500): Promise<string> {
    if (!engine.chat || typeof engine.chat.completions?.create !== 'function') {
        throw new Error("Engine instance loaded but missing chat completions API.");
    }

    const maxInputLength = 10000; 
    let truncatedTranscript = transcript.length > maxInputLength
        ? transcript.substring(0, maxInputLength) + '...\n(Transcript truncated)'
        : transcript;
        
    const prompts: { [key in SupportedLanguage]: string } = {
        en: `Please provide a structured summary of the key points from the following transcript in English. Present the main ideas clearly and concisely. Transcript:\n\n${truncatedTranscript}\n\nStructured Summary:`,
        ko: `다음 스크립트의 핵심 내용을 한국어로 구조화하여 명확하게 정리해 주세요. 주요 아이디어를 간결하게 제시해야 합니다. 스크립트:\n\n${truncatedTranscript}\n\n정리된 내용:`,
        ja: `以下のトランスクリプトの要点を日本語で構造化し、明確にまとめてください。 主要なアイデアを簡潔に提示してください。 トランスクリプト:\n\n${truncatedTranscript}\n\n整理された内容:`,
        zh: `请用中文结构化地总结以下文字记录的要点，清晰地呈现主要观点。 文字记录：\n\n${truncatedTranscript}\n\n结构化摘要:`
    };
    const prompt = prompts[language] || prompts['en'];

    try {
        const messages: ChatCompletionMessageParam[] = [{ role: "user", content: prompt }]; 
        const chatOpts: ChatOptions = {
             temperature: 0.7,
             top_p: 0.95,
        };

        console.log(`[SW] Calling chat.completions.create (lang: ${language})...`);

        const reply = await engine.chat.completions.create({
            messages: messages,
            max_tokens: maxLength, 
            temperature: chatOpts.temperature,
            top_p: chatOpts.top_p,
        });

        console.log("[SW] Chat completion reply received.");
        const summaryText = reply.choices[0]?.message?.content?.trim() || ""; 
        
        if (!summaryText) {
            console.warn("[SW] Summary generation resulted in empty content.");
            // Provide language-specific error message if possible
            const errorMessages: { [key in SupportedLanguage]: string } = {
                en: "(Could not generate summary)",
                ko: "(요약을 생성하지 못했습니다)",
                ja: "(要約を生成できませんでした)",
                zh: "(未能生成摘要)"
            };
            return errorMessages[language] || errorMessages['en'];
        }
        return summaryText;
        
    } catch (error: unknown) { 
        const typedError = error instanceof Error ? error : new Error(String(error)); 
        console.error(`[SW] Error in WebLLM chat completion (generateSummaryInternal, lang: ${language}):`, typedError);
        // Provide language-specific error message if possible
        const errorMessages: { [key in SupportedLanguage]: string } = {
            en: `AI Generation Failed: ${typedError.message || 'Unknown error'}`,
            ko: `AI 생성 실패: ${typedError.message || '알 수 없는 오류'}`,
            ja: `AI生成に失敗しました: ${typedError.message || '不明なエラー'}`,
            zh: `AI 生成失败: ${typedError.message || '未知错误'}`
        };
        throw new Error(errorMessages[language] || errorMessages['en']);
    }
}

console.log('[SW] Service Worker script evaluated. Handler and Message Listener registered.'); 