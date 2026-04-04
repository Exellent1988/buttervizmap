function parseHexColor(hex) {
  const normalized = hex.replace("#", "");
  const sixChar = normalized.length === 3
    ? normalized
        .split("")
        .map((char) => `${char}${char}`)
        .join("")
    : normalized.padEnd(6, "0").slice(0, 6);

  return {
    r: parseInt(sixChar.slice(0, 2), 16),
    g: parseInt(sixChar.slice(2, 4), 16),
    b: parseInt(sixChar.slice(4, 6), 16),
  };
}

function getAudioEnergy(audioFrame) {
  if (!audioFrame) {
    return 0.25;
  }

  let total = 0;
  const samples = audioFrame.timeByteArray;
  for (let index = 0; index < samples.length; index += 16) {
    total += Math.abs(samples[index] - 128) / 128;
  }

  return Math.min(1, total / (samples.length / 16));
}

function colorFromPresetId(presetId) {
  const seed = Array.from(String(presetId)).reduce(
    (accumulator, character) => accumulator + character.charCodeAt(0),
    0
  );

  return {
    r: 80 + (seed * 37) % 140,
    g: 70 + (seed * 17) % 150,
    b: 90 + (seed * 29) % 130,
  };
}

function getPresetSeed(presetId) {
  return Array.from(String(presetId)).reduce(
    (accumulator, character, index) =>
      accumulator + character.charCodeAt(0) * (index + 17),
    0
  );
}

function getPatternMode(presetId) {
  const normalized = String(presetId).toLowerCase();
  if (normalized.includes("scope") || normalized.includes("mono")) {
    return "scanlines";
  }
  if (normalized.includes("ember") || normalized.includes("solar")) {
    return "rays";
  }
  if (normalized.includes("nebula") || normalized.includes("bloom")) {
    return "orbits";
  }
  if (normalized.includes("tidal") || normalized.includes("wave")) {
    return "ribbons";
  }
  return ["orbits", "scanlines", "ribbons", "rays"][getPresetSeed(presetId) % 4];
}

export class MockRenderer {
  constructor(width, height) {
    this.canvas = document.createElement("canvas");
    this.context = this.canvas.getContext("2d");
    this.resize(width, height);
    this.presetId = "aurora-grid";
    this.projectPreset = null;
  }

  resize(width, height) {
    if (this.canvas.width === width && this.canvas.height === height) {
      return;
    }
    this.canvas.width = width;
    this.canvas.height = height;
  }

  loadPreset(preset) {
    this.projectPreset = preset;
    this.presetId = preset.id;
  }

