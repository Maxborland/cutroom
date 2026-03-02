# План интеграции OpenReel в CutRoom (замена Remotion)

Дата: 2026-03-02  
Репозиторий: https://github.com/Maxborland/cutroom  
Целевая архитектура: **Path A — CutRoom как AI-пайплайн + OpenReel как финальный NLE/экспорт**

---

## 1) Overview

### Что делаем

Интегрируем OpenReel Video как финальный редактор и экспортёр видео, полностью выводим Remotion из runtime-потока монтажа.

- CutRoom остаётся источником ассетов и AI-логики (сценарий, шоты, VO, музыка, монтажный план).
- OpenReel становится финальным таймлайном, ручной доводкой и экспортом (WebCodecs в браузере).
- Пользовательский флоу: `генерация в CutRoom -> Открыть в редакторе -> правки в OpenReel -> экспорт файла`.

### Почему

- Remotion хорошо рендерит по шаблону, но не является полноценным NLE для интерактивного монтажа.
- OpenReel уже имеет multi-track, keyframes, transitions, subtitles, color tools, waveform и экспорт в браузере.
- Снижается серверная сложность рендера (очереди/воркеры/Remotion bundle).

### Архитектура (ASCII)

```text
┌───────────────────────────────┐
│ CutRoom AI pipeline           │
│ brief/script/shots/review     │
│ VO + music + montagePlan      │
└───────────────┬───────────────┘
                │
                │ GET /api/projects/:id/openreel-project
                ▼
┌─────────────────────────────────────────────┐
│ server/lib/openreel-exporter.ts            │
│ - преобразование в OpenReel Project v1.0.0 │
│ - mediaManifest с HTTP URL ассетов         │
└───────────────┬─────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────┐
│ Frontend route /editor/:projectId          │
│ OpenReelHost (встроенный editor bridge)    │
│ - hydrate media blobs из URL               │
│ - autosave -> PUT /openreel-project        │
│ - export progress + download               │
└───────────────┬─────────────────────────────┘
                │
     ┌──────────┴──────────┐
     ▼                     ▼
┌──────────────┐   ┌──────────────────────┐
│ IndexedDB    │   │ File storage CutRoom │
│ (локальный   │   │ data/projects/<id>/  │
│ быстрый кэш) │   │ openreel/project.json│
└──────────────┘   └──────────────────────┘
```

### Нефункциональные ограничения

- Хранилище остаётся файловым (без БД).
- Пути и операции должны быть Windows-safe (`D:\Projects\cutroom\...`), только `path.join/resolveProjectPath`.
- OpenReel MIT совместим с AGPL-3.0 CutRoom (фиксируем в документации и NOTICE).
- Без новых тяжёлых зависимостей вне OpenReel.
- TDD: сначала тесты, затем реализация.

---

## 2) Phase 1 — OpenReel как submodule/package (оценка вариантов)

### Варианты

| Вариант | Плюсы | Минусы | Вердикт |
|---|---|---|---|
| **Git submodule** (`vendor/openreel-video`) | Чёткий pin на commit, легко обновлять upstream, изоляция зависимостей OpenReel | Нужно следить за submodule lifecycle в CI/dev | **Рекомендуется** |
| pnpm workspace (общий монорепо) | Нативно работают `workspace:*` пакеты OpenReel | Требует миграции текущего npm-проекта CutRoom на pnpm/workspace, высокий blast radius | Не сейчас |
| npm package (из git/tarball) | Простой consumption на бумаге | OpenReel пакеты `private` + `workspace:*`, нужен repack/fork/publish pipeline | Нежелательно |

### Рекомендация

**Git submodule + bridge-адаптер в CutRoom**.  
Это минимально рисковый путь для текущего npm-репо и Windows-окружения.

### Файлы

**Создать**
- `.gitmodules`
- `vendor/openreel-video/` (git submodule)
- `scripts/openreel/sync.mjs`
- `scripts/openreel/build.mjs`
- `docs/openreel/UPSTREAM.md`

**Изменить**
- `package.json` (скрипты `openreel:sync`, `openreel:build`, `openreel:update`)
- `.gitignore` (артефакты сборки openreel host, если нужны)

**Удалить**
- Ничего

### Ключевые интерфейсы/сниппет

