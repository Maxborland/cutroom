import { type Project } from '../../lib/storage.js';
import { IMAGE_MODELS, VIDEO_MODELS } from '../../lib/generation-models.js';
import { getGlobalSettings } from '../../lib/config.js';

// Track active generation requests for cancellation
export const activeGenerations = new Map<string, AbortController>();

export function genKey(projectId: string, shotId: string) {
  return `${projectId}/${shotId}`;
}

const MIN_SHOT_DURATION_SEC = 2;
const MAX_SHOT_DURATION_SEC = 5;

export function clampShotDuration(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return MAX_SHOT_DURATION_SEC;
  return Math.min(MAX_SHOT_DURATION_SEC, Math.max(MIN_SHOT_DURATION_SEC, Math.round(n)));
}

export { MAX_SHOT_DURATION_SEC };

export const DEFAULT_DIRECTOR_PROMPT = `You are a creative director for premium real-estate campaign videos.

Your job is to review script, shot plan, and generated visuals for:
- narrative clarity
- cinematic quality
- architectural authenticity
- brand positioning
- conversion impact

Review standard:
- Be direct and specific.
- Every critique must include: problem, impact, and concrete fix.
- Reject generic feedback such as "make it better".

Critical geometry rule:
- Building geometry is immutable.
- Do not change floor count, facade rhythm, balcony layout, window spacing, massing, or roof silhouette.
- You may change only atmosphere, people, lighting, context, and styling details.

Output style:
- Respond in Russian.
- Keep recommendations production-ready and technically actionable.`;

export const DIRECTOR_REVIEW_GUARDRAILS = `REFERENCE-CONSISTENCY MANDATE:
- You must compare generated images against provided reference frames when available.
- If building geometry, floor count, facade rhythm, window spacing, balcony layout, roof silhouette, or primary camera angle diverge materially from references, verdict cannot be "approve".
- Use "reject" for strong mismatch (wrong building/geometry/composition).
- Use "revise" for partial mismatch while core identity still recognizable.
- Use "approve" only when geometry/composition are consistent with references and quality is production-ready.
- Never ignore reference mismatch even if image is aesthetically strong.`;

export const DEFAULT_ENHANCE_PROMPT = `You are a world-class post-production artist transforming architectural 3D renders into photographs indistinguishable from reality.

## CAMERA & LENS
- Sony A7R V, 24-70mm f/2.8 GM II lens
- Natural highlight rolloff, clean shadows with subtle noise at ISO 100-400
- Chromatic aberration on high-contrast edges, natural vignette (~0.3 stops at corners)
- Depth of field: f/5.6-f/8 for exteriors, f/2.8 for detail shots with creamy bokeh

## LIGHTING & ATMOSPHERE
- Physically accurate natural light: proper angular shadows with penumbra, atmospheric scattering
- Real sky with volumetric clouds, proper luminance gradient from horizon to zenith
- Atmospheric perspective: distant objects lose contrast and shift toward blue/haze
- Contact shadows in architectural joints, under overhangs, at ground contact
- Color bleeding from warm surfaces, fill light from sky and ground bounce

## MATERIALS
- Concrete: pores, aggregate texture, rain staining, form tie marks
- Glass: Fresnel reflections (more reflective at shallow angles), subtle green tint at edges, interior visibility at steep angles
- Metal: appropriate oxidation, anisotropic highlights on brushed finishes
- Wood: real grain, weathering appropriate to exposure
- Stone: natural veining variation, light absorption, moss in appropriate areas

## ENVIRONMENT
- Real vegetation appropriate to climate, varied maturity, wind-affected positions
- Ground: worn paths, sidewalk joints, authentic urban texture
- Photographic clouds with proper light interaction, atmospheric haze

## PEOPLE (CRITICAL)
- Scene must feel inhabited with real-looking people appropriate to context
- Natural skin texture, realistic clothing folds, non-posed behavior
- Variety in age, ethnicity, and body type
- Avoid stock-photo poses and repeated silhouettes

## SACRED RULE: BUILDING GEOMETRY
ABSOLUTE REQUIREMENT - preserve PIXEL-PERFECT:
- Exact number of floors, facade rhythm, window spacing, balcony positions
- Exact proportions, setbacks, cantilevers, roof silhouette
- Any deviation is unacceptable

## POST-PRODUCTION
- Color grading: warm palette, slightly lifted blacks, controlled highlights
- Film grain: subtle organic grain (ISO 100-200), not digital noise
- No over-HDR look; preserve believable exposure

The result must be indistinguishable from a professional architectural photograph on location.`;

