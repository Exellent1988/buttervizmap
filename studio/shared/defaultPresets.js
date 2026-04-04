import blankPreset from "../../src/blankPreset.js";

function cloneWaveOrShape(entry) {
  return {
    ...entry,
    baseVals: { ...entry.baseVals },
  };
}

function clonePresetTemplate(preset) {
  return {
    ...preset,
    baseVals: { ...preset.baseVals },
    waves: preset.waves.map(cloneWaveOrShape),
    shapes: preset.shapes.map(cloneWaveOrShape),
  };
}

function createAuroraGridPreset() {
  const preset = clonePresetTemplate(blankPreset);
  preset.baseVals.wave_r = 0.18;
  preset.baseVals.wave_g = 0.88;
  preset.baseVals.wave_b = 0.74;
  preset.baseVals.wave_a = 0.78;
  preset.baseVals.zoom = 1.035;
  preset.baseVals.rot = 0.02;
  preset.baseVals.warp = 0.22;
  preset.baseVals.warpscale = 0.72;
  preset.baseVals.decay = 0.96;
  preset.baseVals.mv_a = 0.18;
  preset.warp = `shader_body {
ret = texture(sampler_main, uv).rgb;
ret += 0.06 * vec3(sin(time + uv.x * 10.0), cos(time * 0.7 + uv.y * 9.0), sin(time * 0.5));
ret = max(ret - 0.01, 0.0);
}`;
  preset.comp = `shader_body {
vec3 base = texture(sampler_main, uv).rgb;
vec3 glow = texture(sampler_blur1, uv).rgb;
ret = mix(base, glow * vec3(0.8, 1.1, 1.0), 0.28);
}`;
  return preset;
}

function createNebulaPulsePreset() {
  const preset = clonePresetTemplate(blankPreset);
  preset.baseVals.wave_r = 0.95;
  preset.baseVals.wave_g = 0.4;
  preset.baseVals.wave_b = 0.92;
  preset.baseVals.wave_a = 0.66;
  preset.baseVals.zoom = 1.02;
  preset.baseVals.rot = -0.01;
  preset.baseVals.warp = 0.3;
  preset.baseVals.warpscale = 0.48;
  preset.baseVals.decay = 0.97;
  preset.baseVals.echo_alpha = 0.08;
  preset.baseVals.echo_zoom = 1.01;
  preset.warp = `shader_body {
vec2 drift = vec2(sin(time * 0.3 + uv.y * 8.0), cos(time * 0.4 + uv.x * 7.0)) * texsize.zw * 24.0;
vec3 base = texture(sampler_main, uv + drift).rgb;
ret = max(base * 0.98, texture(sampler_main, uv).rgb * 0.85);
}`;
  preset.comp = `shader_body {
vec3 base = texture(sampler_main, uv).rgb;
vec3 blur = texture(sampler_blur1, uv).rgb;
ret = base + blur * vec3(0.25, 0.08, 0.3);
}`;
  return preset;
}

function createSolarCurtainPreset() {
  const preset = clonePresetTemplate(blankPreset);
  preset.baseVals.wave_r = 1.0;
  preset.baseVals.wave_g = 0.65;
  preset.baseVals.wave_b = 0.14;
  preset.baseVals.wave_a = 0.72;
  preset.baseVals.zoom = 1.04;
  preset.baseVals.rot = 0.018;
  preset.baseVals.warp = 0.15;
  preset.baseVals.warpscale = 1.24;
  preset.baseVals.decay = 0.95;
  preset.baseVals.solarize = 0.05;
  preset.warp = `shader_body {
vec3 base = texture(sampler_main, uv).rgb;
float band = 0.5 + 0.5 * sin(time * 0.9 + uv.y * 18.0);
ret = mix(base, vec3(1.0, 0.55, 0.18) * band, 0.16);
}`;
  preset.comp = `shader_body {
vec3 base = texture(sampler_main, uv).rgb;
ret = base * vec3(1.05, 0.96, 0.8);
}`;
  return preset;
}

function createMonochromeScopePreset() {
  const preset = clonePresetTemplate(blankPreset);
  preset.baseVals.wave_r = 0.96;
  preset.baseVals.wave_g = 0.96;
  preset.baseVals.wave_b = 1.0;
  preset.baseVals.wave_a = 0.44;
  preset.baseVals.zoom = 1.008;
  preset.baseVals.rot = -0.004;
  preset.baseVals.warp = 0.08;
  preset.baseVals.warpscale = 0.22;
  preset.baseVals.decay = 0.985;
  preset.baseVals.mv_x = 13.0;
  preset.baseVals.mv_y = 11.0;
  preset.baseVals.mv_l = 0.15;
  preset.warp = `shader_body {
vec3 base = texture(sampler_main, uv).rgb;
float sweep = 0.5 + 0.5 * sin(time * 1.3 + uv.y * 42.0);
ret = mix(base, vec3(sweep), 0.08);
}`;
  preset.comp = `shader_body {
vec3 base = texture(sampler_main, uv).rgb;
float scan = 0.92 + 0.08 * sin(uv.y * 210.0);
ret = base * vec3(scan);
}`;
  return preset;
}

