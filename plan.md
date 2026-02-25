# Plan: Удаление отдельных изображений и видео шота

## Контекст

При итерациях генерации накапливаются файлы:
- `shot.generatedImages: string[]` — массив имён файлов (gen_*.png)
- `shot.enhancedImages: string[]` — массив имён файлов (enh_*.png)
- `shot.videoFile: string | null` — одно видео

Файлы лежат на диске:
- Изображения: `data/projects/{id}/shots/{shotId}/generated/{filename}`
- Видео: `data/projects/{id}/shots/{shotId}/video/{filename}`

Нужно: кнопки удаления отдельных изображений и видео в ShotDetail.

---

## Файлы для изменения

### 1. Backend: `server/routes/shots.ts` — 2 новых эндпоинта

**DELETE `/api/projects/:id/shots/:shotId/image/:filename`**
- Удаляет файл с диска из `generated/`
- Убирает filename из `shot.generatedImages` и `shot.enhancedImages`
- Сохраняет проект

**DELETE `/api/projects/:id/shots/:shotId/video`**
- Удаляет файл с диска из `video/`
- Ставит `shot.videoFile = null`
- Сохраняет проект

### 2. Frontend API: `src/lib/api.ts`

Добавить:
```ts
shots: {
  deleteImage: (projectId, shotId, filename) =>
    request<void>(`/projects/${projectId}/shots/${shotId}/image/${encodeURIComponent(filename)}`, { method: 'DELETE' }),
  deleteVideo: (projectId, shotId) =>
    request<void>(`/projects/${projectId}/shots/${shotId}/video`, { method: 'DELETE' }),
}
```

### 3. Zustand store: `src/stores/projectStore.ts`

Добавить 2 метода:
- `deleteShotImage(projectId, shotId, filename)` — optimistic: убирает из generatedImages/enhancedImages + background API
- `deleteShotVideo(projectId, shotId)` — optimistic: ставит videoFile=null + background API

### 4. UI: `src/components/ShotDetail.tsx`

- На каждой карточке изображения (generatedImages/enhancedImages) — кнопка X (иконка Trash2)
- Под видеоплеером — кнопка "Удалить видео"
- Confirm перед удалением (window.confirm)

---

## Проверка

1. `npx tsc --noEmit` — без ошибок
2. `npx vitest run` — тесты не ломаются
3. Ручная проверка: удаление изображения/видео в UI, файл исчезает с диска
