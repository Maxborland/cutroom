// Higgsfield model registry — endpoints from official docs (docs.higgsfield.ai).
// Users can enter custom model IDs via ModelSelect if a model is not listed here.

export interface HiggsfieldImageModel {
  id: string;              // text-to-image endpoint
  name: string;
  category: 'image';
  i2iEndpoint?: string;    // image-to-image endpoint (if supported)
  refParam?: 'image_url' | 'reference_image' | 'input_images';
  extraParams?: Record<string, unknown>;
}

export interface HiggsfieldVideoModel {
  id: string;              // endpoint
  name: string;
  category: 'video';
  subModel?: string;       // if endpoint requires input.model
}

export const HIGGSFIELD_IMAGE_MODELS: HiggsfieldImageModel[] = [
  // Confirmed in official docs (docs.higgsfield.ai)
  {
    id: 'bytedance/seedream/v4/text-to-image',
    name: 'Seedream V4',
    category: 'image',
  },
  {
    id: 'higgsfield-ai/soul/standard',
    name: 'Higgsfield Soul',
    category: 'image',
  },
  {
    id: 'reve/text-to-image',
    name: 'Reve',
    category: 'image',
  },
  {
    id: 'bytedance/seedream/v4/edit',
    name: 'Seedream V4 Edit',
    category: 'image',
  },
  // Available on platform but exact model_id may need verification
  {
    id: 'higgsfield-ai/nano-banana/pro',
    name: 'Nano Banana Pro',
    category: 'image',
  },
  {
    id: 'flux-pro/kontext/max/text-to-image',
    name: 'Flux Kontext Max',
    category: 'image',
  },
];

export const HIGGSFIELD_VIDEO_MODELS: HiggsfieldVideoModel[] = [
  {
    id: 'higgsfield-ai/dop/standard',
    name: 'DOP Standard',
    category: 'video',
  },
  {
    id: 'higgsfield-ai/dop/preview',
    name: 'DOP Preview',
    category: 'video',
  },
  {
    id: 'kling-video/v2.1/pro/image-to-video',
    name: 'Kling 2.1 Pro',
    category: 'video',
  },
  {
    id: 'bytedance/seedance/v1/pro/image-to-video',
    name: 'Seedance V1 Pro',
    category: 'video',
  },
];

export function findImageModel(id: string): HiggsfieldImageModel | undefined {
  return HIGGSFIELD_IMAGE_MODELS.find((m) => m.id === id);
}

export function findVideoModel(id: string): HiggsfieldVideoModel | undefined {
  return HIGGSFIELD_VIDEO_MODELS.find((m) => m.id === id);
}
