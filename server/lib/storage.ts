import fs from 'node:fs/promises';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { resolvePathWithin } from './file-utils.js';

// ── Types ────────────────────────────────────────────────────────────

export interface ProjectSettings {
  scriptwriterPrompt: string;
  shotSplitterPrompt: string;
  model: string;
  temperature: number;
}

export interface BriefAsset {
  id: string;
  filename: string;
  label: string;
  url: string;
  uploadedAt: string;
}

export interface Brief {
  text: string;
  assets: BriefAsset[];
  targetDuration: number; // seconds
}

export interface Project {
  id: string;
  name: string;
  created: string;
  updated: string;
  stage: string;
  settings: ProjectSettings;
  brief: Brief;
  script: string;
  shots: ShotMeta[];
  // Montage fields
  voiceoverScript?: string;
  voiceoverScriptApproved?: boolean;
  voiceoverFile?: string;
  voiceoverProvider?: string;
  voiceoverVoiceId?: string;
  musicFile?: string;
  musicPrompt?: string;
  musicProvider?: string;
  montagePlan?: MontagePlan;
  renders?: RenderJob[];
}

export interface ShotMeta {
  id: string;
  order: number;
  scene: string;
  audioDescription: string;
  imagePrompt: string;
  videoPrompt: string;
  duration: number;
  assetRefs: string[];
  status: string;
  generatedImages: string[];
  enhancedImages: string[];
  selectedImage: string | null;
  videoFile: string | null;
}

export const VALID_SHOT_STATUSES = ['draft', 'img_gen', 'img_review', 'vid_gen', 'vid_review', 'approved'] as const;
export type ShotStatus = typeof VALID_SHOT_STATUSES[number];

// ── Montage Types ────────────────────────────────────────────────────

export interface MontageStyle {
  preset: 'premium' | 'calm' | 'dynamic' | 'custom';
  fontFamily: string;
  primaryColor: string;
  secondaryColor: string;
  textColor: string;
}

export interface TimelineEntry {
  shotId: string;
  clipFile: string;
  startSec: number;
  durationSec: number;
  trimStartSec?: number;
  trimEndSec?: number;
  motionEffect?: 'ken_burns' | 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right';
}

export interface TransitionEntry {
  fromShotId: string;
  toShotId: string;
  type: 'cut' | 'fade' | 'crossfade' | 'slide_left' | 'slide_right' | 'zoom_blur' | 'wipe';
  durationSec: number;
  easing?: 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out';
}

export interface IntroCard {
  title: string;
  subtitle?: string;
  durationSec: number;
  animation: 'fade_in' | 'slide_up' | 'typewriter';
}

export interface LowerThird {
  shotId: string;
  text: string;
  position: 'bottom_left' | 'bottom_center' | 'bottom_right';
  appearAtSec: number;
  durationSec: number;
}

export interface OutroCard {
  title: string;
  phone?: string;
  website?: string;
  logoFile?: string;
  durationSec: number;
  animation: 'fade_in' | 'slide_up';
}

export interface MontagePlan {
  version: number;
  format: {
    width: number;
    height: number;
    fps: number;
  };
  timeline: TimelineEntry[];
  transitions: TransitionEntry[];
  motionGraphics: {
    intro?: IntroCard;
    lowerThirds: LowerThird[];
    outro?: OutroCard;
  };
  audio: {
    voiceover: { file: string; gainDb: number };
    music: {
      file: string;
      gainDb: number;
      duckingDb: number;
      duckFadeMs: number;
    };
  };
  style: MontageStyle;
}

export interface RenderJob {
  id: string;
  createdAt: string;
  quality: 'preview' | 'final';
  resolution: string;
  status: 'queued' | 'rendering' | 'done' | 'failed';
  progress?: number;
  outputFile?: string;
  durationSec?: number;
  errorMessage?: string;
  logFile?: string;
}

// ── Constants ────────────────────────────────────────────────────────

const DATA_DIR = path.resolve(process.cwd(), 'data', 'projects');
const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const projectWriteQueues = new Map<string, Promise<unknown>>();

