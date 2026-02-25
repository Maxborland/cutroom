import { Router, Request, Response } from 'express';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import {
  getProject,
  withProject,
  resolveProjectPath,
  ensureDir,
  type Project,
  type ShotMeta,
} from '../../lib/storage.js';
import { chatCompletion } from '../../lib/openrouter.js';
import { getBestImageFile, getMimeType } from '../../lib/media-utils.js';
import { prepareBriefReference } from '../../lib/reference-media.js';
import { resolveSettings, clampShotDuration, MAX_SHOT_DURATION_SEC } from './shared.js';
import { generateShotImageForProject } from './image.js';
import { getErrorMessage, sendApiError } from '../../lib/api-error.js';

const router = Router({ mergeParams: true });
const DIRECTOR_REVIEW_BATCH_SIZE = 5;
const DIRECTOR_REVIEW_DETAIL_CONCURRENCY = 2;
const DIRECTOR_REVIEW_MAX_EDGE_PX = 1080;
const DIRECTOR_REVIEW_JPEG_QUALITY = 82;
const DIRECTOR_REVIEW_OVERVIEW_MAX_TOKENS = 300;
const DIRECTOR_REVIEW_DETAIL_MAX_TOKENS = 220;
const DIRECTOR_REVIEW_OVERVIEW_TIMEOUT_MS = 90_000;
const DIRECTOR_REVIEW_DETAIL_TIMEOUT_MS = 75_000;

type VisionContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

// в”Ђв”Ђ Types в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

interface DirectorNote {
  id: string;
  target: string;
  verdict: 'approve' | 'revise' | 'reject';
  comment: string;
  suggestion?: string;
  type?: 'issue' | 'success';
  resolvedAt?: string;
  resolvedByAction?: string;
}

interface DirectorReview {
  id: string;
  stage: 'script' | 'shots' | 'images';
  createdAt: string;
  model: string;
  overallVerdict: 'approve' | 'revise' | 'reject';
  summary: string;
  notes: DirectorNote[];
  shotVerdicts?: Record<string, 'approve' | 'revise' | 'reject'>;
  resolvedAt?: string;
  resolvedByAction?: string;
}

interface DirectorState {
  reviews: DirectorReview[];
  latestByStage: Record<string, string>;
}

function markReviewHandledForStage(
  project: Project,
  stage: 'script' | 'shots' | 'images',
  reviewId?: string,
  action?: string,
): void {
  const state: DirectorState = (project as any).directorState || { reviews: [], latestByStage: {} };
  const latestId = state.latestByStage?.[stage];
  if (!latestId) return;
  if (reviewId && latestId !== reviewId) return;

  delete state.latestByStage[stage];

  if (reviewId) {
    const review = state.reviews.find((r) => r.id === reviewId) as any;
    if (review) {
      review.resolvedAt = new Date().toISOString();
      review.resolvedByAction = action || 'apply-feedback';
    }
  }

  (project as any).directorState = state;
}

// в”Ђв”Ђ Helpers в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

function parseDirectorJson(raw: string): any {
  let jsonStr = raw.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '');
    jsonStr = jsonStr.replace(/\n?```\s*$/, '');
  }
  if (!jsonStr.startsWith('{') && !jsonStr.startsWith('[')) {
    const match = jsonStr.match(/\{[\s\S]*\}/);
    if (match) jsonStr = match[0];
  }
  return JSON.parse(jsonStr);
}

function stripCodeFence(raw: string): string {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json|text|markdown)?\s*\n?/, '');
    text = text.replace(/\n?```\s*$/, '');
  }
  return text.trim();
}

const DEFAULT_DETAIL_COMMENT = '\u0422\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044f \u0434\u043e\u0440\u0430\u0431\u043e\u0442\u043a\u0430 \u043f\u043e \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442\u0430\u043c \u0440\u0435\u0432\u044c\u044e.';

function sanitizeDetailText(raw?: string): string {
  if (!raw) return '';
  return raw
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/^[*\-]+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function isMeaningfulDetailText(raw?: string): boolean {
  const text = sanitizeDetailText(raw);
  if (!text) return false;

  const lower = text.toLowerCase();
  if ([
    'comment',
    'suggestion',
    'verdict',
    'none',
    'null',
    'n/a',
    'na',
    '-',
    '|',
  ].includes(lower)) {
    return false;
  }

  const alphaNumCount = (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
  if (alphaNumCount < 8) return false;
  if (text.split(/\s+/).length < 2 && text.length < 12) return false;
  return true;
}

function extractLabeledValue(lines: string[], label: RegExp): string | undefined {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!label.test(line)) continue;

    const tail = sanitizeDetailText(line.replace(label, '').replace(/^[:\-\u2013\u2014]\s*/, ''));
    if (tail) return tail;

    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j].trim();
      if (!next) continue;
      if (/^(?:verdict|comment|suggestion)\b/i.test(next)) break;
      return sanitizeDetailText(next);
    }
  }
  return undefined;
}

