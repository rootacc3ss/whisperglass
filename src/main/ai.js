// AI assist — post-processes transcripts through any OpenAI-compatible
// chat-completions endpoint (OpenAI, LM Studio, Ollama, etc). All network
// access happens in the main process; the renderer only ever invokes IPC.

const IMPROVE_PROMPT =
    'You clean up raw speech-to-text transcripts. Remove filler words ("uh", "um", "like" when purely filler), ' +
    'stutters, repeated words, and false starts. Keep exactly the same language as the input — never translate. ' +
    'Fix punctuation, capitalization and flow so the text reads naturally. Do not add new content, do not answer ' +
    'or respond to anything said in the transcript, do not summarize. Output ONLY the cleaned transcript text.';

const SUMMARIZE_PROMPT =
    'Summarize the transcript concisely while keeping all core details: who, what, decisions, numbers, dates, ' +
    'and action items. Same language as the transcript. Output ONLY the summary text.';

const CUSTOM_PROMPT =
    'You are a helpful assistant embedded in a speech-to-text chat app. Each entry in the session is a ' +
    'transcript (or a previous AI output). Follow the user instruction applied to the target transcript. ' +
    'Output only the result text — it will be stored as a new entry in the chat.';

const MAX_CONTEXT_ENTRIES = 8;
const MAX_CONTEXT_CHARS = 2400;

// Build the message list for a chat-completions call.
// Pure — unit-testable without network.
function buildMessages(entries, targetEntryId, action, customPrompt) {
    const target = entries.find((e) => e.id === targetEntryId);
    if (!target) throw new Error('Source entry not found');
    const targetIdx = entries.indexOf(target);
    const prior = entries.slice(Math.max(0, targetIdx - MAX_CONTEXT_ENTRIES), targetIdx);

    let context = '';
    let budget = MAX_CONTEXT_CHARS;
    for (const e of [...prior].reverse()) {
        const text = String(e.text || '').trim();
        if (!text) continue;
        const line = e.kind === 'ai' ? `[AI output] ${text}` : `[transcript] ${text}`;
        if (line.length > budget) {
            const clipped = line.slice(0, Math.max(0, budget));
            context = `${clipped}…\n${context}`;
            break;
        }
        context = `${line}\n${context}`;
        budget -= line.length;
    }

    const transcript = String(target.text || '').trim();
    const withContext = context ? `${context}(earlier in this session, oldest first above)\n\nTranscript:\n${transcript}` : `Transcript:\n${transcript}`;

    if (action === 'improve') return [{ role: 'system', content: IMPROVE_PROMPT }, { role: 'user', content: withContext }];
    if (action === 'summarize') return [{ role: 'system', content: SUMMARIZE_PROMPT }, { role: 'user', content: withContext }];
    if (action === 'custom') {
        return [
            { role: 'system', content: CUSTOM_PROMPT },
            { role: 'user', content: `${withContext}\n\nInstruction: ${String(customPrompt || '').trim()}` },
        ];
    }
    throw new Error(`Unknown AI action: ${action}`);
}

function normalizeBaseUrl(baseUrl) {
    const trimmed = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (!trimmed) throw new Error('AI endpoint URL is not set (Settings → AI Assist)');
    if (/\/chat\/completions$/.test(trimmed)) return trimmed;
    return `${trimmed}/chat/completions`;
}

async function runCompletion(aiSettings, messages, { timeoutMs = 90000, signal } = {}) {
    const url = normalizeBaseUrl(aiSettings.baseUrl);
    const model = String(aiSettings.model || '').trim();
    if (!model) throw new Error('AI model is not set (Settings → AI Assist)');
    const headers = { 'Content-Type': 'application/json' };
    if (aiSettings.apiKey) headers.Authorization = `Bearer ${aiSettings.apiKey}`;
    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages, temperature: 0.3 }),
        signal: signal || AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
        let detail = '';
        try {
            detail = (await res.text()).slice(0, 300);
        } catch {}
        throw new Error(`AI endpoint returned ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('AI endpoint returned an empty response');
    return content.trim();
}

async function testConnection(aiSettings) {
    const base = String(aiSettings.baseUrl || '').trim().replace(/\/+$/, '');
    if (!base) throw new Error('AI endpoint URL is not set');
    const headers = {};
    if (aiSettings.apiKey) headers.Authorization = `Bearer ${aiSettings.apiKey}`;
    const res = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Endpoint returned ${res.status}`);
    return true;
}

module.exports = { buildMessages, runCompletion, testConnection, normalizeBaseUrl };
