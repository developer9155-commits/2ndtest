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
    if (!this.hasKey) return this.remember(q, this.local(q, 'nokey'));
    this.busy = true;
    try {
      const models = [this.ai.model, ...(this.ai.fallbackModels || [])].filter((m) => m && !this.deadModels.has(m));
      if (!models.length) return this.remember(q, this.local(q, 'nomodel'));
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
          if (err.status === 401 || err.status === 403) return this.remember(q, this.local(q, 'badkey'));
          if (err.status === 429) return this.remember(q, this.local(q, 'busy'));
          if (err.status === 400 || err.status === 404) this.deadModels.add(model);   // model removed or renamed: try the next one
        }
      }
      console.warn('Groq request failed:', lastErr);
      return this.remember(q, this.local(q, 'error'));
    } finally { this.busy = false; }
  }

  remember(question, answer) {
    this.history.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
    this.history = this.history.slice(-12);
    return answer;
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

  /** Profile-aware fallback used until a private server-side AI endpoint is configured. */
  local(q, why) {
    const lines = (this.ai.knowledge || '').split('\n').filter(Boolean);
    const low = q.toLowerCase();
    const facts = (re) => lines.filter((line) => re.test(line.toLowerCase()));
    const first = (re) => facts(re)[0];
    const projectLines = facts(/featured project:|works with astropulse|healthgis:|cropindia ai:/);
    let answer;

    if (/\b(hi|hello|hey|good morning|good afternoon)\b/.test(low) && low.length < 40) {
      answer = 'Hello! Ask me about my projects, skills, studies, company or contact details.';
    } else if (/\b(thanks|thank you)\b/.test(low)) {
      answer = 'You are welcome! What else would you like to know about my work?';
    } else if (/\bskills?\b|\btech\b|\blanguages?\b|\bstack\b|\bknow\b|\bcode\b|\bprogram\b/.test(low)) {
      answer = first(/builds for the web/) || 'Please contact me by email to ask about my skills.';
    } else if (/\b(college|study|studies|education|university|degree|diploma|graduate)\b/.test(low)) {
      answer = (first(/centurion/) || 'Please contact me by email to ask about my studies.')
        .replace(/^name:\s*[^.]+\.\s*/i, '');
    } else if (/\b(contact|email|mail|github|reach|hire)\b/.test(low)) {
      answer = first(/^contact:/) || 'Please contact me by email.';
    } else if (/\b(projects|portfolio|built|building|work on)\b/.test(low) && !/\b(nexora|astropulse|healthgis|cropindia)\b/.test(low)) {
      answer = projectLines.join(' ');
    } else if (/\b(nexora|website builder)\b/.test(low)) {
      answer = first(/nexora/);
    } else if (/\b(astropulse|marketing|social media)\b/.test(low)) {
      answer = first(/astropulse/);
    } else if (/\b(healthgis|health gis|map|mapping)\b/.test(low)) {
      answer = first(/healthgis/);
    } else if (/\b(cropindia|crop|farm|agriculture)\b/.test(low)) {
      answer = first(/cropindia ai/);
    } else if (/\b(team|company|companies|business)\b/.test(low)) {
      const names = Object.keys(this.config.companies || {}).map((id) => id === 'healthgis' ? 'HealthGIS' : id === 'astropulse' ? 'Astropulse SMM' : id === 'nexora' ? 'Nexora AI' : id);
      answer = names.length ? `The portfolio includes ${names.join(', ')}. Ask me about any one of them for more details.` : 'Please explore the company offices to learn more.';
    } else if (/\b(who|name|about|yourself)\b/.test(low)) {
      answer = `My name is ${this.config.name || 'Murari Kumar'}.`;
    } else if (/\b(what can you|how can you|help)\b/.test(low)) {
      answer = 'I can answer questions about my projects, skills, studies, company and contact details.';
    } else {
      answer = 'I do not have enough information in my saved profile to answer that accurately. Try asking about my projects, skills, studies or contact details.';
    }
    answer = (answer || lines[0] || 'Please contact me by email and I will reply.').replace(/^(name|contact|featured project):\s*/i, '');
    const note = {
      nokey: ' (Using saved profile information; live AI is not configured.)',
      badkey: ' (The AI service rejected its key; using saved profile information.)',
      busy: ' (The AI service is busy; using saved profile information.)',
      nomodel: ' (No AI model is available; using saved profile information.)',
      error: ' (The AI service is unavailable; using saved profile information.)',
    }[why] || '';
    return answer + note;
  }
}
