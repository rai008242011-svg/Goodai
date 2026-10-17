// Vercel サーバー関数: /api/stt （音声→文字）
// OPENAI_API_KEY があれば gpt-transcribe、なければ（または失敗したら）Groq Whisper を使います。
// 環境変数: OPENAI_API_KEY / GROQ_API_KEY / APP_PASSCODE / OPENAI_STT_MODEL / GROQ_STT_MODEL

async function transcribe(url, key, model, buf) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'audio/wav' }), 'a.wav');
  fd.append('model', model);
  fd.append('language', 'ja');
  const r = await fetch(url, { method: 'POST', headers: { authorization: 'Bearer ' + key }, body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || ('文字起こしエラー ' + r.status));
  return String(j.text || '').trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POSTだけ使えます' }); return; }
  const pass = process.env.APP_PASSCODE;
  if (pass && req.headers['x-pass'] !== pass) { res.status(401).json({ error: '合言葉が違います' }); return; }
  const ok = process.env.OPENAI_API_KEY, gk = process.env.GROQ_API_KEY;
  if (!ok && !gk) { res.status(500).json({ error: 'OPENAI_API_KEY か GROQ_API_KEY が未設定です' }); return; }

  let buf = req.body;
  if (!Buffer.isBuffer(buf)) {
    const c = [];
    for await (const x of req) c.push(x);
    buf = Buffer.concat(c);
  }
  if (!buf.length || buf.length > 4000000) { res.status(400).json({ error: '音声が空か、大きすぎます' }); return; }

  let text = null, err = '';
  if (ok) {
    try { text = await transcribe('https://api.openai.com/v1/audio/transcriptions', ok, process.env.OPENAI_STT_MODEL || 'gpt-transcribe', buf); }
    catch (e) { err = String(e.message || e); }
  }
  if (text === null && gk) {
    try { text = await transcribe('https://api.groq.com/openai/v1/audio/transcriptions', gk, process.env.GROQ_STT_MODEL || 'whisper-large-v3', buf); }
    catch (e) { err = err || String(e.message || e); }
  }
  if (text === null) { res.status(502).json({ error: err || '文字起こしに失敗しました' }); return; }
  res.status(200).json({ text });
}