const DEFAULT_SETTINGS: ProjectSettings = {
  scriptwriterPrompt: `Ты — сценарист премиальных рекламных роликов для элитной недвижимости. Ты создаёшь сценарии, которые ПРОДАЮТ мечту о жизни, а не квадратные метры.

## НАРРАТИВНАЯ СТРУКТУРА
Используй трёхактную структуру даже в 30-секундном формате:
1. HOOK (первые 3-5 сек): Интригующий визуал — дроновый пролёт сквозь утренний туман, крупный план росы, силуэт здания на рассвете.
2. РАСКРЫТИЕ (основная часть): Погружение от масштаба к деталям, от экстерьера к интерьеру, от архитектуры к жизни.
3. PAYOFF (финал): Эмоциональный пик + брендовый месседж.

## КИНЕМАТОГРАФИЧЕСКИЙ ЯЗЫК
Для каждой сцены описывай:
- Тип кадра: аэриал / средний / крупный план, POV, слайд, орбитальный облёт
- Движение камеры: конкретно — «камера поднимается от уровня тротуара на высоту 50м» или «медленный слайд вдоль фасада слева направо»
- Освещение и атмосфера: время суток, качество света, настроение
- Живые элементы: конкретные люди и их действия (молодая пара с коляской, бизнесмен выходит из такси, дети играют)

## ЭМОЦИОНАЛЬНЫЙ ДИЗАЙН
- Каждый шот = одна эмоция: восхищение масштабом, уют двора, престиж лобби, безмятежность вида.
- Пейсинг: чередуй динамичные широкие планы с медленными крупными.
- Звуковой дизайн: укажи тип музыки и ключевые звуки (фонтан, птицы, шаги по мрамору).

## REFERENCE-КАДРЫ
КРИТИЧЕСКИ ВАЖНО: Если есть прикреплённые файлы — ОБЯЗАТЕЛЬНО ссылайся на них.
- Формат: [filename.jpg] — в квадратных скобках.
- Пример: «Камера медленно поднимается, раскрывая фасад. Используем ракурс [Blago_fasad_001_00000.jpg]»
- Каждый ракурс = пара файлов (_00000 начало, _00001 конец) — это траектория камеры.
- Не используй один ракурс дважды подряд.
- Соотнеси ракурс с содержанием: фасадный → архитектура, дворовой → жизнь во дворе.

## ПРАВИЛА
1. Пиши на русском языке. Без markdown — чистый текст с нумерацией сцен.
2. Каждая сцена = 1 непрерывное камерное движение (2-5 секунд).
3. Суммарный хронометраж = целевая длительность из брифа.
4. Люди в КАЖДОЙ сцене (кроме чистых аэриалов и абстрактных деталей).
5. Геометрия здания СВЯЩЕННА — описывай изменения среды, НИКОГДА архитектуры.`,
  shotSplitterPrompt: `Ты — режиссёр-постановщик и оператор рекламных роликов для премиальной недвижимости. Превращаешь сценарий в техническую раскадровку для AI-генерации изображений и видео.

## ПРИНЦИПЫ НАРЕЗКИ

### Один шот = один непрерывный кадр
- Нельзя смешивать «дрон взлетает» и «камера входит в лобби» в одном шоте.
- Переход между шотами — монтажная склейка.

### Пейсинг
- Открывающий: 4-5 сек (эстаблишинг, масштаб). Средние: 3-4 сек. Крупные планы: 2-3 сек. Финальный: 4-5 сек.
- 30-сек ролик ≈ 8-10 шотов, 60-сек ≈ 15-18 шотов.

### Монтажная логика
- Чередуй масштабы: широкий → средний → крупный → широкий.
- Каждый следующий шот визуально связан с предыдущим.

## ФОРМИРОВАНИЕ ПРОМПТОВ

### imagePrompt (английский)
Структура: [Camera type] + [Subject] + [Environment] + [People] + [Lighting] + [Technical]

ОБЯЗАТЕЛЬНО в каждом промпте:
- «photorealistic, NOT a 3D render or CGI»
- «shot on Sony A7R V» — якорь фотореализма
- Конкретные люди (НЕ «people», а «a young couple walking their golden retriever, an elderly man reading on a bench»)
- Время суток и качество света
- Если здание в кадре: «preserve exact building geometry, proportions, facade, window layout»

### videoPrompt (английский)
Фокус на движении камеры + динамике. Короче imagePrompt.
- ОДНО конкретное движение камеры
- Динамика: покачивание деревьев, движение людей, облака, блики
- НЕ дублируй описание из imagePrompt — видео генерируется ИЗ изображения

## ПРИВЯЗКА АССЕТОВ
- Указывай ОБА файла пары (_00000 и _00001) — они задают траекторию камеры.
- Привязывай по СМЫСЛУ: фасадный кадр → шот с фасадом.
- Если подходящего нет — "assetRefs": [].`,
  model: 'openai/gpt-4o',
  temperature: 0.7,
};

