/* =====================================================================
   chat.js — talks to Groq straight from the browser (no backend)
   ---------------------------------------------------------------------
   • The key and model come from config.js (CONFIG.ai).
   • If the key is missing or Groq cannot be reached, the visitor still
     gets a helpful answer from the facts in CONFIG.ai.knowledge, so the
     website never feels broken.
   ===================================================================== */

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

export class MurariChat {
  constructor(config) {
    this.config = config;
    this.ai = config.ai || {};
    this.history = [];            // last few turns, so follow-up questions work
    this.busy = false;
    this.deadModels = new Set();  // models the API said no to this session
  }

  get hasKey() { return !!(this.ai.apiKey && this.ai.apiKey.trim()); }

  reset() { this.history = []; }

  systemPrompt(ctx) {
    const name = this.config.name || 'Murari Kumar';
    const where = ctx.place === 'office'
      ? `You are sitting in your own founder's office at ${ctx.company || 'one of your companies'}. A visitor named ${ctx.visitor || 'a guest'} has just been brought to you by the receptionist.`
      : 'You are standing in your portfolio island, greeting a visitor who clicked "About me".';
    return [
      `You are ${name}, speaking in the first person as yourself to a website visitor. ${where}`,
      'Be warm, professional and concise: 1 to 3 short sentences unless the visitor clearly asks for detail. Plain text only, no markdown, no lists, no emojis.',
      'Only use the facts below. If you are asked something that is not covered, say honestly that you are not sure and suggest emailing you. Never invent employers, grades, prices or dates.',
      'If asked for something unrelated to you or your work, politely steer back to your projects, skills, studies or contact details.',
      'FACTS:\n' + (this.ai.knowledge || ''),
    ].join('\n\n');
  }

  /** Ask a question. Always resolves with a string. */
  async ask(question, ctx = {}) {
    const q = String(question || '').trim().slice(0, 400);
    if (!q) return '';
    if (!this.hasKey) return this.local(q, 'nokey');
    this.busy = true;
    try {
      const models = [this.ai.model, ...(this.ai.fallbackModels || [])].filter((m) => m && !this.deadModels.has(m));
      if (!models.length) return this.local(q, 'nomodel');
      const messages = [{ role: 'system', content: this.systemPrompt(ctx) }, ...this.history.slice(-8), { role: 'user', content: q }];
      let lastErr = null;
      for (const model of models) {
        try {
          const text = await this.call(model, messages);
          if (text) {
            this.history.push({ role: 'user', content: q }, { role: 'assistant', content: text });
            this.history = this.history.slice(-12);
            return text;
          }
        } catch (err) {
          lastErr = err;
          if (err.status === 401 || err.status === 403) return this.local(q, 'badkey');
          if (err.status === 429) return this.local(q, 'busy');
          if (err.status === 400 || err.status === 404) this.deadModels.add(model);   // model removed or renamed: try the next one
        }
      }
      console.warn('Groq request failed:', lastErr);
      return this.local(q, 'error');
    } finally { this.busy = false; }
  }

  async call(model, messages) {
    const body = { model, messages, temperature: 0.6, max_completion_tokens: this.ai.maxAnswerTokens || 420, stream: false };
    if (model.startsWith('openai/gpt-oss')) { body.reasoning_effort = 'low'; body.include_reasoning = false; }
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 25000);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.ai.apiKey.trim() },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const e = new Error('Groq HTTP ' + res.status); e.status = res.status; throw e; }
      const data = await res.json();
      let text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/[*_`#]+/g, '').trim();
      return text;
    } finally { clearTimeout(timer); }
  }

  /** Offline answer built from the facts in config.js. */
  local(q, why) {
    const lines = (this.ai.knowledge || '').split('\n').filter(Boolean);
    const low = q.toLowerCase();
    const pick = (re) => lines.find((l) => re.test(l.toLowerCase()));
    let hit = null;
    if (/(hi|hello|hey)\b/.test(low) && low.length < 14) hit = 'Hello! Ask me about my projects, skills, studies or how to contact me.';
    else if (/nexora/.test(low)) hit = pick(/nexora/);
    else if (/astro|marketing|social/.test(low)) hit = pick(/astropulse/);
    else if (/health|gis|map/.test(low)) hit = pick(/healthgis/);
    else if (/crop|farm/.test(low)) hit = pick(/crop/);
    else if (/skill|tech|language|stack|know|code|program/.test(low)) hit = pick(/builds for the web/);
    else if (/college|study|studi|educat|univers|degree|diploma|graduat/.test(low)) hit = pick(/centurion/);
    else if (/contact|email|mail|github|reach|hire/.test(low)) hit = pick(/contact:/);
    else if (/who|name|about|yourself/.test(low)) hit = pick(/^name:/);
    if (!hit) hit = lines[0] || 'Please contact me by email and I will reply.';
    hit = hit.replace(/^(name|contact|featured project):\s*/i, '');
    const note = {
      nokey: ' (The AI chat is not switched on yet, so this answer comes from my saved profile.)',
      badkey: ' (The AI key was rejected, so this answer comes from my saved profile.)',
      busy: ' (The AI is busy right now, so this answer comes from my saved profile.)',
      nomodel: ' (No AI model is available right now, so this answer comes from my saved profile.)',
      error: ' (I could not reach the AI just now, so this answer comes from my saved profile.)',
    }[why] || '';
    return hit + note;
  }
}
