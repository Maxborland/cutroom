# Fal Schema-Driven Capabilities Design

**Date:** 2026-03-27

## Goal

Перевести Fal model capabilities на schema-driven режим, чтобы разрешение, aspect ratio, duration и другие provider-native параметры брались из OpenAPI schema конкретного `endpoint_id`, а не из ручных эвристик.

## Decision

Используем один backend-источник истины:

- backend по `endpoint_id` тянет `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=...`
- schema кэшируется
- из schema извлекаются normalized capabilities модели
- те же capabilities используются:
  - в `/api/models`
  - в `SettingsView`
  - в image/video generation payload
  - в server-side validation/normalization

## Scope

Первая версия покрывает:

- image generation:
  - `resolution`
  - `aspect_ratio`
- video generation:
  - `resolution`
  - `aspect_ratio`
  - `duration`
- provider-native defaults и required flags, если они явно есть в schema

## Architecture

### 1. Fal schema loader

Новый backend-модуль получает OpenAPI schema по `endpoint_id`, кэширует результат и отдает нормализованный view:

- `resolutionOptions`
- `aspectRatioOptions`
- `durationOptions`
- `defaultValues`
- `requiredFields`

### 2. Capability normalization

Нормализатор не отдает сырой OpenAPI во фронтенд. Вместо этого он извлекает только пригодные для продукта поля из `components.schemas.*Input.properties`.

### 3. Models API

`/api/models` для Fal-моделей начинает заполнять capability-поля из schema loader. Статический registry остается как fallback только для:

- identity модели
- provider mapping
- legacy fallback при недоступной schema

### 4. Generation payload

`generate/image.ts` и `generate/video.ts` перестают угадывать explicit options там, где schema уже дала точные provider-native параметры.

### 5. UI

`SettingsView` показывает только реальные options выбранной модели. Если schema недоступна, UI честно деградирует в fallback mode.

## Failure Mode

Если schema не загрузилась:

- `/api/models` использует текущий fallback
- generation работает по старой безопасной логике
- UI не обещает unsupported options

## Success Criteria

- для Fal-моделей UI показывает реальные `resolution/aspect_ratio/duration` options
- generation отправляет в provider именно schema-backed поля
- `high/medium/low` больше не маскируют реальные provider значения там, где schema знает точные options
- конкретный кейс вроде `nano-banana-pro/edit` отражает `1K/2K/4K` без ручного хардкода