function createTidalBloomPreset() {
  const preset = clonePresetTemplate(blankPreset);
  preset.baseVals.wave_r = 0.22;
  preset.baseVals.wave_g = 0.55;
  preset.baseVals.wave_b = 1.0;
  preset.baseVals.wave_a = 0.74;
  preset.baseVals.zoom = 1.028;
  preset.baseVals.rot = 0.01;
  preset.baseVals.warp = 0.26;
  preset.baseVals.warpscale = 0.95;
  preset.baseVals.decay = 0.968;
  preset.baseVals.echo_alpha = 0.06;
  preset.warp = `shader_body {
vec2 flow = vec2(cos(time * 0.25 + uv.y * 10.0), sin(time * 0.35 + uv.x * 8.0)) * texsize.zw * 20.0;
vec3 shifted = texture(sampler_main, uv + flow).rgb;
ret = mix(texture(sampler_main, uv).rgb, shifted, 0.22);
}`;
  preset.comp = `shader_body {
vec3 base = texture(sampler_main, uv).rgb;
vec3 blur = texture(sampler_blur1, uv).rgb;
ret = mix(base, blur * vec3(0.4, 0.7, 1.15), 0.3);
}`;
  return preset;
}

function createEmberReactorPreset() {
  const preset = clonePresetTemplate(blankPreset);
  preset.baseVals.wave_r = 1.0;
  preset.baseVals.wave_g = 0.22;
  preset.baseVals.wave_b = 0.18;
  preset.baseVals.wave_a = 0.82;
  preset.baseVals.zoom = 1.045;
  preset.baseVals.rot = 0.028;
  preset.baseVals.warp = 0.34;
  preset.baseVals.warpscale = 0.58;
  preset.baseVals.decay = 0.958;
  preset.baseVals.solarize = 0.11;
  preset.warp = `shader_body {
vec3 base = texture(sampler_main, uv).rgb;
float pulse = 0.45 + 0.55 * sin(time * 1.1 + (uv.x + uv.y) * 14.0);
ret = mix(base, vec3(1.0, 0.28, 0.1) * pulse, 0.18);
}`;
  preset.comp = `shader_body {
vec3 base = texture(sampler_main, uv).rgb;
vec3 blur = texture(sampler_blur1, uv).rgb;
ret = base + blur * vec3(0.35, 0.08, 0.02);
}`;
  return preset;
}

export const BUILTIN_PRESET_TEMPLATES = {
  "aurora-grid": {
    id: "aurora-grid",
    name: "Aurora Grid",
    description: "Cool cyan drift with mild blur bloom.",
    createPreset: createAuroraGridPreset,
  },
  "nebula-pulse": {
    id: "nebula-pulse",
    name: "Nebula Pulse",
    description: "Magenta-biased bloom and soft temporal drift.",
    createPreset: createNebulaPulsePreset,
  },
  "solar-curtain": {
    id: "solar-curtain",
    name: "Solar Curtain",
    description: "Warm amber bands with restrained motion.",
    createPreset: createSolarCurtainPreset,
  },
  "monochrome-scope": {
    id: "monochrome-scope",
    name: "Monochrome Scope",
    description: "High-contrast grayscale scan with restrained motion.",
    createPreset: createMonochromeScopePreset,
  },
  "tidal-bloom": {
    id: "tidal-bloom",
    name: "Tidal Bloom",
    description: "Cool blue flow with blur-heavy bloom.",
    createPreset: createTidalBloomPreset,
  },
  "ember-reactor": {
    id: "ember-reactor",
    name: "Ember Reactor",
    description: "Hot red-orange pulse with aggressive bloom.",
    createPreset: createEmberReactorPreset,
  },
};

export function createBuiltinLibraryEntries() {
  return [
    {
      id: "solid-color",
      name: "Solid Color",
      sourceType: "solid",
      sourcePresetId: "solid-color",
      overrides: {
        baseColor: "#101820",
      },
      meta: {
        category: "special",
        author: "Studio",
        curated: true,
      },
    },
    ...Object.values(BUILTIN_PRESET_TEMPLATES).map((template) => ({
      id: template.id,
      name: template.name,
      sourceType: "builtin",
      sourcePresetId: template.id,
      overrides: {},
      meta: {
        category: "studio",
        author: "Studio",
        curated: true,
        description: template.description,
      },
    })),
  ];
}

function applyOverrideBlock(target, overrides) {
  if (!overrides || typeof overrides !== "object") {
    return;
  }

  Object.entries(overrides).forEach(([key, value]) => {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      applyOverrideBlock(target[key], value);
    } else {
      target[key] = value;
    }
  });
}

export function materializePresetDefinition(libraryPreset) {
  const template = BUILTIN_PRESET_TEMPLATES[libraryPreset.sourcePresetId];
  if (!template) {
    throw new Error(`Unknown preset template: ${libraryPreset.sourcePresetId}`);
  }

  const preset = template.createPreset();
  applyOverrideBlock(preset, libraryPreset.overrides);
  return preset;
}
