// Higgsfield model registry — hardcoded endpoints per SDK / AIML API docs.
// Each model has its own endpoint pattern and reference-image parameter format.

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
  {
    id: 'flux-pro/kontext/max/text-to-image',
    name: 'Flux Kontext Max',
    category: 'image',
    i2iEndpoint: 'flux-pro/kontext/max/image-to-image',
    refParam: 'image_url',
  },
  {
    id: 'flux-pro/kontext/text-to-image',
    name: 'Flux Kontext',
    category: 'image',
    i2iEndpoint: 'flux-pro/kontext/image-to-image',
    refParam: 'image_url',
  },
  {
    id: '/v1/text2image/soul',
    name: 'Higgsfield Soul',
    category: 'image',
    i2iEndpoint: '/v1/img2img/soul',
    refParam: 'reference_image',
    extraParams: { strength: 0.7 },
  },
  {
    id: 'gpt-image/1.5/text-to-image',
    name: 'GPT Image 1.5',
    category: 'image',
    i2iEndpoint: 'gpt-image/1.5/image-to-image',
    refParam: 'input_images',
  },
  {
    id: 'bytedance/seedream/v4/text-to-image',
    name: 'Seedream V4',
    category: 'image',
  },
  {
    id: 'nano-banana/pro/text-to-image',
    name: 'Nano Banana Pro',
    category: 'image',
  },
];

export const HIGGSFIELD_VIDEO_MODELS: HiggsfieldVideoModel[] = [
  {
    id: '/v1/image2video/dop',
    name: 'DOP Turbo',
    category: 'video',
    subModel: 'dop-turbo',
  },
  {
    id: 'kling/3.0/image-to-video',
    name: 'Kling 3.0',
    category: 'video',
  },
  {
    id: 'wan/2.5/image-to-video',
    name: 'WAN 2.5',
    category: 'video',
  },
  {
    id: 'minimax/hailuo-02/image-to-video',
    name: 'MiniMax Hailuo',
    category: 'video',
  },
];

export function findImageModel(id: string): HiggsfieldImageModel | undefined {
  return HIGGSFIELD_IMAGE_MODELS.find((m) => m.id === id);
}

export function findVideoModel(id: string): HiggsfieldVideoModel | undefined {
  return HIGGSFIELD_VIDEO_MODELS.find((m) => m.id === id);
}
