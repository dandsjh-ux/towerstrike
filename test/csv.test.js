import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, parseQuestionCSV } from '../shared/csv.js';
import { DEFAULT_QUESTIONS, toCSV, QuestionDeck } from '../server/questions.js';
import fs from 'node:fs';

test('parseCSV handles quotes, embedded commas, newlines and escaped quotes', () => {
  const rows = parseCSV('a,"b, c","line1\nline2","say ""hi"""\r\n1,2,3,4\n');
  assert.deepEqual(rows, [['a', 'b, c', 'line1\nline2', 'say "hi"'], ['1', '2', '3', '4']]);
});

test('parseCSV detects semicolon-separated exports and strips BOM', () => {
  const rows = parseCSV('﻿q;a;b\n1;2;3');
  assert.deepEqual(rows, [['q', 'a', 'b'], ['1', '2', '3']]);
});

test('question CSV: header, letter/number/text answers, optional C/D, difficulty', () => {
  const csv = [
    'question,option_a,option_b,option_c,option_d,answer,category,difficulty',
    'What is 2+2?,3,4,5,6,B,Maths,easy',
    'Capital of France?,Paris,Rome,,,1,Geo,3',
    'True or false: the sky is blue?,True,False,,,true,Science,',
    '"Comma, in question?",x,y,z,w,"z",Misc,hard',
  ].join('\n');
  const r = parseQuestionCSV(csv);
  assert.equal(r.questions.length, 4);
  assert.equal(r.errors.length, 0);
  assert.equal(r.questions[0].answer, 1);
  assert.deepEqual(r.questions[1].options, ['Paris', 'Rome']);
  assert.equal(r.questions[1].answer, 0);
  assert.equal(r.questions[1].difficulty, 'hard');
  assert.equal(r.questions[2].answer, 0);
  assert.equal(r.questions[2].difficulty, 'medium');
  assert.equal(r.questions[3].q, 'Comma, in question?');
  assert.equal(r.questions[3].answer, 2);
});

test('question CSV without a header uses positional columns', () => {
  const r = parseQuestionCSV('Q1?,a,b,c,d,D\nQ2?,yes,no,,,A');
  assert.equal(r.questions.length, 2);
  assert.equal(r.questions[0].answer, 3);
  assert.equal(r.questions[0].category, 'General');
});

test('question CSV reports bad rows but keeps good ones', () => {
  const r = parseQuestionCSV('question,a,b,c,d,answer\nGood?,1,2,,,A\n,1,2,,,A\nOne option?,1,,,,A\nBad answer?,1,2,,,E\nNo answer?,1,2,,,');
  assert.equal(r.questions.length, 1);
  assert.equal(r.errorCount, 4);
});

test('question CSV is capped at 100 questions', () => {
  const lines = ['question,a,b,answer'];
  for (let i = 0; i < 130; i++) lines.push(`Q${i}?,x,y,A`);
  const r = parseQuestionCSV(lines.join('\n'));
  assert.equal(r.questions.length, 100);
  assert.equal(r.truncated, true);
  assert.equal(r.total, 130);
});

test('built-in bank round-trips through the downloadable template', () => {
  const csv = toCSV(DEFAULT_QUESTIONS);
  const r = parseQuestionCSV(csv);
  assert.equal(r.questions.length, DEFAULT_QUESTIONS.length);
  assert.equal(r.errors.length, 0);
  const sample = fs.readFileSync(new URL('../public/sample-questions.csv', import.meta.url), 'utf8');
  assert.equal(parseQuestionCSV(sample).questions.length, DEFAULT_QUESTIONS.length);
  for (const q of DEFAULT_QUESTIONS) assert.ok(q.answer >= 0 && q.answer < q.options.length, q.q);
});

test('deck deals every question once before repeating and keeps answers aligned when shuffling', () => {
  let s = 1; const rng = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const deck = new QuestionDeck(DEFAULT_QUESTIONS, rng, true);
  const seen = new Set();
  for (let i = 0; i < DEFAULT_QUESTIONS.length; i++) {
    const q = deck.next();
    seen.add(q.srcId);
    const src = DEFAULT_QUESTIONS[q.srcId];
    assert.equal(q.options[q.answer], src.options[src.answer]);
  }
  assert.equal(seen.size, DEFAULT_QUESTIONS.length);
});