function parseDetailReviewResponse(raw: string): {
  verdict: 'approve' | 'revise' | 'reject';
  comment: string;
  suggestion?: string;
} {
  const cleaned = stripCodeFence(raw);
  const lines = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  // 1) Happy path: valid JSON.
  try {
    const parsed = parseDirectorJson(cleaned);
    const verdict = normalizeVerdict(parsed?.verdict);
    const comment = sanitizeDetailText(typeof parsed?.comment === 'string' ? parsed.comment : '');
    const suggestion = sanitizeDetailText(typeof parsed?.suggestion === 'string' ? parsed.suggestion : '');
    if (isMeaningfulDetailText(comment)) {
      return {
        verdict,
        comment,
        suggestion: isMeaningfulDetailText(suggestion) && !/^none$/i.test(suggestion) ? suggestion : undefined,
      };
    }
  } catch {
    // continue to resilient parsers
  }

  // 2) Tolerate pseudo-JSON with unquoted keys / trailing commas / smart quotes.
  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    const candidate = objectMatch[0]
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/([\{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3')
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/'/g, '"');
    try {
      const parsed = JSON.parse(candidate);
      const verdict = normalizeVerdict(parsed?.verdict);
      const comment = sanitizeDetailText(typeof parsed?.comment === 'string' ? parsed.comment : '');
      const suggestion = sanitizeDetailText(typeof parsed?.suggestion === 'string' ? parsed.suggestion : '');
      if (isMeaningfulDetailText(comment)) {
        return {
          verdict,
          comment,
          suggestion: isMeaningfulDetailText(suggestion) && !/^none$/i.test(suggestion) ? suggestion : undefined,
        };
      }
    } catch {
      // continue to text extraction
    }
  }

  // 3) Regex salvage from broken JSON.
  const verdictKv = cleaned.match(/["']?verdict["']?\s*:\s*["']?(approve|revise|reject)/i);
  const commentKv = cleaned.match(/["']?comment["']?\s*:\s*["']?([^\n\r"}]{1,300})/i);
  const suggestionKv = cleaned.match(/["']?suggestion["']?\s*:\s*["']?([^\n\r"}]{1,300})/i);

  // 4) Plain text / label fallback.
  const verdictLabel = extractLabeledValue(lines, /^verdict\b/i);
  const commentLabel = extractLabeledValue(lines, /^comment\b/i);
  const suggestionLabel = extractLabeledValue(lines, /^suggestion\b/i);

  const genericVerdictMatch = cleaned.match(/\b(approve|revise|reject)\b/i);
  const verdict = normalizeVerdict(
    verdictKv?.[1]
    || verdictLabel
    || genericVerdictMatch?.[1]
    || 'revise',
  );

  const firstMeaningfulLine = lines.find((line) => {
    if (/^(?:verdict|comment|suggestion)\b/i.test(line)) return false;
    if (line.split('').every((ch) => ch === '[' || ch === ']' || ch === '{' || ch === '}')) return false;
    return isMeaningfulDetailText(line);
  });

  const commentCandidate = sanitizeDetailText(
    commentKv?.[1]
    || commentLabel
    || firstMeaningfulLine
    || '',
  );
  const comment = isMeaningfulDetailText(commentCandidate) ? commentCandidate : DEFAULT_DETAIL_COMMENT;

  const suggestionCandidate = sanitizeDetailText(
    suggestionKv?.[1]
    || suggestionLabel
    || '',
  );
  const suggestion = isMeaningfulDetailText(suggestionCandidate) && !/^none$/i.test(suggestionCandidate)
    ? suggestionCandidate
    : undefined;

  return { verdict, comment, suggestion };
}
function normalizeVerdict(v: unknown): 'approve' | 'revise' | 'reject' {
  if (v === 'approve' || v === 'revise' || v === 'reject') return v;
  return 'revise';
}

function toNoteType(verdict: 'approve' | 'revise' | 'reject'): 'issue' | 'success' {
  return verdict === 'approve' ? 'success' : 'issue';
}

async function readImageAsBase64(projectId: string, shotId: string, filename: string): Promise<{ base64: string; mime: string }> {
  const filePath = resolveProjectPath(projectId, 'shots', shotId, 'generated', filename);
  const buffer = await fs.readFile(filePath);
  try {
    const image = sharp(buffer, { failOn: 'none' });
    const metadata = await image.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    if (width > 0 && height > 0) {
      const resizedBuffer = await image
        .resize({
          width: DIRECTOR_REVIEW_MAX_EDGE_PX,
          height: DIRECTOR_REVIEW_MAX_EDGE_PX,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({
          quality: DIRECTOR_REVIEW_JPEG_QUALITY,
          mozjpeg: true,
        })
        .toBuffer();

      return {
        base64: resizedBuffer.toString('base64'),
        mime: 'image/jpeg',
      };
    }
  } catch (err) {
    console.warn(`[director] review image preprocess failed for ${shotId}/${filename}, using original image`, err);
  }

  return { base64: buffer.toString('base64'), mime: getMimeType(filename) };
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (!Number.isFinite(chunkSize) || chunkSize < 1) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const safeConcurrency = Math.max(1, Math.floor(concurrency));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runners = Array.from({ length: Math.min(safeConcurrency, items.length) }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) break;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(runners);
  return results;
}

async function saveReview(projectId: string, review: DirectorReview): Promise<void> {
  await withProject(projectId, (p) => {
    const state: DirectorState = (p as any).directorState || { reviews: [], latestByStage: {} };
    state.reviews.push(review);
    state.latestByStage[review.stage] = review.id;
    (p as any).directorState = state;
  });
}

function buildImageFeedbackForShot(review: DirectorReview | undefined, shotId: string): string {
  if (!review) return '';

  const relevant = review.notes.filter((note) => {
    if (note.verdict === 'approve') return false;
    if (note.target === shotId) return true;
    return note.target === 'images' || note.target === 'style' || note.target === 'consistency';
  });

  if (relevant.length === 0) return '';

  return relevant
    .map((note) => `- ${note.comment}${note.suggestion ? ` -> ${note.suggestion}` : ''}`)
    .join('\n');
}

function markImageFeedbackHandled(
  project: Project,
  reviewId: string | undefined,
  shotIds: string[],
  action: string,
): void {
  const state: DirectorState = (project as any).directorState || { reviews: [], latestByStage: {} };
  const targetId = reviewId || state.latestByStage?.images;
  if (!targetId) return;

  const review = state.reviews.find((r) => r.id === targetId);
  if (!review || review.stage !== 'images') return;

  const handled = new Set(shotIds);
  if (handled.size === 0) return;

  const now = new Date().toISOString();

  review.notes = review.notes.map((note) => {
    if (note.verdict === 'approve') return note;
    if (!handled.has(note.target)) return note;
    return {
      ...note,
      resolvedAt: now,
      resolvedByAction: action,
    };
  });

  if (review.shotVerdicts && typeof review.shotVerdicts === 'object') {
    for (const id of handled) {
      if (review.shotVerdicts[id]) {
        review.shotVerdicts[id] = 'approve';
      }
    }
  }

  const hasOpenIssues = review.notes.some((note) => note.verdict !== 'approve' && !note.resolvedAt);
  if (!hasOpenIssues) {
    review.resolvedAt = now;
    review.resolvedByAction = action;
    delete state.latestByStage.images;
  }

  (project as any).directorState = state;
}

async function readBriefReferenceForDirector(
  projectId: string,
  filename: string,
): Promise<{ filename: string; imageDataUrl?: string; svgText?: string } | null> {
  const prepared = await prepareBriefReference(projectId, filename, {
    maxReferenceBytes: 1_500_000,
    includeSvgDataUrl: false,
    includeSvgText: true,
    maxSvgTextChars: 1_500,
  });

  if (!prepared.imageDataUrl && !prepared.svgText) {
    return null;
  }

  return {
    filename,
    imageDataUrl: prepared.imageDataUrl,
    svgText: prepared.svgText,
  };
}

// в”Ђв”Ђ Core review functions в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

async function doReviewScript(project: Project): Promise<DirectorReview> {
  const effective = await resolveSettings(project);
  const model = effective.directorModel;

  const systemPrompt = [
    effective.directorPrompt,
    '',
    'РўС‹ СЂРµРІСЊСЋРёС€СЊ РЎР¦Р•РќРђР РР™ СЂРµРєР»Р°РјРЅРѕРіРѕ СЂРѕР»РёРєР° РґР»СЏ Р¶РёР»РѕРіРѕ РєРѕРјРїР»РµРєСЃР°.',
    'РћС†РµРЅРё РїРѕ РєСЂРёС‚РµСЂРёСЏРј:',
    '1. РќР°СЂСЂР°С‚РёРІ Рё СЃС‚РѕСЂРёС‚РµР»Р»РёРЅРі вЂ” РµСЃС‚СЊ Р»Рё СЌРјРѕС†РёРѕРЅР°Р»СЊРЅР°СЏ РґСѓРіР°?',
    '2. РџРµР№СЃРёРЅРі вЂ” СЂРёС‚Рј РїРѕРІРµСЃС‚РІРѕРІР°РЅРёСЏ, РЅРµ Р·Р°С‚СЏРЅСѓС‚Рѕ Р»Рё?',
    '3. РџРѕРєСЂС‹С‚РёРµ РєР»СЋС‡РµРІС‹С… С‚РѕС‡РµРє Р±СЂРёС„Р° вЂ” РІСЃРµ Р»Рё СѓРїРѕРјСЏРЅСѓС‚Рѕ?',
    '4. РўР°Р№РјРёРЅРі вЂ” СЃРѕРѕС‚РІРµС‚СЃС‚РІСѓРµС‚ Р»Рё С†РµР»РµРІРѕР№ РґР»РёС‚РµР»СЊРЅРѕСЃС‚Рё?',
    '5. Р’РёР·СѓР°Р»СЊРЅС‹Рµ РѕРїРёСЃР°РЅРёСЏ вЂ” РґРѕСЃС‚Р°С‚РѕС‡РЅРѕ Р»Рё РєРѕРЅРєСЂРµС‚РЅС‹ РґР»СЏ РІРёРґРµРѕРіРµРЅРµСЂР°С†РёРё?',
    '',
    'Р’РµСЂРЅРё JSON:',
    '{',
    '  "overallVerdict": "approve" | "revise" | "reject",',
    '  "summary": "2-3 РїСЂРµРґР»РѕР¶РµРЅРёСЏ РѕР±С‰РµР№ РѕС†РµРЅРєРё",',
    '  "notes": [',
    '    {',
    '      "target": "script",',
    '      "verdict": "approve" | "revise" | "reject",',
    '      "comment": "РєРѕРЅРєСЂРµС‚РЅРѕРµ Р·Р°РјРµС‡Р°РЅРёРµ",',
    '      "suggestion": "РєРѕРЅРєСЂРµС‚РЅРѕРµ РїСЂРµРґР»РѕР¶РµРЅРёРµ РїРѕ РёСЃРїСЂР°РІР»РµРЅРёСЋ (РѕРїС†РёРѕРЅР°Р»СЊРЅРѕ)"',
    '    }',
    '  ]',
    '}',
    '',
    'Р’РµСЂРЅРё РўРћР›Р¬РљРћ JSON. РќРёРєР°РєРѕРіРѕ РґСЂСѓРіРѕРіРѕ С‚РµРєСЃС‚Р°.',
  ].join('\n');

  const briefContext = project.brief.text
    ? `Р‘СЂРёС„:\n${project.brief.text}\nР¦РµР»РµРІР°СЏ РґР»РёС‚РµР»СЊРЅРѕСЃС‚СЊ: ${project.brief.targetDuration}СЃ\n\n`
    : '';
  const userMessage = `${briefContext}РЎС†РµРЅР°СЂРёР№:\n${project.script}`;

  console.log(`[director] review-script model=${model}`);
  const raw = await chatCompletion(model, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ], 0.4);

  const parsed = parseDirectorJson(raw);

  return {
    id: uuidv4(),
    stage: 'script',
    createdAt: new Date().toISOString(),
    model,
    overallVerdict: normalizeVerdict(parsed.overallVerdict),
    summary: parsed.summary || '',
    notes: (Array.isArray(parsed.notes) ? parsed.notes : []).map((n: any) => {
      const verdict = normalizeVerdict(n.verdict);
      return {
        id: uuidv4(),
        target: n.target || 'script',
        verdict,
        comment: n.comment || '',
        suggestion: n.suggestion || undefined,
        type: toNoteType(verdict),
      };
    }),
  };
}

async function doReviewShots(project: Project): Promise<DirectorReview> {
  const effective = await resolveSettings(project);
  const model = effective.directorModel;

  const totalDuration = project.shots.reduce((sum, s) => sum + s.duration, 0);
  const shotsDescription = project.shots.map((s, i) => [
    `РЁРѕС‚ #${String(i + 1).padStart(2, '0')} (id: ${s.id})`,
    `  scene: ${s.scene}`,
    `  duration: ${s.duration}СЃ`,
    `  assetRefs: ${s.assetRefs.length > 0 ? s.assetRefs.join(', ') : 'РЅРµС‚'}`,
    `  imagePrompt: ${s.imagePrompt.slice(0, 200)}...`,
  ].join('\n')).join('\n\n');

  const systemPrompt = [
    effective.directorPrompt,
    '',
    'РўС‹ СЂРµРІСЊСЋРёС€СЊ РЎРўР РЈРљРўРЈР РЈ РЁРћРўРћР’ (РЅР°СЂРµР·РєСѓ) СЂРµРєР»Р°РјРЅРѕРіРѕ СЂРѕР»РёРєР°.',
    'РћС†РµРЅРё РїРѕ РєСЂРёС‚РµСЂРёСЏРј:',
    '1. РџРѕР»РЅРѕС‚Р° РїРѕРєСЂС‹С‚РёСЏ СЃС†РµРЅР°СЂРёСЏ вЂ” РІСЃРµ Р»Рё РєР»СЋС‡РµРІС‹Рµ РјРѕРјРµРЅС‚С‹ РѕС‚СЂР°Р¶РµРЅС‹?',
    '2. Р›РѕРіРёРєР° РїРµСЂРµС…РѕРґРѕРІ вЂ” РїР»Р°РІРЅРѕ Р»Рё РїРµСЂРµС‚РµРєР°СЋС‚ СЃС†РµРЅС‹ РґСЂСѓРі РІ РґСЂСѓРіР°?',
    '3. Р‘Р°Р»Р°РЅСЃ РїРµР№СЃРёРЅРіР° вЂ” РЅРµС‚ Р»Рё СЃР»РёС€РєРѕРј РґР»РёРЅРЅС‹С… РёР»Рё РєРѕСЂРѕС‚РєРёС… С€РѕС‚РѕРІ?',
    '4. РљРѕСЂСЂРµРєС‚РЅРѕСЃС‚СЊ assetRefs вЂ” РїСЂРёРІСЏР·Р°РЅС‹ Р»Рё РїСЂР°РІРёР»СЊРЅС‹Рµ СЂР°РєСѓСЂСЃС‹?',
    `5. РЎСѓРјРјР°СЂРЅР°СЏ РґР»РёС‚РµР»СЊРЅРѕСЃС‚СЊ (${totalDuration}СЃ) vs С†РµР»РµРІР°СЏ (${project.brief.targetDuration}СЃ)`,
    '',
    'Р’РµСЂРЅРё JSON:',
    '{',
    '  "overallVerdict": "approve" | "revise" | "reject",',
    '  "summary": "2-3 РїСЂРµРґР»РѕР¶РµРЅРёСЏ РѕР±С‰РµР№ РѕС†РµРЅРєРё",',
    '  "notes": [',
    '    {',
    '      "target": "shot-001" РёР»Рё "structure",',
    '      "verdict": "approve" | "revise" | "reject",',
    '      "comment": "РєРѕРЅРєСЂРµС‚РЅРѕРµ Р·Р°РјРµС‡Р°РЅРёРµ",',
    '      "suggestion": "РїСЂРµРґР»РѕР¶РµРЅРёРµ РїРѕ РёСЃРїСЂР°РІР»РµРЅРёСЋ"',
    '    }',
    '  ]',
    '}',
    '',
    'Р’РµСЂРЅРё РўРћР›Р¬РљРћ JSON.',
  ].join('\n');

  const userMessage = [
    project.brief.text ? `Р‘СЂРёС„:\n${project.brief.text}\n` : '',
    `Р¦РµР»РµРІР°СЏ РґР»РёС‚РµР»СЊРЅРѕСЃС‚СЊ: ${project.brief.targetDuration}СЃ`,
    `РЎСѓРјРјР°СЂРЅР°СЏ РґР»РёС‚РµР»СЊРЅРѕСЃС‚СЊ С€РѕС‚РѕРІ: ${totalDuration}СЃ`,
    '',
    project.script ? `РЎС†РµРЅР°СЂРёР№:\n${project.script.slice(0, 2000)}\n` : '',
    'РЁРѕС‚С‹:',
    shotsDescription,
  ].join('\n');

  console.log(`[director] review-shots model=${model}, shots=${project.shots.length}`);
  const raw = await chatCompletion(model, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ], 0.4);

  const parsed = parseDirectorJson(raw);

  return {
    id: uuidv4(),
    stage: 'shots',
    createdAt: new Date().toISOString(),
    model,
    overallVerdict: normalizeVerdict(parsed.overallVerdict),
    summary: parsed.summary || '',
    notes: (Array.isArray(parsed.notes) ? parsed.notes : []).map((n: any) => {
      const verdict = normalizeVerdict(n.verdict);
      return {
        id: uuidv4(),
        target: n.target || 'structure',
        verdict,
        comment: n.comment || '',
        suggestion: n.suggestion || undefined,
        type: toNoteType(verdict),
      };
    }),
  };
}

async function doReviewImages(project: Project): Promise<DirectorReview> {
  const effective = await resolveSettings(project);
  const model = effective.directorModel;

  const shotsWithImages = project.shots.filter((s) => getBestImageFile(s) !== null);
  const allNotes: DirectorNote[] = [];
  const shotVerdicts: Record<string, 'approve' | 'revise' | 'reject'> = {};
  const batchSummaries: string[] = [];

  const batchSystemPrompt = [
    effective.directorPrompt,
    '',
    'You are reviewing one batch of generated images as a sequence.',
    'Focus on style coherence, lighting continuity, and overall production quality.',
    'Do not mark shots as approve if there is obvious reference mismatch.',
    '',
    'Return plain text only: 1-2 short sentences summarizing visual consistency in this batch.',
    'No JSON. No markdown.',
  ].join('\n');

  const detailPrompt = [
    effective.directorPrompt,
    '',
    'You are reviewing one generated image against shot references.',
    'In user input, the first image is GENERATED output; following images (if any) are REFERENCES.',
    '',
    'Compare strictly for reference consistency:',
    '- floor count',
    '- facade rhythm',
    '- window spacing',
    '- balcony layout',
    '- roof silhouette',
    '- camera angle and composition',
    '',
    'Verdict policy:',
    '- reject: major geometry/composition mismatch or wrong building identity.',
    '- revise: partial mismatch or visible quality issues while core identity is still close.',
    '- approve: geometry/composition aligned with references and production-ready quality.',
    '',
    'Return plain text only in exactly 3 lines:',
    'VERDICT: approve | revise | reject',
    'COMMENT: short specific feedback (at least 12 characters)',
    'SUGGESTION: short concrete fix (or "none" if approve)',
    'No JSON. No markdown.',
  ].join('\n');

  const shotBatches = chunkArray(shotsWithImages, DIRECTOR_REVIEW_BATCH_SIZE);
  console.log(`[director] review-images start, ${shotsWithImages.length} shots, ${shotBatches.length} batches`);

  for (let batchIndex = 0; batchIndex < shotBatches.length; batchIndex += 1) {
    const batchShots = shotBatches[batchIndex];
    const batchStart = Date.now();
    const batchLabel = `${batchIndex + 1}/${shotBatches.length}`;

    const preparedBatch = (await Promise.all(batchShots.map(async (shot) => {
      const bestFile = getBestImageFile(shot);
      if (!bestFile) return null;
      try {
        const generated = await readImageAsBase64(project.id, shot.id, bestFile);
        return { shot, generated };
      } catch (err) {
        console.error(`[director] Failed to read image for ${shot.id}:`, err);
        return null;
      }
    }))).filter(Boolean) as Array<{ shot: ShotMeta; generated: { base64: string; mime: string } }>;

    if (preparedBatch.length > 0) {
      console.log(`[director] review-images batch overview ${batchLabel}, ${preparedBatch.length} shots`);
      const batchContent: VisionContentPart[] = [];
      for (const item of preparedBatch) {
        batchContent.push({
          type: 'text',
          text: `--- Shot #${String(item.shot.order + 1).padStart(2, '0')} (${item.shot.id}): ${item.shot.scene} ---`,
        });
        batchContent.push({
          type: 'image_url',
          image_url: { url: `data:${item.generated.mime};base64,${item.generated.base64}` },
        });
      }

      try {
        const batchRaw = await chatCompletion(model, [
          { role: 'system', content: batchSystemPrompt },
          { role: 'user', content: batchContent },
        ], 0.4, {
          maxTokens: DIRECTOR_REVIEW_OVERVIEW_MAX_TOKENS,
          timeoutMs: DIRECTOR_REVIEW_OVERVIEW_TIMEOUT_MS,
        });

        let batchSummary = batchRaw.trim();
        if (batchSummary.startsWith('```')) {
          batchSummary = batchSummary.replace(/^```(?:text|markdown)?\s*\n?/, '');
          batchSummary = batchSummary.replace(/\n?```\s*$/, '');
        }
        if (batchSummary) {
          batchSummaries.push(batchSummary);
        }
      } catch (err) {
        console.warn(`[director] review-images batch overview failed (${batchLabel}):`, err);
      }
    }

    const preparedByShotId = new Map<string, { base64: string; mime: string }>(
      preparedBatch.map((item) => [item.shot.id, item.generated]),
    );

    console.log(`[director] review-images detail ${batchLabel}, ${batchShots.length} shots, concurrency=${DIRECTOR_REVIEW_DETAIL_CONCURRENCY}`);
    const batchResults = await mapWithConcurrency(
      batchShots,
      DIRECTOR_REVIEW_DETAIL_CONCURRENCY,
      async (shot): Promise<{ note: DirectorNote; verdict: 'approve' | 'revise' | 'reject' }> => {
        try {
          const bestFile = getBestImageFile(shot);
          if (!bestFile) {
            throw new Error('No generated image found');
          }

          const generated = preparedByShotId.get(shot.id) ?? await readImageAsBase64(project.id, shot.id, bestFile);
          const references = (await Promise.all(
            (shot.assetRefs || []).map((filename) => readBriefReferenceForDirector(project.id, filename)),
          )).filter(Boolean) as Array<{ filename: string; imageDataUrl?: string; svgText?: string }>;

          const detailContent: VisionContentPart[] = [
            { type: 'text', text: `Generated image for shot ${shot.id}` },
            { type: 'image_url', image_url: { url: `data:${generated.mime};base64,${generated.base64}` } },
          ];

          if (references.length > 0) {
            detailContent.push({ type: 'text', text: 'Reference context for this shot:' });
            for (let i = 0; i < references.length; i += 1) {
              const ref = references[i];
              detailContent.push({
                type: 'text',
                text: `Reference #${i + 1}${ref.filename ? ` (${ref.filename})` : ''}`,
              });

              if (ref.imageDataUrl) {
                detailContent.push({ type: 'image_url', image_url: { url: ref.imageDataUrl } });
              }

              if (ref.svgText) {
                detailContent.push({ type: 'text', text: `SVG vector: ${ref.svgText}` });
              }
            }
          } else {
            detailContent.push({ type: 'text', text: 'No explicit reference images attached to this shot.' });
          }

          detailContent.push({
            type: 'text',
            text: `Shot: ${shot.scene}\nPrompt: ${shot.imagePrompt}`,
          });

          const detailRaw = await chatCompletion(model, [
            { role: 'system', content: detailPrompt },
            {
              role: 'user',
              content: detailContent,
            },
          ], 0.4, {
            maxTokens: DIRECTOR_REVIEW_DETAIL_MAX_TOKENS,
            timeoutMs: DIRECTOR_REVIEW_DETAIL_TIMEOUT_MS,
          });

          const detailParsed = parseDetailReviewResponse(detailRaw);
          const noteVerdict = detailParsed.verdict;

          return {
            verdict: noteVerdict,
            note: {
              id: uuidv4(),
              target: shot.id,
              verdict: noteVerdict,
              comment: detailParsed.comment,
              suggestion: detailParsed.suggestion,
              type: toNoteType(noteVerdict),
            },
          };
        } catch (err) {
          console.error(`[director] Detail review failed for ${shot.id}:`, err);
          return {
            verdict: 'revise',
            note: {
              id: uuidv4(),
              target: shot.id,
              verdict: 'revise',
              comment: `\u041e\u0448\u0438\u0431\u043a\u0430 \u0430\u043d\u0430\u043b\u0438\u0437\u0430: ${String(err)}`,
              type: 'issue',
            },
          };
        }
      },
    );

    for (let i = 0; i < batchShots.length; i += 1) {
      shotVerdicts[batchShots[i].id] = batchResults[i].verdict;
      allNotes.push(batchResults[i].note);
    }

    console.log(`[director] review-images batch ${batchLabel} done in ${Date.now() - batchStart}ms`);
  }

  const verdicts = shotsWithImages.map((shot) => shotVerdicts[shot.id] || 'revise');
  const overallVerdict: 'approve' | 'revise' | 'reject' = verdicts.includes('reject')
    ? 'reject'
    : verdicts.includes('revise')
      ? 'revise'
      : 'approve';

  const approveCount = verdicts.filter((v) => v === 'approve').length;
  const reviseCount = verdicts.filter((v) => v === 'revise').length;
  const rejectCount = verdicts.filter((v) => v === 'reject').length;
  const autoSummary = `\u041f\u0440\u043e\u0430\u043d\u0430\u043b\u0438\u0437\u0438\u0440\u043e\u0432\u0430\u043d\u043e ${shotsWithImages.length} \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0439. ${approveCount} \u043e\u0434\u043e\u0431\u0440\u0435\u043d\u044b, ${reviseCount} \u0442\u0440\u0435\u0431\u0443\u044e\u0442 \u0434\u043e\u0440\u0430\u0431\u043e\u0442\u043a\u0438, ${rejectCount} \u043e\u0442\u043a\u043b\u043e\u043d\u0435\u043d\u044b.`;
  const overallSummary = batchSummaries.length > 0
    ? `${autoSummary} ${batchSummaries.join(' ')}`
    : autoSummary;

  return {
    id: uuidv4(),
    stage: 'images',
    createdAt: new Date().toISOString(),
    model,
    overallVerdict,
    summary: overallSummary,
    notes: allNotes,
    shotVerdicts,
  };
}
// GET /director
router.get('/director', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) { sendApiError(res, 404, 'Project not found'); return; }
    res.json((project as any).directorState || { reviews: [], latestByStage: {} });
  } catch (err) {
    console.error('[director] GET error:', err);
    sendApiError(res, 500, getErrorMessage(err, 'Failed to fetch director state'));
  }
});

// POST /director/review-script
router.post('/director/review-script', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) { sendApiError(res, 404, 'Project not found'); return; }
    if (!project.script?.trim()) { sendApiError(res, 400, 'Script is empty'); return; }
    const review = await doReviewScript(project);
    await saveReview(req.params.id, review);
    res.json(review);
  } catch (err) {
    console.error('[director] review-script error:', err);
    sendApiError(res, 500, getErrorMessage(err, 'Failed to review script'));
  }
});

// POST /director/review-shots
router.post('/director/review-shots', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) { sendApiError(res, 404, 'Project not found'); return; }
    if (!project.shots?.length) { sendApiError(res, 400, 'No shots in project'); return; }
    const review = await doReviewShots(project);
    await saveReview(req.params.id, review);
    res.json(review);
  } catch (err) {
    console.error('[director] review-shots error:', err);
    sendApiError(res, 500, getErrorMessage(err, 'Failed to review shots'));
  }
});