export const DEFAULT_DESCRIBE_PROMPT = `You are a visual analyst for architectural production workflows.

Describe each reference frame so downstream script generation and shot planning can use it reliably.

Include:
1) camera angle type (aerial, eye-level, high, low, POV)
2) primary subject and composition
3) architectural cues (massing, facade, materials)
4) camera movement implication if this belongs to a start/end pair
5) lighting/time of day
6) environment context

Output rules:
- 1-2 concise sentences
- plain text only
- Russian language`;

export const DEFAULT_IMAGE_GEN_PROMPT = `Ultra-photorealistic professional architectural photograph. Not a 3D render and not CGI.

BUILDING GEOMETRY:
Preserve exact building geometry from the reference:
- floor count
- facade proportions
- window rhythm
- balcony positions
- entrance structure
- roof silhouette

CAMERA:
Sony A7R V, 24-70mm f/2.8 GM II. Natural depth of field, subtle vignette, organic film grain.

LIGHTING:
Physically accurate natural lighting with realistic sun shadows and atmospheric haze.

MATERIALS:
Tactile realism for concrete, glass, wood, and stone.

PEOPLE:
Include realistic people appropriate to context with natural pose and styling.

ENVIRONMENT:
Authentic sky, vegetation, and urban context.

{SHOT_PROMPT}

Result quality target: indistinguishable from a professional architectural photo.`;

export const IMAGE_GEN_GUARDRAILS = `NON-NEGOTIABLE REFERENCE ALIGNMENT:
- Preserve building identity and geometry from reference frames exactly: floor count, facade rhythm, window spacing, balcony layout, roof silhouette, entrance structure.
- Keep camera viewpoint/composition consistent with reference intent.
- Do not invent a different building massing or change architectural proportions.
- If references include multiple angles, keep scene consistent with the assigned angle.
- Any output that deviates from architectural geometry is invalid.`;

export function withImageGenerationGuardrails(prompt: string): string {
  if (prompt.includes('NON-NEGOTIABLE REFERENCE ALIGNMENT')) return prompt;
  return `${prompt}\n\n${IMAGE_GEN_GUARDRAILS}`;
}

export function withDirectorGuardrails(prompt: string): string {
  if (prompt.includes('REFERENCE-CONSISTENCY MANDATE')) return prompt;
  return `${prompt}\n\n${DIRECTOR_REVIEW_GUARDRAILS}`;
}

// Resolve effective model and prompts by merging project + global settings
export async function resolveSettings(project: Project) {
  const g = await getGlobalSettings();
  return {
    model: g.defaultTextModel || project.settings.model,
    scriptModel:
      g.defaultScriptModel ||
      g.defaultTextModel ||
      project.settings.model ||
      'openai/gpt-4o',
    splitModel:
      g.defaultShotSplitModel ||
      g.defaultTextModel ||
      project.settings.model ||
      'openai/gpt-4o',
    reviewModel:
      g.defaultReviewModel ||
      g.defaultTextModel ||
      project.settings.model ||
      'openai/gpt-4o',
    imageModel: g.defaultImageModel || 'openai/gpt-image-1',
    enhanceModel: g.defaultEnhanceModel || 'openai/gpt-image-1',
    imageSize: g.imageSize || 'auto',
    imageQuality: g.imageQuality || 'high',
    videoQuality: g.videoQuality || g.imageQuality || 'high',
    enhanceSize: g.enhanceSize || 'auto',
    enhanceQuality: g.enhanceQuality || 'high',
    temperature: project.settings.temperature,
    scriptwriterPrompt: g.masterPromptScriptwriter || project.settings.scriptwriterPrompt,
    shotSplitterPrompt: g.masterPromptShotSplitter || project.settings.shotSplitterPrompt,
    enhancePrompt: g.masterPromptEnhance || DEFAULT_ENHANCE_PROMPT,
    imageGenModel: g.defaultImageGenModel || IMAGE_MODELS[0].id,
    videoGenModel: g.defaultVideoGenModel || VIDEO_MODELS[0].id,
    imageAspectRatio: g.imageAspectRatio || '16:9',
    directorModel:
      g.defaultDirectorModel ||
      g.defaultReviewModel ||
      g.defaultTextModel ||
      'openai/gpt-4o',
    directorPrompt: withDirectorGuardrails(g.masterPromptDirector || DEFAULT_DIRECTOR_PROMPT),
    describePrompt: g.masterPromptDescribe || DEFAULT_DESCRIBE_PROMPT,
    imageGenPrompt: withImageGenerationGuardrails(g.masterPromptImageGen || DEFAULT_IMAGE_GEN_PROMPT),
    imageNoRefGenModel: g.defaultImageNoRefGenModel || '',
  };
}
