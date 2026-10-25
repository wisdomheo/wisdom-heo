/* 휴대폰(브라우저) 안에만 저장하는 기능. 외부로 보내지 않는다. */
'use strict';

const STORE_KEYS = {
  settings: 'pcs.settings',
  records: 'pcs.records',
  apiKey: 'pcs.apiKey',
  aiConsent: 'pcs.aiConsent'
};
const DEFAULT_SETTINGS = {
  mode: 'script',              // 'ai' | 'script'
  model: 'gemini-3.8-flash',
  rate: 1.0,                   // 보호자 말하기 속도
  captions: true,              // 보호자 말 자막
  autoSend: false              // 말이 끝나면 확인 없이 바로 보내기
};
const MAX_RECORDS = 100;

const Store = {
  ok: true,
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { this.ok = false; return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { this.ok = false; return false; }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch (e) { this.ok = false; }
  },

  settings() { return Object.assign({}, DEFAULT_SETTINGS, this.get(STORE_KEYS.settings, {})); },
  saveSettings(patch) { return this.set(STORE_KEYS.settings, Object.assign(this.settings(), patch)); },

  apiKey() { return this.get(STORE_KEYS.apiKey, ''); },
  saveApiKey(key) { return this.set(STORE_KEYS.apiKey, key); },
  deleteApiKey() { this.remove(STORE_KEYS.apiKey); },

  aiConsent() { return this.get(STORE_KEYS.aiConsent, false); },
  saveAiConsent(v) { return this.set(STORE_KEYS.aiConsent, v); },

  records() { return this.get(STORE_KEYS.records, []); },
  addRecord(rec) {
    const list = this.records();
    list.unshift(rec);
    return this.set(STORE_KEYS.records, list.slice(0, MAX_RECORDS));
  },
  deleteRecord(id) { this.set(STORE_KEYS.records, this.records().filter(r => r.id !== id)); },
  deleteAllRecords() { this.remove(STORE_KEYS.records); }
};
