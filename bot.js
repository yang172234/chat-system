// ==================== DeepSeek API Bot Module ====================
const https = require('https');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'api.deepseek.com';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

/**
 * Stream chat with DeepSeek API via SSE
 * @param {Array} messages - Array of { role: 'system'|'user'|'assistant', content: string }
 * @param {Function} onChunk - Called with each text delta: (text: string)
 * @param {Function} onDone - Called when stream completes: (fullText: string)
 * @param {Function} onError - Called on error: (error: Error)
 */
function streamChat(messages, onChunk, onDone, onError) {
  if (!DEEPSEEK_API_KEY) {
    onError(new Error('DEEPSEEK_API_KEY not configured'));
    return;
  }

  const body = JSON.stringify({
    model: DEEPSEEK_MODEL,
    messages,
    stream: true,
  });

  const options = {
    hostname: DEEPSEEK_BASE_URL,
    port: 443,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      'Accept': 'text/event-stream',
    },
    timeout: 30000,
  };

  const req = https.request(options, (res) => {
    if (res.statusCode !== 200) {
      let errorBody = '';
      res.on('data', chunk => { errorBody += chunk.toString(); });
      res.on('end', () => {
        let errMsg = `DeepSeek API returned ${res.statusCode}`;
        try {
          const parsed = JSON.parse(errorBody);
          if (parsed.error?.message) errMsg = parsed.error.message;
        } catch (e) { /* ignore parse error */ }
        onError(new Error(errMsg));
      });
      return;
    }

    let fullText = '';
    let buffer = '';

    res.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      // Keep the last incomplete line in buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '' || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        const jsonStr = trimmed.slice(6);
        try {
          const parsed = JSON.parse(jsonStr);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            onChunk(delta);
          }
        } catch (e) {
          // Skip malformed SSE lines
        }
      }
    });

    res.on('end', () => {
      // Process remaining buffer
      const trimmed = buffer.trim();
      if (trimmed && trimmed !== 'data: [DONE]' && trimmed.startsWith('data: ')) {
        try {
          const parsed = JSON.parse(trimmed.slice(6));
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            onChunk(delta);
          }
        } catch (e) { /* skip */ }
      }
      onDone(fullText);
    });

    res.on('error', onError);
  });

  req.on('timeout', () => {
    req.destroy();
    if (fullText) {
      // Partial response delivered
      onDone(fullText + '\n\n[回复被截断]');
    } else {
      onError(new Error('请求超时，AI 服务响应过慢'));
    }
  });

  req.on('error', onError);

  req.write(body);
  req.end();
}

/**
 * Non-streaming chat (fallback)
 */
function chat(messages) {
  return new Promise((resolve, reject) => {
    if (!DEEPSEEK_API_KEY) {
      reject(new Error('DEEPSEEK_API_KEY not configured'));
      return;
    }

    const body = JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages,
      stream: false,
    });

    const options = {
      hostname: DEEPSEEK_BASE_URL,
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      },
      timeout: 30000,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk.toString(); });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error?.message) {
            reject(new Error(parsed.error.message));
          } else {
            resolve(parsed.choices?.[0]?.message?.content || '');
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { streamChat, chat };
