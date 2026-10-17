// Vercel サーバー関数: /api/stt （音声→文字）
// GEMINI_API_KEY があれば Gemini（gemini-3.5-flash-lite）で文字起こし、
// なければ（または失敗したら）Groq Whisper を使います。OpenAIのキーは不要です。
// 環境変数: GEMINI_API_KEY / GROQ_API_KEY / APP_PASSCODE / GEMINI_STT_MODEL / GROQ_STT_MODEL

async function viaGemini(key, buf) {
  const model = process.env.GEMINI_STT_MODEL || 'gemini-3.5-flash-lite';
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts: [
        { text: 'この音声を日本語で書き起こしてください。話された内容だけを出力し、説明や注釈は付けないでください。話し声がなければ、何も出力しないでください。' },
        { inlineData: { mimeType: 'audio/wav', data: buf.toString('base64') } }
      ] }],
      generationConfig: { temperature: 0, maxOutputTokens: 500 }
    })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || ('Gemini 文字起こしエラー ' + r.status));
  const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
  return parts.map(p => p.text || '').join('').trim();
}

async function viaGroq(key, buf) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'audio/wav' }), 'a.wav');
  fd.append('model', process.env.GROQ_STT_MODEL || 'whisper-large-v3');
  fd.append('language', 'ja');
  fd.append('temperature', '0');
  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST', headers: { authorization: 'Bearer ' + key }, body: fd
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || ('文字起こしエラー ' + r.status));
  return String(j.text || '').trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POSTだけ使えます' }); return; }
  const pass = process.env.APP_PASSCODE;
  if (pass && req.headers['x-pass'] !== pass) { res.status(401).json({ error: '合言葉が違います' }); return; }
  const gk = process.env.GEMINI_API_KEY, qk = process.env.GROQ_API_KEY;
  if (!gk && !qk) { res.status(500).json({ error: 'GEMINI_API_KEY か GROQ_API_KEY が未設定です' }); return; }

  let buf = req.body;
  if (!Buffer.isBuffer(buf)) {
    const c = [];
    for await (const x of req) c.push(x);
    buf = Buffer.concat(c);
  }
  if (!buf.length || buf.length > 4000000) { res.status(400).json({ error: '音声が空か、大きすぎます' }); return; }

  let text = null, err = '';
  if (gk) {
    try { text = await viaGemini(gk, buf); } catch (e) { err = String(e.message || e); }
  }
  if (text === null && qk) {
    try { text = await viaGroq(qk, buf); } catch (e) { err = err || String(e.message || e); }
  }
  if (text === null) { res.status(502).json({ error: err || '文字起こしに失敗しました' }); return; }
  res.status(200).json({ text });
}
