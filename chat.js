// Vercel サーバー関数: /api/chat （Groq版・ウェブ検索つき）
// 環境変数: GROQ_API_KEY (必須) / APP_PASSCODE (任意の合言葉) / GROQ_MODEL (任意)
// gpt-oss モデルの内蔵ウェブ検索(browser_search)を使います。失敗したら検索なしに切り替えます。

const SYSTEM = [
  'あなたはORRERYという音声対話アシスタントです。ユーザーとは声で会話しています。',
  '必ず自然な日本語の話し言葉で、1〜3文の短さで返答してください。',
  '天気、ニュース、スポーツ、人物、製品、歴史、科学、料理、旅行、勉強など、どんな分野の質問にも答えてください。',
  '最新の情報、今日の出来事、価格、試合結果、あなたが確信を持てないことは、ウェブ検索で調べてから答えてください。',
  '調べた内容は要点だけを話し言葉でまとめ、出典のURLやサイト名の羅列は読み上げないでください。',
  'あなたの返答は音声で読み上げられます。Markdown、箇条書き、記号、絵文字、URL、脚注番号は使わないでください。',
  '長い説明を求められたら要点だけ話し、続きを聞きたいか尋ねてください。',
  '医療や法律のように重要な話題では、一般的な情報として答え、必要なら専門家への相談をすすめてください。',
  'わからないことは、わからないと正直に答えてください。'
].join('\n');

const FALLBACK = 'openai/gpt-oss-20b';

function clean(t) {
  return String(t || '')
    .replace(/\[([^\]]*)\]\((https?:\/\/[^)]*)\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/【[^】]*】/g, '')
    .replace(/\[\d+\]/g, '')
    .replace(/[*#`_>]/g, '')
    .replace(/\s+\n/g, '\n')
    .trim();
}

async function callGroq(key, model, system, msgs, tools) {
  const body = {
    model,
    max_completion_tokens: 1500,
    messages: [{ role: 'system', content: system }, ...msgs]
  };
  if (model.startsWith('openai/gpt-oss')) {
    body.reasoning_effort = 'low';
    body.temperature = 0.7;
  }
  if (tools) body.tools = [{ type: 'browser_search' }];
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + key },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error((j.error && j.error.message) || ('Groq エラー ' + r.status));
  }
  const text = clean(j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content);
  if (!text) throw new Error('返事が空でした');
  return text;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POSTだけ使えます' });
    return;
  }

  const pass = process.env.APP_PASSCODE;
  if (pass && req.headers['x-pass'] !== pass) {
    res.status(401).json({ error: '合言葉が違います' });
    return;
  }

  const key = process.env.GROQ_API_KEY;
  if (!key) {
    res.status(500).json({ error: 'GROQ_API_KEY が未設定です（Vercelの環境変数に追加して再デプロイ）' });
    return;
  }

  const body = req.body || {};
  if (!Array.isArray(body.messages) || !body.messages.length) {
    res.status(400).json({ error: 'messages が必要です' });
    return;
  }

  const msgs = body.messages.slice(-16).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 2000)
  }));
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length) {
    res.status(400).json({ error: 'user のメッセージが必要です' });
    return;
  }

  const system = SYSTEM + (body.context ? '\n\n現在の状況: ' + String(body.context).slice(0, 400) : '');
  const primary = process.env.GROQ_MODEL || FALLBACK;
  const tries = [[primary, true], [FALLBACK, true], [FALLBACK, false]]
    .filter((t, i, a) => a.findIndex(u => u[0] === t[0] && u[1] === t[1]) === i);
  let firstErr = '';
  for (const [model, tools] of tries) {
    const useTools = tools && model.startsWith('openai/gpt-oss');
    try {
      const reply = await callGroq(key, model, system, msgs, useTools);
      res.status(200).json({ reply, model: model + (useTools ? '（検索あり）' : '（検索なし）') });
      return;
    } catch (e) {
      if (!firstErr) firstErr = String(e.message || e);
    }
  }
  res.status(502).json({ error: firstErr });
}
