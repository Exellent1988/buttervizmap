const lineMatcher = /uniform sampler2D sampler_(?:.+?);/g;
const samplerMatcher = /uniform sampler2D sampler_(.+?);/;

export default class ShaderUtils {
  static checkShader(gl, shader, label = "shader") {
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? "(no info log)";
      console.error(`[Butterchurn] ${label} compile error:\n${log}`);
    }
  }

  static checkProgram(gl, program, label = "program") {
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? "(no info log)";
      console.error(`[Butterchurn] ${label} link error:\n${log}`);
    }
  }

  static getShaderParts(t) {
    const sbIndex = t.indexOf("shader_body");
    if (t && sbIndex > -1) {
      const beforeShaderBody = t.substring(0, sbIndex);
      const afterShaderBody = t.substring(sbIndex);
      const firstCurly = afterShaderBody.indexOf("{");
      const lastCurly = afterShaderBody.lastIndexOf("}");
      const shaderBody = afterShaderBody.substring(firstCurly + 1, lastCurly);
      return [beforeShaderBody, shaderBody];
    }

    return ["", t];
  }

  static getFragmentFloatPrecision(gl) {
    if (
      gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT).precision >
      0
    ) {
      return "highp";
    } else if (
      gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.MEDIUM_FLOAT)
        .precision > 0
    ) {
      return "mediump";
    }
    return "lowp";
  }

  static getUserSamplers(text) {
    const samplers = [];
    const lineMatches = text.match(lineMatcher);
    if (lineMatches && lineMatches.length > 0) {
      for (let i = 0; i < lineMatches.length; i++) {
        const samplerMatches = lineMatches[i].match(samplerMatcher);
        if (samplerMatches && samplerMatches.length > 0) {
          const sampler = samplerMatches[1];
          samplers.push({ sampler });
        }
      }
    }
    return samplers;
  }
}
