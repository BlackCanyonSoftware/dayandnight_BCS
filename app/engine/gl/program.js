// @ts-check
/**
 * Shader compilation and uniform plumbing.
 *
 * Small on purpose. This is the layer a WebGPU backend would replace
 * (ADR 0003), so nothing above it should know what a `WebGLProgram` is.
 *
 * @module engine/gl/program
 */

/**
 * @typedef {object} Program
 * @property {WebGLProgram} program
 * @property {(name: string) => WebGLUniformLocation | null} uniform
 * @property {() => void} use
 * @property {() => void} dispose
 */

/**
 * Compile and link a program, with compile errors that say where they are.
 *
 * A shader that fails to compile is a developer error, not a user error, so it
 * throws loudly with the driver's log and the offending source line rather
 * than degrading. In a packaged build this surfaces as a report the user can
 * save (see the logging note in docs/ARCHITECTURE.md).
 *
 * @param {WebGL2RenderingContext} gl
 * @param {string} vertexSource
 * @param {string} fragmentSource
 * @param {string} [label] used in error messages
 * @returns {Program}
 */
export function createProgram(gl, vertexSource, fragmentSource, label = "program") {
  const vs = compile(gl, gl.VERTEX_SHADER, vertexSource, `${label}.vert`);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource, `${label}.frag`);

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  // The shaders can be detached and deleted as soon as the program is linked;
  // the program keeps what it needs.
  gl.detachShader(program, vs);
  gl.detachShader(program, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "(no log)";
    gl.deleteProgram(program);
    throw new Error(`Linking ${label} failed:\n${log}`);
  }

  /** @type {Map<string, WebGLUniformLocation | null>} */
  const uniforms = new Map();

  return {
    program,

    /** Uniform locations are looked up once and cached; the lookup is not free. */
    uniform(name) {
      if (!uniforms.has(name)) uniforms.set(name, gl.getUniformLocation(program, name));
      return uniforms.get(name) ?? null;
    },

    use() {
      gl.useProgram(program);
    },

    dispose() {
      uniforms.clear();
      gl.deleteProgram(program);
    }
  };
}

/**
 * A vertex buffer holding one full-screen triangle in clip space.
 *
 * A triangle rather than a quad: a single triangle large enough to cover the
 * viewport rasterises in one primitive with no shared edge down the middle,
 * where a two-triangle quad makes the GPU process that diagonal twice.
 *
 * @param {WebGL2RenderingContext} gl
 * @returns {{ bind: () => void, draw: () => void, dispose: () => void }}
 */
export function createFullScreenTriangle(gl) {
  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  return {
    bind() {
      gl.bindVertexArray(vao);
    },
    draw() {
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
    }
  };
}

/* ------------------------------------------------------------------ private */

/**
 * @param {WebGL2RenderingContext} gl
 * @param {number} type
 * @param {string} source
 * @param {string} label
 * @returns {WebGLShader}
 */
function compile(gl, type, source, label) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`Could not create a shader object for ${label}.`);

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "(no log)";
    gl.deleteShader(shader);
    throw new Error(`Compiling ${label} failed:\n${log}\n${numberLines(source)}`);
  }

  return shader;
}

/**
 * Source with line numbers, so a driver log that says "line 42" is useful.
 * @param {string} source
 * @returns {string}
 */
function numberLines(source) {
  return source
    .split("\n")
    .map((line, i) => `${String(i + 1).padStart(4)} | ${line}`)
    .join("\n");
}