// POST /director/review-images
router.post('/director/review-images', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) { sendApiError(res, 404, 'Project not found'); return; }
    const hasImages = project.shots?.some((s) => getBestImageFile(s) !== null);
    if (!hasImages) { sendApiError(res, 400, 'No shots with images'); return; }
    const review = await doReviewImages(project);
    await saveReview(req.params.id, review);
    res.json(review);
  } catch (err) {
    console.error('[director] review-images error:', err);
    sendApiError(res, 500, getErrorMessage(err, 'Failed to review images'));
  }
});

// POST /director/review-all
router.post('/director/review-all', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) { sendApiError(res, 404, 'Project not found'); return; }

    const results: DirectorReview[] = [];

    if (project.script?.trim()) {
      try {
        const review = await doReviewScript(project);
        await saveReview(req.params.id, review);
        results.push(review);
      } catch (err) { console.error('[director] review-all script failed:', err); }
    }

    if (project.shots?.length > 0) {
      try {
        const review = await doReviewShots(project);
        await saveReview(req.params.id, review);
        results.push(review);
      } catch (err) { console.error('[director] review-all shots failed:', err); }
    }

    const hasImages = project.shots?.some((s) => getBestImageFile(s) !== null);
    if (hasImages) {
      try {
        const review = await doReviewImages(project);
        await saveReview(req.params.id, review);
        results.push(review);
      } catch (err) { console.error('[director] review-all images failed:', err); }
    }

    res.json({ reviews: results });
  } catch (err) {
    console.error('[director] review-all error:', err);
    sendApiError(res, 500, getErrorMessage(err, 'Failed to run director review'));
  }
});

