/* AI 연결 (Google Gemini API, 사용자가 직접 입력한 API 키 사용)
   API 키는 코드에 넣지 않는다. 다른 AI 서비스로 바꾸려면 이 파일의 call()만 고치면 된다. */
'use strict';

const AI_MODELS = [
  { id: 'gemini-3.8-flash', label: 'gemini-3.8-flash (최신·추천)' },
  { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash (한도가 부족할 때)' },
  { id: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite (가장 가벼움)' }
];

class AIError extends Error {
  constructor(message, kind) { super(message); this.kind = kind; }
}

const AI = {
  timeoutMs: 40000,

  async call({ key, model, system, contents, json }) {
    if (!key) throw new AIError('API 키가 없어요. ⚙설정에서 API 키를 입력해 주세요.', 'nokey');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: Object.assign({ temperature: json ? 0.2 : 0.8 }, json ? { responseMimeType: 'application/json' } : {}),
      // 자해 사례 연습이 막히지 않도록 차단 기준을 '매우 위험'으로만 둔다
      safetySettings: ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT']
        .map(category => ({ category, threshold: 'BLOCK_ONLY_HIGH' }))
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
    } catch (e) {
      throw new AIError(e.name === 'AbortError'
        ? 'AI 응답이 너무 늦어요. 잠시 후 다시 시도해 주세요.'
        : '인터넷에 연결되어 있지 않거나 AI 서버에 닿지 못했어요. 연결을 확인해 주세요.', 'network');
    } finally { clearTimeout(timer); }

    let data = null;
    try { data = await res.json(); } catch (e) { /* 본문 없음 */ }
    if (!res.ok) throw this.httpError(res.status, data);

    const cand = data && data.candidates && data.candidates[0];
    const text = cand && cand.content && cand.content.parts ? cand.content.parts.map(p => p.text || '').join('') : '';
    if (!text) {
      const blocked = (data && data.promptFeedback && data.promptFeedback.blockReason) || (cand && cand.finishReason === 'SAFETY');
      throw new AIError(blocked
        ? 'AI가 안전 기준 때문에 대답하지 않았어요. 다른 표현으로 다시 말해 보세요.'
        : 'AI에게서 빈 대답이 왔어요. 다시 시도해 주세요.', 'empty');
    }
    return text.trim();
  },

  httpError(status, data) {
    const detail = data && data.error ? (data.error.message || '') : '';
    if (status === 400 && /API key/i.test(detail)) return new AIError('API 키가 올바르지 않아요. ⚙설정에서 키를 다시 확인해 주세요.', 'key');
    if (status === 400) return new AIError('AI 요청 형식에 문제가 있어요. 모델 이름을 확인해 주세요.', 'request');
    if (status === 401 || status === 403) return new AIError('이 API 키로는 사용할 수 없어요. 키가 삭제되었거나 권한이 없는지 확인해 주세요.', 'key');
    if (status === 404) return new AIError('설정한 AI 모델을 찾지 못했어요. ⚙설정에서 다른 모델을 골라 주세요.', 'model');
    if (status === 429) return new AIError('무료 사용량(또는 1분당 사용 횟수)을 넘었어요. 잠시 후 다시 하거나, 대본 모드로 연습해 주세요.', 'quota');
    if (status >= 500) return new AIError('AI 서버에 일시적인 문제가 있어요. 잠시 후 다시 시도해 주세요.', 'server');
    return new AIError(`AI 연결 중 문제가 생겼어요(코드 ${status}).`, 'other');
  },

  /* 통화 기록 → AI 대화 형식. 같은 사람이 연달아 말한 것은 합친다. */
  toContents(transcript) {
    const out = [];
    transcript.filter(t => t.who === 'me' || t.who === 'parent').forEach(t => {
      const role = t.who === 'me' ? 'user' : 'model';
      const last = out[out.length - 1];
      if (last && last.role === role) last.parts[0].text += '\n' + t.text;
      else out.push({ role, parts: [{ text: t.text }] });
    });
    return out;
  },

  /* 보호자의 다음 말 */
  async parentReply(caseObj, transcript, settings, key) {
    const text = await this.call({
      key, model: settings.model,
      system: buildPersonaPrompt(caseObj),
      contents: this.toContents(transcript)
    });
    const ended = /\[통화\s*종료\]/.test(text);
    return { text: text.replace(/\[통화\s*종료\]/g, '').trim(), ended };
  },

  /* 통화 채점 */
  async evaluate(caseObj, transcript, settings, key) {
    const text = await this.call({
      key, model: settings.model, json: true,
      system: '너는 전화상담 교육용 채점 도우미다. 요청한 JSON만 출력한다.',
      contents: [{ role: 'user', parts: [{ text: buildEvalPrompt(caseObj, transcript) }] }]
    });
    return this.normalizeEval(this.parseJson(text), caseObj);
  },

  parseJson(text) {
    try { return JSON.parse(text); } catch (e) { /* 아래에서 다시 시도 */ }
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (e) { /* 실패 */ } }
    throw new AIError('AI 채점 결과를 읽지 못했어요. [다시 채점]을 눌러 주세요.', 'parse');
  },

  /* AI가 기준에 없는 점수를 주면 가장 가까운 기준 점수로 맞춘다 */
  normalizeEval(raw, caseObj) {
    const snap = (v, levels) => {
      const n = Number(v);
      if (!isFinite(n)) return null;
      return levels.reduce((best, l) => (Math.abs(l - n) < Math.abs(best - n) ? l : best), levels[0]);
    };
    const items = {};
    RUBRIC.filter(r => r.key !== 'speed' && r.key !== 'hangup').forEach(r => {
      const src = (raw.items && raw.items[r.key]) || {};
      const score = snap(src.score, Object.keys(r.levels).map(Number));
      if (score === null) throw new AIError('AI 채점 결과에 빠진 항목이 있어요. [다시 채점]을 눌러 주세요.', 'parse');
      items[r.key] = { score, reason: String(src.reason || ''), quote: String(src.quote || ''), better: String(src.better || '') };
    });
    const intake = {};
    INTAKE_CHECKS.forEach(r => { intake[r.key] = snap(raw.intake && raw.intake[r.key], [0, 1, 2]) || 0; });
    let checklist = null;
    const p = PERSONAS[caseObj.id];
    if (p.checklist) {
      checklist = {};
      p.checklist.forEach(c => { checklist[c.key] = !!(raw.checklist && raw.checklist[c.key]); });
    }
    const list = v => (Array.isArray(v) ? v.map(String).slice(0, 3) : []);
    return { items, intake, checklist, good: list(raw.good), improve: list(raw.improve) };
  },

  /* 설정 화면의 연결 확인 */
  async test(key, model) {
    return this.call({ key, model, system: '짧게 대답한다.', contents: [{ role: 'user', parts: [{ text: '연결 확인입니다. "확인"이라고만 답해 주세요.' }] }] });
  }
};