```json
{
  "scripts": {
    "openreel:sync": "git submodule update --init --recursive vendor/openreel-video",
    "openreel:build": "node scripts/openreel/build.mjs",
    "openreel:update": "git -C vendor/openreel-video fetch && git -C vendor/openreel-video checkout <commit>"
  }
}
```

### Тесты (TDD)

- `tests/unit/openreel-submodule-config.test.ts`:
  - submodule path существует,
  - pinned commit зафиксирован,
  - build script возвращает 0.

### Зависимости

- **Новые:** только OpenReel (через submodule), без npm-добавок в root.
- **Удалённые:** нет.

### Сложность

**M**

---

## 3) Phase 2 — Конвертер CutRoom → OpenReel Project JSON

Цель: новый `server/lib/openreel-exporter.ts`, который выдаёт OpenReel формат **v1.0.0** + media manifest для клиентской гидрации Blob.

### Что маппим

1. **Shot video** → `mediaLibrary.items[]` (type `video`) + `timeline.videoTrack.clips[]`
2. **Voiceover** → audio track `VO`
3. **Music** → audio track `Music`
4. **montagePlan.transitions** → `Track.transitions[]` (map типов)
5. **voiceoverScript** → `timeline.subtitles[]` (тайминги по длительности VO)
6. HTTP media URLs для client-side OpenReel

### Файлы

**Создать**
- `server/lib/openreel-exporter.ts`
- `server/lib/openreel-project-store.ts`
- `tests/unit/openreel-exporter.test.ts`

**Изменить**
- `server/lib/storage.ts` (добавить `openreel`-метаданные проекта)
- `src/types/index.ts` (тип `openreel` метаданных)

**Удалить**
- Ничего

### Ключевые интерфейсы/сниппет

```ts
export interface OpenReelBundle {
  version: '1.0.0';
  project: OpenReelProject;
  mediaManifest: Record<string, {
    url: string;
    mimeType: string;
    kind: 'shot' | 'voiceover' | 'music';
    shotId?: string;
  }>;
}

export async function buildOpenReelBundle(
  project: Project,
  baseUrl: string,
): Promise<OpenReelBundle>
```

```ts
function mapTransition(t: TransitionEntry): OpenReelTransition | null {
  switch (t.type) {
    case 'cut': return null; // в OpenReel это отсутствие transition
    case 'crossfade': return { type: 'crossfade', ... };
    case 'fade': return { type: 'dipToBlack', ... };
    case 'slide_left': return { type: 'slide', params: { direction: 'left' }, ... };
    case 'slide_right': return { type: 'slide', params: { direction: 'right' }, ... };
    case 'zoom_blur': return { type: 'zoom', params: { blur: true }, ... };
    case 'wipe': return { type: 'wipe', params: { direction: 'right' }, ... };
  }
}
```

```ts
// subtitle timing: пропорционально длине фраз по общей длительности VO
export function buildSubtitles(script: string, voDurationSec: number): Subtitle[]
```

### Тесты (TDD)

- `tests/unit/openreel-exporter.test.ts`
  - проект версии `1.0.0`;
  - shot→media+clip корректный;
  - VO/music попадают на отдельные audio tracks;
  - transition mapping;
  - subtitle timing суммарно <= VO duration;
  - mediaManifest содержит валидные URL (`/api/projects/:id/...`).

### Зависимости

- **Новые:** нет (используем существующие `probeDuration`, `uuid`, storage helpers).
- **Удалённые:** нет.

### Сложность

**L**

---

## 4) Phase 3 — Editor route `/editor/:projectId`

Цель: отдельный экран редактора в CutRoom, который поднимает OpenReel с проектом, синхронизирует состояние назад в файловое хранилище и учитывает IndexedDB.

### API контракт

- `GET /api/projects/:id/openreel-project`
  - Возвращает `OpenReelBundle`.
- `PUT /api/projects/:id/openreel-project`
  - Принимает `{ version, project, mediaManifest? }` и сохраняет в `openreel/project.json`.

### IndexedDB ↔ server bridge

- IndexedDB остаётся локальным быстрым кэшем OpenReel.
- Сервер хранит канонический snapshot (`openreel/project.json`) для межсессионной и межбраузерной консистентности.
- На входе:
  1) загружаем server snapshot;
  2) если local snapshot свежее (по revision/modifiedAt) — показываем пользователю конфликт-модалку (русский текст):
     - «Оставить локальную версию»
     - «Загрузить серверную версию».

### Файлы