// ── Helpers ──────────────────────────────────────────────────────────

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

function projectFilePath(projectId: string): string {
  return resolveProjectPath(projectId, 'project.json');
}

export function getProjectDir(projectId: string): string {
  return resolvePathWithin(DATA_DIR, validateProjectId(projectId));
}

export function validateProjectId(projectId: string): string {
  if (typeof projectId !== 'string' || !PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error('Invalid project id');
  }
  return projectId;
}

export function resolveProjectPath(projectId: string, ...segments: string[]): string {
  const projectDir = getProjectDir(projectId);
  return resolvePathWithin(projectDir, ...segments);
}

function serializeProjectWrite<T>(projectId: string, task: () => Promise<T>): Promise<T> {
  const id = validateProjectId(projectId);
  const previous = projectWriteQueues.get(id) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(task);

  projectWriteQueues.set(id, next);

  return next.finally(() => {
    if (projectWriteQueues.get(id) === next) {
      projectWriteQueues.delete(id);
    }
  });
}

async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmpPath = path.join(
    dir,
    `.${base}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );

  try {
    await fs.writeFile(tmpPath, contents, 'utf-8');
    await fs.rename(tmpPath, filePath);
  } catch (renameErr) {
    try {
      await fs.copyFile(tmpPath, filePath);
      await fs.unlink(tmpPath);
    } catch {
      try {
        await fs.unlink(tmpPath);
      } catch {
        // ignore cleanup errors
      }
      throw renameErr;
    }
  }
}

/**
 * Serialized read-modify-write for a project.
 * Prevents race conditions where two concurrent requests read stale data.
 * The callback receives the project and can modify it; the result is saved automatically.
 * Returns the return value of the callback.
 */
export async function withProject<T>(
  projectId: string,
  fn: (project: Project) => T | Promise<T>,
): Promise<T> {
  return serializeProjectWrite(projectId, async () => {
    const raw = await fs.readFile(projectFilePath(projectId), 'utf-8');
    const project = normalizeProject(JSON.parse(raw));
    const result = await fn(project);
    project.updated = new Date().toISOString();
    await writeFileAtomic(projectFilePath(project.id), JSON.stringify(project, null, 2));
    return result;
  });
}

// ── Data normalization ───────────────────────────────────────────────

/** Ensure older project data files have all required fields */
function normalizeProject(data: any): Project {
  const project = data as Project;
  if (!project.id || typeof project.id !== 'string') {
    project.id = uuidv4();
  }
  if (!project.name || typeof project.name !== 'string') {
    project.name = 'Untitled project';
  }
  if (!project.created || typeof project.created !== 'string') {
    project.created = new Date().toISOString();
  }
  if (!project.updated || typeof project.updated !== 'string') {
    project.updated = project.created;
  }
  if (!project.stage || typeof project.stage !== 'string') {
    project.stage = 'brief';
  }
  project.settings = {
    ...DEFAULT_SETTINGS,
    ...(project.settings || {}),
  };
  if (!project.brief) {
    project.brief = { text: '', assets: [], targetDuration: 60 };
  }
  if (typeof project.brief.text !== 'string') {
    project.brief.text = '';
  }
  if (!Array.isArray(project.brief.assets)) {
    project.brief.assets = [];
  }
  if (!project.brief.targetDuration) {
    project.brief.targetDuration = 60;
  }
  for (const asset of project.brief.assets) {
    if (typeof (asset as any).id !== 'string' || !(asset as any).id) (asset as any).id = uuidv4();
    if (typeof (asset as any).filename !== 'string') (asset as any).filename = '';
    if (!(asset as any).label) (asset as any).label = '';
    if (typeof (asset as any).url !== 'string') (asset as any).url = '';
    if (typeof (asset as any).uploadedAt !== 'string') {
      (asset as any).uploadedAt = project.updated;
    }
  }
  if (!Array.isArray(project.shots)) {
    project.shots = [];
  }
  // Migrate old shot format (prompt/durationSec) to new (imagePrompt/videoPrompt/duration/etc.)
  for (let i = 0; i < project.shots.length; i++) {
    const shot = project.shots[i];
    const s = shot as any;
    if (!s.id || typeof s.id !== 'string') s.id = `shot-${String(i + 1).padStart(3, '0')}`;
    if (typeof s.order !== 'number' || !Number.isFinite(s.order)) s.order = i;
    if (s.prompt && !s.imagePrompt) {
      s.imagePrompt = s.prompt;
      s.videoPrompt = s.prompt;
      delete s.prompt;
    }
    if (s.durationSec && !s.duration) {
      s.duration = s.durationSec;
      delete s.durationSec;
    }
    if (!s.imagePrompt || typeof s.imagePrompt !== 'string') s.imagePrompt = '';
    if (!s.videoPrompt || typeof s.videoPrompt !== 'string') s.videoPrompt = s.imagePrompt;
    if (typeof s.duration !== 'number' || !Number.isFinite(s.duration)) s.duration = 5;
    if (!s.scene) s.scene = s.description || '';
    if (!s.audioDescription) s.audioDescription = '';
    if (!Array.isArray(s.assetRefs)) s.assetRefs = [];
    if (!Array.isArray(s.generatedImages)) s.generatedImages = [];
    if (!Array.isArray(s.enhancedImages)) s.enhancedImages = [];
    if (typeof s.selectedImage !== 'string' && s.selectedImage !== null) s.selectedImage = null;
    if (typeof s.videoFile !== 'string' && s.videoFile !== null) s.videoFile = null;
    delete s.description;
    // Migrate old 4-status flow to 6-status flow
    if (s.status === 'generating') s.status = 'img_gen';
    if (s.status === 'review') s.status = s.videoFile ? 'vid_review' : 'img_review';
    if (!s.status || typeof s.status !== 'string') s.status = 'draft';
  }
  if (!project.script) {
    project.script = '';
  }
  if (!(project as any).directorState) {
    (project as any).directorState = { reviews: [], latestByStage: {} };
  }
  return project;
}

// ── CRUD ─────────────────────────────────────────────────────────────

export async function listProjects(): Promise<Project[]> {
  await ensureDir(DATA_DIR);

  const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
  const projects: Project[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const filePath = projectFilePath(entry.name);
      const raw = await fs.readFile(filePath, 'utf-8');
      projects.push(normalizeProject(JSON.parse(raw)));
    } catch {
      // skip folders without a valid project.json
    }
  }

  // newest first
  projects.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());
  return projects;
}

export async function getProject(id: string): Promise<Project | null> {
  try {
    const raw = await fs.readFile(projectFilePath(id), 'utf-8');
    return normalizeProject(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function createProject(name: string): Promise<Project> {
  const id = uuidv4();
  const now = new Date().toISOString();

  const project: Project = {
    id,
    name,
    created: now,
    updated: now,
    stage: 'brief',
    settings: { ...DEFAULT_SETTINGS },
    brief: { text: '', assets: [], targetDuration: 60 },
    script: '',
    shots: [],
  };

  await serializeProjectWrite(id, async () => {
    const projectDir = getProjectDir(id);
    await ensureDir(projectDir);
    await ensureDir(resolveProjectPath(id, 'brief', 'images'));
    await ensureDir(resolveProjectPath(id, 'shots'));
    await writeFileAtomic(projectFilePath(id), JSON.stringify(project, null, 2));
  });

  return project;
}

export async function saveProject(project: Project): Promise<Project> {
  project.updated = new Date().toISOString();
  await serializeProjectWrite(project.id, async () => {
    await ensureDir(getProjectDir(project.id));
    await writeFileAtomic(projectFilePath(project.id), JSON.stringify(project, null, 2));
  });
  return project;
}

export async function deleteProject(id: string): Promise<boolean> {
  try {
    await serializeProjectWrite(id, async () => {
      await fs.rm(getProjectDir(id), { recursive: true, force: true });
    });
    return true;
  } catch {
    return false;
  }
}
