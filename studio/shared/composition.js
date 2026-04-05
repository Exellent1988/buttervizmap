export function getSortedElements(project) {
  return [...project.elements].sort((left, right) => left.zIndex - right.zIndex);
}

export function getElementCutterType(element) {
  if (!element?.enabled || !element?.roles) {
    return null;
  }

  if (element.roles.clip && !element.roles.interactionField) {
    return "maskCutter";
  }
  if (element.roles.clip && element.roles.interactionField) {
    return "booleanCutterNoFill";
  }
  if (!element.roles.clip && element.roles.interactionField) {
    return "booleanCutterWithFill";
  }

  return null;
}

export function buildRenderPlan(project) {
  const operations = [];

  if (project.globalLayer.enabled) {
    operations.push({
      type: "globalShader",
      presetId: project.globalLayer.presetId,
      opacity: project.globalLayer.opacity,
    });
  }

  getSortedElements(project)
    .filter((element) => element.enabled)
    .forEach((element) => {
      if (element.roles.paint) {
        operations.push({
          type: "paint",
          elementId: element.id,
          color: element.style.color,
          opacity: element.style.opacity,
        });
      }

      if (element.roles.shaderSurface && element.shaderBinding.enabled) {
        operations.push({
          type: "shaderSurface",
          elementId: element.id,
          presetId: element.shaderBinding.presetId,
          opacity: element.shaderBinding.opacity,
          blendMode: element.shaderBinding.blendMode,
          scale: element.shaderBinding.scale,
          offsetX: element.shaderBinding.offsetX,
          offsetY: element.shaderBinding.offsetY,
          rotation: element.shaderBinding.rotation,
        });
      }

      const cutterType = getElementCutterType(element);
      if (cutterType) {
        operations.push({
          type: cutterType,
          elementId: element.id,
        });
      }
    });

  return operations;
}

export function buildInteractionSummary(project) {
  return getSortedElements(project)
    .filter((element) => element.enabled)
    .map((element) => {
      const cutterType = getElementCutterType(element);
      if (!cutterType) {
        return null;
      }

      return {
        elementId: element.id,
        cutterType,
        geometry: element.geometry,
        color: element.style.color,
        hasShaderFill:
          cutterType === "booleanCutterWithFill" &&
          element.roles.shaderSurface &&
          element.shaderBinding?.enabled !== false,
      };
    })
    .filter(Boolean);
}

export function buildBoundarySummary(project) {
  return buildInteractionSummary(project);
}