// POST /director/apply-feedback
router.post('/director/apply-feedback', async (req: Request, res: Response) => {
  try {
    const {
      reviewId,
      action,
      shotId,
      shotIds,
    }: {
      reviewId?: string;
      action?: string;
      shotId?: string;
      shotIds?: string[];
    } = req.body || {};
    const project = await getProject(req.params.id);
    if (!project) { sendApiError(res, 404, 'Project not found'); return; }

    const state: DirectorState = (project as any).directorState || { reviews: [], latestByStage: {} };
    const review = state.reviews.find((r) => r.id === reviewId);

    if (action === 'reject-image' && shotId) {
      await withProject(req.params.id, (p) => {
        const shot = p.shots.find((s) => s.id === shotId);
        if (shot) {
          shot.status = 'draft';
          shot.generatedImages = [];
          shot.enhancedImages = [];
          shot.videoFile = null;
        }
        markImageFeedbackHandled(p, reviewId, [shotId], action);
      });
      res.json({ success: true, action: 'reject-image', shotId });
      return;
    }

    if (action === 'regenerate-image') {
      if (!shotId) {
        sendApiError(res, 400, 'shotId is required for regenerate-image');
        return;
      }

      const feedbackPatch = buildImageFeedbackForShot(review, shotId);
      const generated = await generateShotImageForProject({
        projectId: req.params.id,
        shotId,
        promptInjection: feedbackPatch || undefined,
      });

      await withProject(req.params.id, (p) => {
        markImageFeedbackHandled(p, reviewId, [shotId], action);
      });

      res.json({
        success: true,
        action: 'regenerate-image',
        shotId,
        generated,
      });
      return;
    }

    if (action === 'regenerate-images') {
      const rawShotIds = Array.isArray(shotIds)
        ? shotIds
        : Object.entries(review?.shotVerdicts || {})
          .filter(([, verdict]) => verdict === 'revise' || verdict === 'reject')
          .map(([id]) => id);

      const uniqueShotIds = Array.from(new Set(rawShotIds))
        .filter((id) => project.shots.some((s) => s.id === id));

      if (uniqueShotIds.length === 0) {
        sendApiError(res, 400, 'No shotIds to regenerate');
        return;
      }

      const regenerated: Array<{ shotId: string; filename: string; url: string }> = [];
      const failed: Array<{ shotId: string; error: string }> = [];

      for (const id of uniqueShotIds) {
        try {
          const feedbackPatch = buildImageFeedbackForShot(review, id);
          const generated = await generateShotImageForProject({
            projectId: req.params.id,
            shotId: id,
            promptInjection: feedbackPatch || undefined,
          });
          regenerated.push(generated);
        } catch (err) {
          failed.push({ shotId: id, error: String(err) });
        }
      }

      if (regenerated.length > 0) {
        await withProject(req.params.id, (p) => {
          markImageFeedbackHandled(p, reviewId, regenerated.map((item) => item.shotId), action);
        });
      }

      res.json({
        success: failed.length === 0,
        action: 'regenerate-images',
        regenerated,
        failed,
      });
      return;
    }

    if (action === 'regenerate-script') {
      const feedback = review?.notes
        .filter((n) => n.verdict !== 'approve')
        .map((n) => `- ${n.comment}${n.suggestion ? ` в†’ ${n.suggestion}` : ''}`)
        .join('\n') || '';

      const effective = await resolveSettings(project);
      const briefText = project.brief.text || '';
      const durationNote = project.brief.targetDuration
        ? `\nР¦РµР»РµРІР°СЏ РґР»РёС‚РµР»СЊРЅРѕСЃС‚СЊ СЂРѕР»РёРєР°: ${project.brief.targetDuration} СЃРµРєСѓРЅРґ.`
        : '';

      const userMessage = [
        briefText, durationNote, '',
        'РџР Р•Р”Р«Р”РЈР©РР™ РЎР¦Р•РќРђР РР™:', project.script, '',
        'Р—РђРњР•Р§РђРќРРЇ РљР Р•РђРўРР’РќРћР“Рћ Р”РР Р•РљРўРћР Рђ (РћР‘РЇР—РђРўР•Р›Р¬РќРћ РЈР§Р•РЎРўР¬):', feedback, '',
        'РџРµСЂРµРїРёС€Рё СЃС†РµРЅР°СЂРёР№ СЃ СѓС‡С‘С‚РѕРј РІСЃРµС… Р·Р°РјРµС‡Р°РЅРёР№. РЎРѕС…СЂР°РЅРё СѓРґР°С‡РЅС‹Рµ С‡Р°СЃС‚Рё, РёСЃРїСЂР°РІСЊ РїСЂРѕР±Р»РµРјРЅС‹Рµ.',
      ].join('\n');

      console.log(`[director] regenerate-script with feedback`);
      const script = await chatCompletion(
        effective.scriptModel,
        [{ role: 'system', content: effective.scriptwriterPrompt }, { role: 'user', content: userMessage }],
        effective.temperature,
      );

      await withProject(req.params.id, (p) => {
        p.script = script;
        p.stage = 'script';
        markReviewHandledForStage(p, 'script', reviewId, action);
      });
      res.json({ success: true, action: 'regenerate-script', script });
      return;
    }

    if (action === 'regenerate-shots') {
      const feedback = review?.notes
        .filter((n) => n.verdict !== 'approve')
        .map((n) => `- [${n.target}] ${n.comment}${n.suggestion ? ` в†’ ${n.suggestion}` : ''}`)
        .join('\n') || '';

      const effective = await resolveSettings(project);
      const systemPrompt = [
        effective.shotSplitterPrompt, '',
        'Р—РђРњР•Р§РђРќРРЇ РљР Р•РђРўРР’РќРћР“Рћ Р”РР Р•РљРўРћР Рђ (РћР‘РЇР—РђРўР•Р›Р¬РќРћ РЈР§Р•РЎРўР¬):', feedback, '',
        'РџРµСЂРµРЅР°СЂРµР¶СЊ С€РѕС‚С‹ СЃ СѓС‡С‘С‚РѕРј Р·Р°РјРµС‡Р°РЅРёР№.', '',
        'CRITICAL OUTPUT FORMAT: Return ONLY a valid JSON array.',
        'Each element: { "scene": string, "imagePrompt": string, "videoPrompt": string, "duration": number (2-5), "assetRefs": string[], "audioDescription": string }',
      ].join('\n');

      console.log(`[director] regenerate-shots with feedback`);
      const raw = await chatCompletion(
        effective.splitModel,
        [{ role: 'system', content: systemPrompt }, { role: 'user', content: project.script }],
        effective.temperature,
      );

      let jsonStr = raw.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '');
        jsonStr = jsonStr.replace(/\n?```\s*$/, '');
      }
      if (!jsonStr.startsWith('[')) {
        const match = jsonStr.match(/\[[\s\S]*\]/);
        if (match) jsonStr = match[0];
      }

      const rawShots = JSON.parse(jsonStr);
      if (!Array.isArray(rawShots)) { sendApiError(res, 422, 'LLM response is not an array'); return; }

      const shots: ShotMeta[] = rawShots.map((r: any, i: number) => ({
        id: `shot-${String(i + 1).padStart(3, '0')}`,
        order: i,
        scene: r.scene || r.description || '',
        audioDescription: r.audioDescription || '',
        imagePrompt: r.imagePrompt || r.prompt || '',
        videoPrompt: r.videoPrompt || r.imagePrompt || r.prompt || '',
        duration: clampShotDuration(r.duration ?? r.durationSec ?? MAX_SHOT_DURATION_SEC),
        assetRefs: Array.isArray(r.assetRefs) ? r.assetRefs : [],
        status: 'draft',
        generatedImages: [],
        enhancedImages: [],
        selectedImage: null,
        videoFile: null,
      }));

      for (const shot of shots) {
        await ensureDir(resolveProjectPath(project.id, 'shots', shot.id, 'reference'));
        await ensureDir(resolveProjectPath(project.id, 'shots', shot.id, 'generated'));
        await ensureDir(resolveProjectPath(project.id, 'shots', shot.id, 'video'));
      }

      await withProject(req.params.id, (p) => {
        p.shots = shots;
        p.stage = 'shots';
        markReviewHandledForStage(p, 'shots', reviewId, action);
      });
      res.json({ success: true, action: 'regenerate-shots', shots });
      return;
    }

    sendApiError(res, 400, `Unknown action: ${action}`);
  } catch (err) {
    console.error('[director] apply-feedback error:', err);
    sendApiError(res, 500, getErrorMessage(err, 'Failed to apply director feedback'));
  }
});

export default router;

