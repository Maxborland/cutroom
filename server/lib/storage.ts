import fs from 'node:fs/promises';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

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

// ── Constants ────────────────────────────────────────────────────────

const DATA_DIR = path.join(process.cwd(), 'data', 'projects');

const DEFAULT_SETTINGS: ProjectSettings = {
  scriptwriterPrompt: [
    'Ты — профессиональный сценарист рекламных роликов для элитной недвижимости.',
    'На основе брифа создай детальный сценарий видеоролика.',
    'Сценарий должен включать описание каждой сцены, камерных движений, настроения и текста для озвучки.',
    '',
    'ВАЖНО: Если в брифе есть прикреплённые файлы (рендеры, фотографии, ракурсы) — ты ОБЯЗАН ссылаться на них в сценарии по имени файла.',
    'Формат ссылки: [filename.jpg] — в квадратных скобках.',
    'Каждая сцена, для которой есть подходящий ракурс, должна содержать ссылку: "Используем ракурс [Blago_nizko_001_00000.jpg]".',
    'Это критически важно — по этим ссылкам система автоматически привяжет reference-кадры к шотам.',
    '',
    'Пиши на русском языке.',
  ].join('\n'),
  shotSplitterPrompt: [
    'Ты — режиссёр-постановщик.',
    'Раздели сценарий на отдельные кадры (shots).',
    'Для каждого кадра укажи: номер, промпт для генерации видео, длительность в секундах.',
    'Формат ответа — JSON-массив объектов с полями: id, prompt, durationSec.',
    'Пиши промпты на английском языке для видео-генератора.',
  ].join('\n'),
  model: 'openai/gpt-4o',
  temperature: 0.7,
};

// ── Helpers ──────────────────────────────────────────────────────────

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

function projectFilePath(projectId: string): string {
  return path.join(DATA_DIR, projectId, 'project.json');
}

export function getProjectDir(projectId: string): string {
  return path.join(DATA_DIR, projectId);
}

// ── Data normalization ───────────────────────────────────────────────

/** Ensure older project data files have all required fields */
function normalizeProject(data: any): Project {
  const project = data as Project;
  if (!project.brief) {
    project.brief = { text: '', assets: [] };
  }
  if (!Array.isArray(project.brief.assets)) {
    project.brief.assets = [];
  }
  if (!project.brief.targetDuration) {
    project.brief.targetDuration = 60;
  }
  for (const asset of project.brief.assets) {
    if (!(asset as any).label) (asset as any).label = '';
  }
  if (!Array.isArray(project.shots)) {
    project.shots = [];
  }
  // Migrate old shot format (prompt/durationSec) to new (imagePrompt/videoPrompt/duration/etc.)
  for (const shot of project.shots) {
    const s = shot as any;
    if (s.prompt && !s.imagePrompt) {
      s.imagePrompt = s.prompt;
      s.videoPrompt = s.prompt;
      delete s.prompt;
    }
    if (s.durationSec && !s.duration) {
      s.duration = s.durationSec;
      delete s.durationSec;
    }
    if (!s.scene) s.scene = s.description || '';
    if (!s.audioDescription) s.audioDescription = '';
    if (!Array.isArray(s.assetRefs)) s.assetRefs = [];
    if (!Array.isArray(s.enhancedImages)) s.enhancedImages = [];
    delete s.description;
  }
  if (!project.script) {
    project.script = '';
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

    const filePath = projectFilePath(entry.name);
    try {
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

  const projectDir = getProjectDir(id);
  await ensureDir(projectDir);
  await ensureDir(path.join(projectDir, 'brief', 'images'));
  await ensureDir(path.join(projectDir, 'shots'));

  await fs.writeFile(projectFilePath(id), JSON.stringify(project, null, 2), 'utf-8');
  return project;
}

export async function saveProject(project: Project): Promise<Project> {
  project.updated = new Date().toISOString();
  await ensureDir(getProjectDir(project.id));
  await fs.writeFile(projectFilePath(project.id), JSON.stringify(project, null, 2), 'utf-8');
  return project;
}

export async function deleteProject(id: string): Promise<boolean> {
  const projectDir = getProjectDir(id);
  try {
    await fs.rm(projectDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
