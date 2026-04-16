import { describe, expect, it } from 'vitest'
import {
  chooseFalCapabilityOption,
  extractFalEndpointCapabilities,
  normalizeFalDurationOption,
  normalizeFalEndpointId,
  type FalOpenApiDocument,
} from '../../server/lib/fal-schema'

describe('fal schema parsing', () => {
  it('normalizes queue schema endpoint ids into canonical fal endpoint ids', () => {
    expect(normalizeFalEndpointId('fal-endpoint:fal-ai/nano-banana-pro/edit')).toBe('fal-ai/nano-banana-pro/edit')
    expect(normalizeFalEndpointId('fal-ai/nano-banana-pro/edit')).toBe('fal-ai/nano-banana-pro/edit')
  })

  it('extracts image resolution and aspect ratio options from Fal OpenAPI', () => {
    const schema: FalOpenApiDocument = {
      openapi: '3.1.0',
      info: { title: 'Fal Queue API', version: '1.0.0' },
      paths: {},
      components: {
        schemas: {
          NanoBananaEditInput: {
            type: 'object',
            required: ['prompt'],
            properties: {
              prompt: { type: 'string' },
              resolution: {
                type: 'string',
                enum: ['1K', '2K', '4K'],
                default: '2K',
              },
              aspect_ratio: {
                type: 'string',
                enum: ['1:1', '16:9', '9:16'],
                default: '16:9',
              },
            },
          },
        },
      },
    }

    expect(extractFalEndpointCapabilities(schema)).toEqual({
      resolutionOptions: ['1K', '2K', '4K'],
      aspectRatioOptions: ['1:1', '16:9', '9:16'],
      durationOptions: [],
      defaults: {
        resolution: '2K',
        aspect_ratio: '16:9',
      },
      requiredFields: ['prompt'],
    })
  })

  it('extracts video duration along with resolution and aspect ratio from Fal OpenAPI', () => {
    const schema: FalOpenApiDocument = {
      openapi: '3.1.0',
      info: { title: 'Fal Queue API', version: '1.0.0' },
      paths: {},
      components: {
        schemas: {
          VeoFastInput: {
            type: 'object',
            properties: {
              resolution: {
                oneOf: [
                  { const: '720p' },
                  { const: '1080p' },
                  { const: '4k' },
                ],
                default: '1080p',
              },
              aspect_ratio: {
                enum: ['16:9', '9:16'],
              },
              duration: {
                oneOf: [
                  { const: '5' },
                  { const: '8' },
                ],
                default: '8',
              },
            },
          },
        },
      },
    }

    expect(extractFalEndpointCapabilities(schema)).toEqual({
      resolutionOptions: ['720p', '1080p', '4k'],
      aspectRatioOptions: ['16:9', '9:16'],
      durationOptions: ['5', '8'],
      defaults: {
        resolution: '1080p',
        duration: '8',
      },
      requiredFields: [],
    })
  })

  it('extracts schema-backed options from requestBody refs and composed property schemas', () => {
    const schema: FalOpenApiDocument = {
      openapi: '3.1.0',
      info: { title: 'Fal Queue API', version: '1.0.0' },
      paths: {
        '/fal-ai/example/video': {
          post: {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/RequestPayload',
                  },
                },
              },
            },
          },
        },
      } as Record<string, unknown>,
      components: {
        schemas: {
          RequestPayload: {
            type: 'object',
            required: ['prompt', 'resolution'],
            properties: {
              prompt: { type: 'string' },
              resolution: { $ref: '#/components/schemas/ResolutionEnum' },
              aspect_ratio: {
                allOf: [{ $ref: '#/components/schemas/AspectRatioEnum' }],
              },
              duration: {
                anyOf: [{ $ref: '#/components/schemas/DurationEnum' }],
              },
            },
          },
          ResolutionEnum: {
            enum: ['720p', '1080p', '4k'],
            default: '1080p',
          },
          AspectRatioEnum: {
            enum: ['16:9', '9:16'],
            default: '16:9',
          },
          DurationEnum: {
            oneOf: [{ const: '5s' }, { const: '8s' }],
            default: '8s',
          },
        },
      },
    }

    expect(extractFalEndpointCapabilities(schema)).toEqual({
      resolutionOptions: ['720p', '1080p', '4k'],
      aspectRatioOptions: ['16:9', '9:16'],
      durationOptions: ['5s', '8s'],
      defaults: {
        resolution: '1080p',
        aspect_ratio: '16:9',
        duration: '8s',
      },
      requiredFields: ['prompt', 'resolution'],
    })
  })

  it('ignores unrelated schemas when there is no usable input object', () => {
    const schema: FalOpenApiDocument = {
      openapi: '3.1.0',
      info: { title: 'Fal Queue API', version: '1.0.0' },
      paths: {},
      components: {
        schemas: {
          Output: {
            type: 'object',
            properties: {
              url: { type: 'string' },
            },
          },
        },
      },
    }

    expect(extractFalEndpointCapabilities(schema)).toEqual({
      resolutionOptions: [],
      aspectRatioOptions: [],
      durationOptions: [],
      defaults: {},
      requiredFields: [],
    })
  })

  it('falls back to inline requestBody schemas when components do not expose a usable input object', () => {
    const schema: FalOpenApiDocument = {
      openapi: '3.1.0',
      info: { title: 'Fal Queue API', version: '1.0.0' },
      paths: {
        '/fal-ai/example/image': {
          post: {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['prompt'],
                    properties: {
                      prompt: { type: 'string' },
                      resolution: {
                        enum: ['1K', '2K', '4K'],
                        default: '2K',
                      },
                      aspect_ratio: {
                        enum: ['1:1', '16:9'],
                        default: '16:9',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      } as Record<string, unknown>,
      components: {
        schemas: {
          Output: {
            type: 'object',
            properties: {
              url: { type: 'string' },
            },
          },
        },
      },
    }

    expect(extractFalEndpointCapabilities(schema)).toEqual({
      resolutionOptions: ['1K', '2K', '4K'],
      aspectRatioOptions: ['1:1', '16:9'],
      durationOptions: [],
      defaults: {
        resolution: '2K',
        aspect_ratio: '16:9',
      },
      requiredFields: ['prompt'],
    })
  })

  it('maps generic quality tiers to explicit provider resolution options', () => {
    expect(chooseFalCapabilityOption('high', ['1K', '2K', '4K'])).toBe('4K')
    expect(chooseFalCapabilityOption('medium', ['1K', '2K', '4K'])).toBe('2K')
    expect(chooseFalCapabilityOption('low', ['1K', '2K', '4K'])).toBe('1K')
    expect(chooseFalCapabilityOption('4K', ['1K', '2K', '4K'])).toBe('4K')
  })

  it('rounds video duration up to the nearest supported Fal duration option', () => {
    expect(normalizeFalDurationOption(6, ['4s', '6s', '8s'])).toBe('6s')
    expect(normalizeFalDurationOption(7, ['4s', '6s', '8s'])).toBe('8s')
    expect(normalizeFalDurationOption(11, ['4s', '6s', '8s'])).toBe('8s')
  })
})
