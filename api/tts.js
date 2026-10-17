// Vercel サーバー関数: /api/tts （文字→音声 / Gemini TTS）
// 環境変数: GEMINI_API_KEY (必須) / APP_PASSCODE / GEMINI_TTS_MODEL

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POSTだけ使えます' }); return; }
  const pass = process.env.APP_PASSCODE;
  if (pass && req.headers['x-pass'] !== pass) { res.status(401).json({ error: '合言葉が違います' }); return; }
  const key = process.env.GEMINI_API_KEY;
  if (!key) { res.status(500).json({ error: 'GEMINI_API_KEY が未設定です' }); return; }

  const b = req.body || {};
  const text = String(b.text || '').trim().slice(0, 1200);
  if (!text) { res.status(400).json({ error: 'text が必要です' }); return; }
  const voice = /^[A-Za-z]{3,20}$/.test(b.voice || '') ? b.voice : 'Kore';
  const model = process.env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview';

  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Say in a natural, friendly Japanese voice: ' + text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
        }
      })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { res.status(502).json({ error: (j.error && j.error.message) || ('音声合成エラー ' + r.status) }); return; }
    const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
    const inl = parts.map(p => p.inlineData).find(Boolean);
    if (!inl || !inl.data) { res.status(502).json({ error: '音声が返りませんでした' }); return; }
    const m = /rate=(\d+)/.exec(inl.mimeType || '');
    res.status(200).json({ pcm: inl.data, rate: m ? +m[1] : 24000 });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