**Создать**
- `server/routes/openreel.ts`
- `src/routes/OpenReelEditorPage.tsx`
- `src/components/openreel/OpenReelHost.tsx`
- `src/components/openreel/OpenReelSyncStatus.tsx`
- `src/lib/openreel-bridge.ts`
- `tests/integration/openreel-route.test.ts`
- `tests/components/OpenReelEditorPage.test.tsx`

**Изменить**
- `server/app.ts` (подключить новый роут)
- `src/App.tsx` (добавить route `/editor/:projectId`)
- `src/lib/api.ts` (методы `api.openreel.getProject/saveProject`)
- `src/components/MontageView.tsx` (кнопка `Открыть в редакторе`)
- `src/types/index.ts` (типы bridge payload)

**Удалить**
- Ничего

### Ключевые интерфейсы/сниппет

```ts
type BridgeMessage =
  | { type: 'cutroom:init'; payload: OpenReelBundle }
  | { type: 'openreel:ready' }
  | { type: 'openreel:project-change'; payload: { version: '1.0.0'; project: OpenReelProject } }
  | { type: 'openreel:export-progress'; payload: { phase: string; progress: number } }
  | { type: 'openreel:export-complete'; payload: { filename: string } }
  | { type: 'openreel:error'; payload: { message: string } };
```

```ts
// RU-only copy in CutRoom-owned UI
const RU_TEXT = {
  loading: 'Загружаем проект редактора…',
  saving: 'Сохраняем изменения…',
  conflictTitle: 'Обнаружены разные версии проекта',
};
```

### Тесты (TDD)

- Integration:
  - `GET/PUT /openreel-project` happy-path + 404 + validation errors.
- Component:
  - `/editor/:projectId` показывает лоадер,
  - отправляет init в bridge,
  - дебаунс-сохранение на `project-change`.
- Contract tests:
  - media hydration из URL (mock fetch blobs).

### Зависимости

- **Новые:** нет.
- **Удалённые:** нет.

### Сложность

**XL**

---

## 5) Phase 4 — Полная замена Remotion на OpenReel WebCodecs export

Цель: убрать серверный Remotion render-worker/роуты и перевести экспорт на клиентский OpenReel export flow с прогрессом и загрузкой файла.

### Что меняем

- Удаляем Remotion render backend (`startRender/getRenderJob/deleteRenderJob`).
- Экспорт делаем через OpenReel export engine в `/editor/:projectId`.
- Прогресс/фазы отображаем в CutRoom (русский UI).
- Файл отдается пользователю через File Picker/браузерный download.

### Файлы

**Создать**
- `tests/unit/openreel-export-bridge.test.ts`

**Изменить**
- `src/components/MontageView.tsx` (убрать старый render step, оставить переход в редактор)
- `server/routes/montage.ts` (удалить `/montage/render*` endpoints)
- `src/lib/api.ts` (удалить `montage.render/getRenderStatus/getRenderDownloadUrl`)
- `src/types/index.ts` (удалить/мигрировать `RenderJob` если больше не нужен)
- `tests/integration/montage.test.ts` (убрать remotion render блоки)
- `tests/unit/montage-render.test.ts` (переписать/удалить)

**Удалить**
- `server/lib/render-worker.ts`
- `server/remotion/src/Root.tsx`
- `server/remotion/src/Composition.tsx`
- `server/remotion/src/lib/plan-reader.ts`
- (при необходимости весь каталог) `server/remotion/`

### Ключевые интерфейсы/сниппет

```ts
interface OpenReelExportProgress {
  phase: 'preparing' | 'rendering' | 'encoding' | 'finalizing';
  progress: number; // 0..100
  etaSec?: number;
}
```

### Тесты (TDD)

- unit bridge progress mapping,
- component export banner states,
- integration: старые remotion endpoints возвращают 404/удалены из маршрутов.

### Зависимости

- **Новые:** нет.
- **Удалённые:**
  - `remotion`
  - `@remotion/cli`
  - `@remotion/media-utils`
  - `@remotion/renderer`

### Сложность

**L**

---

## 6) Phase 5 — Fix VO normalization (`tts-utils.ts`)

Цель: не вырезать ремарки, а превращать их в управляемые теги для ElevenLabs v3; добавить UX-инструменты в UI.

### Требования реализации

