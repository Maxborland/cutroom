export interface FalOpenApiSchemaNode {
  type?: string
  const?: string | number | boolean
  enum?: Array<string | number | boolean>
  oneOf?: FalOpenApiSchemaNode[]
  anyOf?: FalOpenApiSchemaNode[]
  properties?: Record<string, FalOpenApiSchemaNode>
  required?: string[]
  default?: string | number | boolean
  title?: string
  [key: string]: unknown
}

export interface FalOpenApiDocument {
  openapi: string
  info?: {
    title?: string
    version?: string
  }
  paths?: Record<string, unknown>
  components?: {
    schemas?: Record<string, FalOpenApiSchemaNode>
  }
}

export interface FalEndpointCapabilities {
  resolutionOptions: string[]
  aspectRatioOptions: string[]
  durationOptions: string[]
  defaults: Record<string, string>
  requiredFields: string[]
}

const EMPTY_CAPABILITIES: FalEndpointCapabilities = {
  resolutionOptions: [],
  aspectRatioOptions: [],
  durationOptions: [],
  defaults: {},
  requiredFields: [],
}

const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000

type CachedSchemaEntry = {
  fetchedAt: number
  capabilities: FalEndpointCapabilities
}

const schemaCache = new Map<string, CachedSchemaEntry>()

function normalizeStringOptions(values: Array<string | number | boolean>): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const raw of values) {
    const value = String(raw ?? '').trim()
    if (!value) continue

    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(value)
  }

  return normalized
}

function toSeconds(value: string | number): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) return null

  const withSuffix = normalized.match(/^(\d+(?:\.\d+)?)s$/)
  if (withSuffix) {
    const parsed = Number.parseFloat(withSuffix[1])
    return Number.isFinite(parsed) ? parsed : null
  }

  const parsed = Number.parseFloat(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function collectNodeOptions(node: FalOpenApiSchemaNode | undefined): string[] {
  if (!node) return []

  const values: Array<string | number | boolean> = []

  if (node.const !== undefined) {
    values.push(node.const)
  }

  if (Array.isArray(node.enum)) {
    values.push(...node.enum)
  }

  if (Array.isArray(node.oneOf)) {
    for (const entry of node.oneOf) {
      values.push(...collectNodeOptions(entry))
    }
  }

  if (Array.isArray(node.anyOf)) {
    for (const entry of node.anyOf) {
      values.push(...collectNodeOptions(entry))
    }
  }

  return normalizeStringOptions(values)
}

function isLikelyInputSchema(name: string, schema: FalOpenApiSchemaNode): boolean {
  if (schema.type !== 'object' || !schema.properties) return false

  const normalizedName = name.toLowerCase()
  if (normalizedName.includes('input')) return true

  const propertyKeys = Object.keys(schema.properties).map((key) => key.toLowerCase())
  return propertyKeys.includes('prompt')
    || propertyKeys.includes('resolution')
    || propertyKeys.includes('aspect_ratio')
    || propertyKeys.includes('duration')
}

function findPrimaryInputSchema(document: FalOpenApiDocument): FalOpenApiSchemaNode | null {
  const schemas = document.components?.schemas
  if (!schemas) return null

  for (const [name, schema] of Object.entries(schemas)) {
    if (isLikelyInputSchema(name, schema)) {
      return schema
    }
  }

  return null
}

export function normalizeFalEndpointId(rawEndpointId: string): string {
  const value = String(rawEndpointId || '').trim()
  if (!value) return ''

  return value.startsWith('fal-endpoint:')
    ? value.slice('fal-endpoint:'.length)
    : value
}

export function extractFalEndpointCapabilities(document: FalOpenApiDocument): FalEndpointCapabilities {
  const inputSchema = findPrimaryInputSchema(document)
  if (!inputSchema?.properties) {
    return { ...EMPTY_CAPABILITIES }
  }

  const properties = inputSchema.properties
  const defaults: Record<string, string> = {}

  const resolutionNode = properties.resolution
  const aspectRatioNode = properties.aspect_ratio ?? properties.aspectRatio
  const durationNode = properties.duration

  for (const [field, node] of Object.entries({
    resolution: resolutionNode,
    aspect_ratio: aspectRatioNode,
    duration: durationNode,
  })) {
    if (node?.default !== undefined) {
      const value = String(node.default).trim()
      if (value) defaults[field] = value
    }
  }

  return {
    resolutionOptions: collectNodeOptions(resolutionNode),
    aspectRatioOptions: collectNodeOptions(aspectRatioNode),
    durationOptions: collectNodeOptions(durationNode),
    defaults,
    requiredFields: Array.isArray(inputSchema.required)
      ? inputSchema.required.map((entry) => String(entry)).filter(Boolean)
      : [],
  }
}

export function chooseFalCapabilityOption(
  requested: string | undefined,
  options: string[],
): string | undefined {
  const normalizedOptions = normalizeStringOptions(options)
  if (normalizedOptions.length === 0) return undefined

  const value = String(requested || '').trim()
  if (!value) {
    return normalizedOptions[normalizedOptions.length - 1]
  }

  const exact = normalizedOptions.find((option) => option.toLowerCase() === value.toLowerCase())
  if (exact) return exact

  const lowered = value.toLowerCase()
  if (lowered === 'low') return normalizedOptions[0]
  if (lowered === 'medium') return normalizedOptions[Math.floor((normalizedOptions.length - 1) / 2)]
  if (lowered === 'high') return normalizedOptions[normalizedOptions.length - 1]

  return undefined
}

export function normalizeFalDurationOption(
  requested: string | number | undefined,
  options: string[],
): string | undefined {
  const normalizedOptions = normalizeStringOptions(options)
  if (normalizedOptions.length === 0) return undefined
  if (requested === undefined) return normalizedOptions[normalizedOptions.length - 1]

  const requestedSeconds = toSeconds(requested)
  if (requestedSeconds === null) {
    return chooseFalCapabilityOption(String(requested), normalizedOptions)
  }

  const candidates = normalizedOptions
    .map((option) => ({ option, seconds: toSeconds(option) }))
    .filter((entry): entry is { option: string; seconds: number } => typeof entry.seconds === 'number')
    .sort((left, right) => left.seconds - right.seconds)

  if (candidates.length === 0) return normalizedOptions[normalizedOptions.length - 1]

  const ceiling = candidates.find((entry) => entry.seconds >= requestedSeconds)
  return ceiling?.option || candidates[candidates.length - 1].option
}

export async function fetchFalEndpointCapabilities(
  rawEndpointId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FalEndpointCapabilities> {
  const endpointId = normalizeFalEndpointId(rawEndpointId)
  if (!endpointId) {
    return { ...EMPTY_CAPABILITIES }
  }

  const cached = schemaCache.get(endpointId)
  if (cached && Date.now() - cached.fetchedAt < SCHEMA_CACHE_TTL_MS) {
    return cached.capabilities
  }

  const url = `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${encodeURIComponent(endpointId)}`
  const response = await fetchImpl(url)
  if (!response.ok) {
    throw new Error(`Fal OpenAPI error: ${response.status} (${endpointId})`)
  }

  const document = await response.json() as FalOpenApiDocument
  const capabilities = extractFalEndpointCapabilities(document)
  schemaCache.set(endpointId, {
    fetchedAt: Date.now(),
    capabilities,
  })

  return capabilities
}

export function resetFalSchemaCache(): void {
  schemaCache.clear()
}
