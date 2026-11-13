// CSV + question-bank parsing. Shared so the lobby can preview a file before uploading it.
import { MAX_QUESTIONS } from './defs.js';

// RFC-4180-ish parser: quoted fields, escaped quotes (""), commas/newlines inside quotes, CRLF.
export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQ = false, i = 0;
  text = String(text || '').replace(/^﻿/, '');
  // Auto-detect semicolon or tab separated files (common Excel exports)
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const count = (ch) => firstLine.split(ch).length - 1;
  const sep = count(',') >= count(';') && count(',') >= count('\t') ? ',' : count(';') >= count('\t') ? ';' : '\t';
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field.trim() === '') { inQ = true; field = ''; i++; continue; }
    if (c === sep) { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

const HEADER_ALIASES = {
  question: ['question', 'q', 'prompt', 'text'],
  a: ['a', 'option_a', 'optiona', 'option a', 'choice1', 'choice_1', 'answer1', 'option1', 'opt1', 'a)'],
  b: ['b', 'option_b', 'optionb', 'option b', 'choice2', 'choice_2', 'answer2', 'option2', 'opt2', 'b)'],
  c: ['c', 'option_c', 'optionc', 'option c', 'choice3', 'choice_3', 'answer3', 'option3', 'opt3', 'c)'],
  d: ['d', 'option_d', 'optiond', 'option d', 'choice4', 'choice_4', 'answer4', 'option4', 'opt4', 'd)'],
  answer: ['answer', 'correct', 'correct_answer', 'correct answer', 'key', 'solution', 'right'],
  category: ['category', 'topic', 'subject', 'cat'],
  difficulty: ['difficulty', 'level', 'diff'],
};

function headerMap(row) {
  const norm = row.map((h) => h.trim().toLowerCase());
  const map = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const i = norm.findIndex((h) => aliases.includes(h));
    if (i >= 0) map[key] = i;
  }
  return map;
}

function parseDifficulty(v) {
  const s = String(v || '').trim().toLowerCase();
  if (['1', 'easy', 'e', 'low'].includes(s)) return 'easy';
  if (['3', 'hard', 'h', 'high', 'difficult'].includes(s)) return 'hard';
  return 'medium';
}

// Returns { questions, errors, truncated, total }
export function parseQuestionCSV(text, max = MAX_QUESTIONS) {
  const rows = parseCSV(text);
  const errors = [];
  const questions = [];
  if (!rows.length) return { questions, errors: ['The file is empty.'], truncated: false, total: 0 };
  let cols = { question: 0, a: 1, b: 2, c: 3, d: 4, answer: 5, category: 6, difficulty: 7 };
  let start = 0;
  const hm = headerMap(rows[0]);
  if ('question' in hm || ('answer' in hm && 'a' in hm)) {
    cols = { ...hm };
    if (!('question' in cols)) cols.question = 0;
    start = 1;
  }
  let total = 0;
  for (let r = start; r < rows.length; r++) {
    const row = rows[r];
    const line = r + 1;
    const get = (k) => (cols[k] !== undefined && row[cols[k]] !== undefined ? String(row[cols[k]]).trim() : '');
    const q = get('question');
    if (!q) { errors.push(`Line ${line}: missing question text.`); continue; }
    const rawOpts = ['a', 'b', 'c', 'd'].map(get);
    const options = [];
    const map = [];
    rawOpts.forEach((o, i) => { if (o) { options.push(o.slice(0, 140)); map.push(i); } });
    if (options.length < 2) { errors.push(`Line ${line}: needs at least 2 answer options.`); continue; }
    const ansRaw = get('answer');
    let ans = -1;
    const up = ansRaw.toUpperCase();
    if (/^[A-D]$/.test(up)) ans = map.indexOf(up.charCodeAt(0) - 65);
    else if (/^[1-4]$/.test(up)) ans = map.indexOf(Number(up) - 1);
    else if (ansRaw) ans = options.findIndex((o) => o.toLowerCase() === ansRaw.toLowerCase());
    if (ans < 0) { errors.push(`Line ${line}: answer "${ansRaw}" doesn't match an option (use A-D, 1-4 or the option text).`); continue; }
    total++;
    if (questions.length >= max) continue;
    questions.push({
      q: q.slice(0, 400),
      options,
      answer: ans,
      category: (get('category') || 'General').slice(0, 40),
      difficulty: parseDifficulty(get('difficulty')),
    });
  }
  return { questions, errors: errors.slice(0, 25), errorCount: errors.length, truncated: total > max, total };
}

export const CSV_TEMPLATE_HEADER = 'question,option_a,option_b,option_c,option_d,answer,category,difficulty';

// Validate a question list coming from the in-browser editor (same rules as CSV rows).
export function validateQuestions(list, max = MAX_QUESTIONS) {
  const questions = [], errors = [];
  if (!Array.isArray(list)) return { questions, errors: ['Not a question list.'] };
  list.slice(0, max).forEach((q, i) => {
    const n = i + 1;
    const text = String((q && q.q) || '').trim().slice(0, 400);
    if (!text) { errors.push(`Question ${n}: missing text.`); return; }
    const opts = (Array.isArray(q.options) ? q.options : []).map((o) => String(o ?? '').trim().slice(0, 140));
    const keep = [], map = [];
    opts.slice(0, 4).forEach((o, k) => { if (o) { keep.push(o); map.push(k); } });
    if (keep.length < 2) { errors.push(`Question ${n}: needs at least 2 options.`); return; }
    const ans = map.indexOf(Number(q.answer));
    if (ans < 0) { errors.push(`Question ${n}: pick which option is correct.`); return; }
    const d = String(q.difficulty || 'medium').toLowerCase();
    questions.push({ q: text, options: keep, answer: ans, category: String(q.category || 'General').trim().slice(0, 40) || 'General', difficulty: ['easy', 'medium', 'hard'].includes(d) ? d : 'medium' });
  });
  if (list.length > max) errors.push(`Only the first ${max} questions are kept.`);
  return { questions, errors };
}

export function questionsToCSV(questions) {
  const esc = (s) => (/[",\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
  const lines = [CSV_TEMPLATE_HEADER];
  for (const q of questions) {
    const o = [0, 1, 2, 3].map((i) => q.options[i] || '');
    lines.push([q.q, ...o, 'ABCD'[q.answer], q.category, q.difficulty].map(esc).join(','));
  }
  return lines.join('\n') + '\n';
}