1. `(пауза)`, `(тише)` и похожие ремарки **сохраняем** и конвертируем в теги (`<break .../>`, prosody/emphasis).
2. Добавляем выразительные подсказки (prosody/emphasis) по правилам ElevenLabs v3.
3. В UI редактора VO добавляем быстрые кнопки вставки тегов.
4. Кнопка «Нормализовать» становится **неидемпотентной**: каждый запуск усиливает/добавляет новые hints.

### Файлы

**Создать**
- `tests/components/VoiceoverTagToolbar.test.tsx`

**Изменить**
- `server/lib/tts-utils.ts`
- `server/routes/montage.ts` (`POST /montage/normalize-vo-text` принимает `pass`)
- `src/components/MontageView.tsx` (toolbar + pass counter)
- `src/lib/api.ts` (передавать `pass`)
- `tests/unit/tts-utils.test.ts`
- `tests/integration/montage.test.ts` (normalize endpoint новые проверки)

**Удалить**
- ничего

### Ключевые интерфейсы/сниппет

```ts
export interface NormalizeVoiceoverOptions {
  pass?: number; // 1..N, намеренно неидемпотентно
  provider?: 'elevenlabs-fal' | 'elevenlabs' | 'kokoro';
}

export function normalizeVoiceoverText(text: string, opts?: NormalizeVoiceoverOptions): string
```

```ts
const STAGE_DIRECTION_MAP = {
  'пауза': '<break time="600ms"/>',
  'короткая пауза': '<break time="300ms"/>',
  'тише': '<prosody volume="-4dB">',
};
```

### Тесты (TDD)

- unit:
  - stage directions конвертируются, а не удаляются;
  - `pass=2` даёт больше/новые hints, чем `pass=1`;
  - числа/аббревиатуры продолжают нормализоваться.
- component:
  - toolbar вставляет теги в позицию курсора.
- integration:
  - endpoint возвращает разные результаты на повторных вызовах (`pass` increment).

### Зависимости

- **Новые:** нет.
- **Удалённые:** нет.

### Сложность

**M**

---

## 7) Phase 6 — Cleanup

Цель: окончательно убрать legacy UI/код Remotion-эпохи и выровнять тесты/типы.

### Что удаляем

- Старый `TimelineEditor`
- Старые блоки `AudioMixer` и `RenderProgress` из `MontageView`
- Остатки Remotion types/settings/tests

### Файлы

**Изменить**
- `src/components/MontageView.tsx` (удалить `TimelineEditor`, `AudioMixer`, `RenderProgress`)
- `src/components/Sidebar.tsx` (при необходимости переименовать «Монтаж» в «Редактор»)
- `src/components/PipelineHeader.tsx` (русские заголовки для editor flow)
- `src/types/index.ts` (чистка устаревших montage/remotion render типов)
- `server/lib/config.ts` + `server/routes/settings.ts` (убрать `remotionConcurrency`)
- `package.json`, `package-lock.json`
- `tests/components/App.stage-sync.test.tsx` (новый route flow)

**Удалить**
- `src/components/TimelineEditor.tsx`
- `tests/unit/montage-render.test.ts` (или переписать в openreel-export)
- remotion-остатки из `server/remotion/**` (если не удалены в Phase 4)

### Тесты (TDD)

- прогон:
  - `npm run test:unit`
  - `npm run test:integration`
  - `npm run test:components`
- smoke e2e:
  - открыть `/editor/:projectId`,
  - загрузка ассетов,
  - сохранить,
  - экспорт начать/завершить.

### Зависимости

- **Новые:** нет.
- **Удалённые:** финальная чистка remotion-related.

### Сложность

**M**

---

## Дополнительно: сохранность лицензий и документация

- Зафиксировать в `docs/openreel/UPSTREAM.md`:
  - OpenReel (MIT), CutRoom (AGPL-3.0), совместимость допустима.
  - Любые локальные патчи OpenReel документируются (что и почему изменено).
- Добавить заметку в README о новом пользовательском флоу: «Открыть в редакторе».

---

## Порядок выполнения (рекомендуемый)

1. **Phase 1** (submodule + build/sync scripts)
2. **Phase 2** (exporter + media manifest + unit tests)
3. **Phase 3** (route + bridge + GET/PUT APIs)
4. **Phase 5** (VO normalization UX/logic; можно параллелить с 3)
5. **Phase 4** (замена рендера)
6. **Phase 6** (финальная чистка)

Так уменьшаем риск: сначала поднимаем редактирование и синхронизацию, затем выключаем Remotion.