  render({ timestamp, audioFrame, interactionSummary }) {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const context = this.context;
    const energy = getAudioEnergy(audioFrame);
    const namedColor = {
      "aurora-grid": "#58d1c9",
      "nebula-pulse": "#ca6fe5",
      "solar-curtain": "#ff9a4d",
    }[this.presetId];
    const baseColor = this.projectPreset?.overrides?.baseColor
      ? parseHexColor(this.projectPreset.overrides.baseColor)
      : namedColor
        ? parseHexColor(namedColor)
        : colorFromPresetId(this.projectPreset?.sourcePresetId ?? this.presetId);
    const patternMode = getPatternMode(this.projectPreset?.sourcePresetId ?? this.presetId);
    const seed = getPresetSeed(this.projectPreset?.sourcePresetId ?? this.presetId);

    if (this.projectPreset?.sourceType === "solid") {
      context.clearRect(0, 0, width, height);
      context.fillStyle = `rgb(${baseColor.r}, ${baseColor.g}, ${baseColor.b})`;
      context.fillRect(0, 0, width, height);
      return;
    }

    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(
      0,
      `rgba(${baseColor.r}, ${Math.min(255, baseColor.g + 10)}, ${baseColor.b}, 1)`
    );
    gradient.addColorStop(
      0.55,
      `rgba(${Math.max(0, baseColor.r - 55)}, ${Math.max(0, baseColor.g - 30)}, ${Math.min(255, baseColor.b + 40)}, 1)`
    );
    gradient.addColorStop(1, "rgba(4, 12, 20, 1)");

    context.clearRect(0, 0, width, height);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    if (patternMode === "orbits") {
      const ringCount = 6;
      for (let index = 0; index < ringCount; index += 1) {
        const progress = index / ringCount;
        const radius =
          (0.18 + progress * 0.6 + Math.sin(timestamp * 0.0015 + progress * 9) * 0.03) *
          Math.min(width, height);

        context.strokeStyle = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${0.16 + energy * 0.15})`;
        context.lineWidth = 8 + progress * 6;
        context.beginPath();
        context.arc(
          width * (0.5 + Math.sin(timestamp * 0.0004 + index) * 0.08),
          height * (0.5 + Math.cos(timestamp * 0.0003 + index) * 0.08),
          radius,
          0,
          Math.PI * 2
        );
        context.stroke();
      }
    } else if (patternMode === "scanlines") {
      const lineCount = 18;
      for (let index = 0; index < lineCount; index += 1) {
        const progress = index / Math.max(1, lineCount - 1);
        const y =
          progress * height +
          Math.sin(timestamp * 0.0011 + progress * 18 + seed * 0.001) * 14 * (0.4 + energy);
        context.fillStyle = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${0.08 + progress * 0.16})`;
        context.fillRect(0, y, width, 2 + progress * 10);
      }

      context.strokeStyle = `rgba(255,255,255,${0.08 + energy * 0.12})`;
      context.lineWidth = 1.5;
      for (let index = 0; index < 9; index += 1) {
        const x = ((index + 1) / 10) * width;
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x + Math.sin(timestamp * 0.001 + index) * 24, height);
        context.stroke();
      }
    } else if (patternMode === "ribbons") {
      const ribbonCount = 5;
      for (let index = 0; index < ribbonCount; index += 1) {
        context.beginPath();
        for (let step = 0; step <= 48; step += 1) {
          const progress = step / 48;
          const x = progress * width;
          const y =
            height * (0.18 + index * 0.16) +
            Math.sin(progress * 16 + timestamp * 0.0013 + index * 1.7) *
              height *
              (0.035 + energy * 0.03);
          if (step === 0) {
            context.moveTo(x, y);
          } else {
            context.lineTo(x, y);
          }
        }
        context.strokeStyle = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${0.16 + index * 0.05})`;
        context.lineWidth = 10 + index * 5;
        context.stroke();
      }
    } else if (patternMode === "rays") {
      const rayCount = 22;
      const centerX = width * 0.5;
      const centerY = height * 0.5;
      for (let index = 0; index < rayCount; index += 1) {
        const angle =
          (index / rayCount) * Math.PI * 2 +
          timestamp * 0.00016 +
          Math.sin(timestamp * 0.0009 + index) * 0.08;
        const radius = Math.min(width, height) * (0.3 + energy * 0.24 + (index % 3) * 0.08);
        context.strokeStyle = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${0.12 + energy * 0.18})`;
        context.lineWidth = 4 + (index % 4) * 3;
        context.beginPath();
        context.moveTo(centerX, centerY);
        context.lineTo(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
        context.stroke();
      }
    }

    interactionSummary.forEach((field, index) => {
      const centroid = field.centroid;
      const radius =
        Math.max(50, Math.min(width, height) * field.maxDistance * (0.8 + field.distance));
      const color = parseHexColor(field.color);
      const gradientFill = context.createRadialGradient(
        centroid.x * width,
        centroid.y * height,
        0,
        centroid.x * width,
        centroid.y * height,
        radius
      );
      gradientFill.addColorStop(
        0,
        `rgba(${color.r}, ${color.g}, ${color.b}, ${0.28 + field.alpha * 0.22})`
      );
      gradientFill.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
      context.fillStyle = gradientFill;
      context.beginPath();
      context.arc(centroid.x * width, centroid.y * height, radius, 0, Math.PI * 2);
      context.fill();

      context.fillStyle = `rgba(255, 255, 255, ${0.05 + index * 0.015})`;
      context.fillRect(
        0,
        ((index + 1) / (interactionSummary.length + 1)) * height * 0.85,
        width,
        2 + energy * 8
      );
    });
  }

  getCanvas() {
    return this.canvas;
  }
}
