export function getSortedElements(project) {
  return [...project.elements].sort((left, right) => left.zIndex - right.zIndex);
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
          feather: element.style.feather,
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
          interactionMix: element.shaderBinding.interactionMix,
          reactionMode: element.shaderBinding.reactionMode,
        });
      }

      if (element.roles.clip) {
        operations.push({
          type: "clip",
          elementId: element.id,
          feather: element.style.feather,
        });
      }

      if (element.roles.interactionField && element.interaction.enabled) {
        operations.push({
          type: "interactionField",
          elementId: element.id,
          alpha: element.interaction.alpha,
          color: element.interaction.color,
          distance: element.interaction.distance,
          pulse: element.interaction.pulse,
          swirl: element.interaction.swirl,
          influence: element.interaction.influence,
        });
      }
    });

  return operations;
}

export function buildInteractionSummary(project) {
  return getSortedElements(project)
    .filter(
      (element) =>
        element.enabled &&
        element.roles.interactionField &&
        element.interaction.enabled
    )
    .map((element) => ({
      elementId: element.id,
      sourceRole: element.roles.clip ? "clip" : "interactionField",
      geometry: element.geometry,
      alpha: element.interaction.alpha,
      color: element.interaction.color,
      distance: element.interaction.distance,
      feather: element.style.feather,
      pulse: element.interaction.pulse,
      swirl: element.interaction.swirl,
      influence: element.interaction.influence,
    }));
}

export function buildBoundarySummary(project) {
  return buildInteractionSummary(project);
}
