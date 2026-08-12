/* =========================================================================
 *  VOXELCRAFT — Moteur de rendu WebGL2
 *
 *  Trois passes de terrain : opaque -> cutout (alphaTest) -> translucide
 *  (tri arrière-avant, depth-write off). Le shader combine skylight,
 *  blocklight et AO par sommet ; la lumière solaire est modulée par l'heure.
 *  Brouillard exponentiel synchronisé à la distance de rendu, ciel en
 *  dégradé procédural + soleil/lune + étoiles.
 * ========================================================================= */
(function (root) {
  'use strict';

  /* ================================================= Utilitaires maths == */
  const M4 = {
    create() { return new Float32Array(16); },
    identity(o) { o.fill(0); o[0] = o[5] = o[10] = o[15] = 1; return o; },
    perspective(o, fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2);
      o.fill(0);
      o[0] = f / aspect; o[5] = f; o[11] = -1;
      o[10] = (far + near) / (near - far);
      o[14] = (2 * far * near) / (near - far);
      return o;
    },
    lookAt(o, eye, center, up) {
      let z0 = eye[0] - center[0], z1 = eye[1] - center[1], z2 = eye[2] - center[2];
      let len = 1 / Math.hypot(z0, z1, z2); z0 *= len; z1 *= len; z2 *= len;
      let x0 = up[1] * z2 - up[2] * z1, x1 = up[2] * z0 - up[0] * z2, x2 = up[0] * z1 - up[1] * z0;
      len = Math.hypot(x0, x1, x2);
      if (!len) { x0 = x1 = x2 = 0; } else { len = 1 / len; x0 *= len; x1 *= len; x2 *= len; }
      const y0 = z1 * x2 - z2 * x1, y1 = z2 * x0 - z0 * x2, y2 = z0 * x1 - z1 * x0;
      o[0] = x0; o[1] = y0; o[2] = z0; o[3] = 0;
      o[4] = x1; o[5] = y1; o[6] = z1; o[7] = 0;
      o[8] = x2; o[9] = y2; o[10] = z2; o[11] = 0;
      o[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
      o[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
      o[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
      o[15] = 1;
      return o;
    },
    multiply(o, a, b) {
      for (let i = 0; i < 4; i++) {
        const ai0 = a[i], ai1 = a[i + 4], ai2 = a[i + 8], ai3 = a[i + 12];
        o[i] = ai0 * b[0] + ai1 * b[1] + ai2 * b[2] + ai3 * b[3];
        o[i + 4] = ai0 * b[4] + ai1 * b[5] + ai2 * b[6] + ai3 * b[7];
        o[i + 8] = ai0 * b[8] + ai1 * b[9] + ai2 * b[10] + ai3 * b[11];
        o[i + 12] = ai0 * b[12] + ai1 * b[13] + ai2 * b[14] + ai3 * b[15];
      }
      return o;
    },
    translate(o, m, v) {
      if (o !== m) o.set(m);
      o[12] = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
      o[13] = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
      o[14] = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
      return o;
    },
    scale(o, m, v) {
      o[0] = m[0] * v[0]; o[1] = m[1] * v[0]; o[2] = m[2] * v[0]; o[3] = m[3] * v[0];
      o[4] = m[4] * v[1]; o[5] = m[5] * v[1]; o[6] = m[6] * v[1]; o[7] = m[7] * v[1];
      o[8] = m[8] * v[2]; o[9] = m[9] * v[2]; o[10] = m[10] * v[2]; o[11] = m[11] * v[2];
      o[12] = m[12]; o[13] = m[13]; o[14] = m[14]; o[15] = m[15];
      return o;
    },
    rotateY(o, m, r) {
      const s = Math.sin(r), c = Math.cos(r);
      const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
      const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
      if (o !== m) { o.set(m); }
      o[0] = a00 * c - a20 * s; o[1] = a01 * c - a21 * s; o[2] = a02 * c - a22 * s; o[3] = a03 * c - a23 * s;
      o[8] = a00 * s + a20 * c; o[9] = a01 * s + a21 * c; o[10] = a02 * s + a22 * c; o[11] = a03 * s + a23 * c;
      return o;
    },
    rotateX(o, m, r) {
      const s = Math.sin(r), c = Math.cos(r);
      const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
      const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
      if (o !== m) o.set(m);
      o[4] = a10 * c + a20 * s; o[5] = a11 * c + a21 * s; o[6] = a12 * c + a22 * s; o[7] = a13 * c + a23 * s;
      o[8] = a20 * c - a10 * s; o[9] = a21 * c - a11 * s; o[10] = a22 * c - a12 * s; o[11] = a23 * c - a13 * s;
      return o;
    },
    rotateZ(o, m, r) {
      const s = Math.sin(r), c = Math.cos(r);
      const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
      const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
      if (o !== m) o.set(m);
      o[0] = a00 * c + a10 * s; o[1] = a01 * c + a11 * s; o[2] = a02 * c + a12 * s; o[3] = a03 * c + a13 * s;
      o[4] = a10 * c - a00 * s; o[5] = a11 * c - a01 * s; o[6] = a12 * c - a02 * s; o[7] = a13 * c - a03 * s;
      return o;
    }
  };

  /* ==================================================== Shaders ========= */
  const VS_TERRAIN = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUV;
layout(location=2) in vec3 aLight;   // sky, block, ao*shade
layout(location=3) in vec3 aTint;

uniform mat4 uViewProj;
uniform vec3 uChunkOrigin;
uniform float uTime;
uniform int  uWave;                  // 1 = animation de surface (eau/feuilles)

out vec2 vUV;
out vec3 vLight;
out vec3 vTint;
out float vDist;
out vec3 vWorld;

void main(){
  vec3 wp = aPos + uChunkOrigin;
  if(uWave == 1){
    // ondulation sinusoïdale de la nappe d'eau (fraction de bloc)
    float w = sin(wp.x*0.55 + uTime*1.7) * cos(wp.z*0.55 + uTime*1.3);
    wp.y += w * 0.045;
  }
  vUV = aUV;
  vLight = aLight;
  vTint = aTint;
  vWorld = wp;
  gl_Position = uViewProj * vec4(wp, 1.0);
  vDist = gl_Position.w;
}`;

  const FS_TERRAIN = `#version 300 es
precision highp float;
in vec2 vUV;
in vec3 vLight;
in vec3 vTint;
in float vDist;
in vec3 vWorld;

uniform sampler2D uAtlas;
uniform vec3  uFogColor;
uniform float uFogStart;
uniform float uFogEnd;
uniform float uSunLight;      // 0..1 intensité du jour
uniform vec3  uSunTint;       // teinte de la lumière solaire
uniform float uAlphaTest;
uniform float uAlpha;         // opacité globale (eau)
uniform int   uUnderwater;

out vec4 fragColor;

void main(){
  vec4 tex = texture(uAtlas, vUV);
  if(tex.a < uAlphaTest) discard;

  // --- combinaison des deux canaux de lumière ---
  // courbe non linéaire : rend les niveaux bas plus lisibles (gamma vanilla)
  float sky = vLight.x;
  float blk = vLight.y;
  float ao  = vLight.z;

  float skyC = pow(sky, 1.45) * uSunLight;
  float blkC = pow(blk, 1.35);

  vec3 skyLight = skyC * uSunTint;
  vec3 blockLight = blkC * vec3(1.00, 0.78, 0.52);   // torche : chaud
  vec3 ambient = vec3(0.055, 0.062, 0.085);          // nuit / grottes

  vec3 light = max(skyLight, blockLight) + min(skyLight, blockLight) * 0.42 + ambient;
  light *= ao;

  vec3 col = tex.rgb * vTint * light;

  // reflet spéculaire léger sur l'eau
  if(uAlpha < 1.0){
    float f = pow(1.0 - abs(normalize(vWorld - vec3(0.0)).y), 2.0);
    col += vec3(0.06,0.09,0.13) * skyC;
  }

  // --- brouillard ---
  float fog = clamp((vDist - uFogStart) / max(0.001, uFogEnd - uFogStart), 0.0, 1.0);
  fog = fog * fog * (3.0 - 2.0 * fog);
  vec3 fc = uFogColor;
  if(uUnderwater == 1){
    fog = clamp((vDist - 2.0) / 22.0, 0.0, 1.0);
    fc = vec3(0.09, 0.22, 0.40);
  }
  col = mix(col, fc, fog);

  fragColor = vec4(col, tex.a * uAlpha);
}`;

  const VS_SKY = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
out vec2 vNDC;
void main(){ vNDC = aPos; gl_Position = vec4(aPos, 0.9999, 1.0); }`;

  const FS_SKY = `#version 300 es
precision highp float;
in vec2 vNDC;
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform float uSunLight;
uniform float uTime;
out vec4 fragColor;

// hash pour les étoiles
float h31(vec3 p){
  p = fract(p * 0.3183099 + vec3(0.71,0.113,0.419));
  p *= 17.0;
  return fract(p.x*p.y*p.z*(p.x+p.y+p.z));
}

void main(){
  vec4 nds = uInvViewProj * vec4(vNDC, 1.0, 1.0);
  vec3 dir = normalize(nds.xyz / nds.w - uCamPos);

  float t = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  float k = pow(clamp(dir.y, 0.0, 1.0), 0.55);
  vec3 col = mix(uSkyHorizon, uSkyTop, k);

  // halo solaire
  float sd = max(dot(dir, uSunDir), 0.0);
  col += vec3(1.0, 0.72, 0.38) * pow(sd, 8.0) * 0.55 * uSunLight;
  col += vec3(1.0, 0.92, 0.78) * pow(sd, 220.0) * 2.2;      // disque

  // lune (opposée)
  float md = max(dot(dir, -uSunDir), 0.0);
  col += vec3(0.85,0.88,1.0) * pow(md, 500.0) * 1.6 * (1.0 - uSunLight);

  // étoiles : uniquement la nuit, au-dessus de l'horizon
  float night = 1.0 - smoothstep(0.05, 0.35, uSunLight);
  if(night > 0.01 && dir.y > -0.05){
    vec3 g = floor(dir * 190.0);
    float s = h31(g);
    if(s > 0.9972){
      float tw = 0.6 + 0.4 * sin(uTime * 2.4 + s * 100.0);
      col += vec3(0.9,0.93,1.0) * night * tw * smoothstep(-0.05, 0.2, dir.y);
    }
  }
  fragColor = vec4(col, 1.0);
}`;

  const VS_LINE = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
uniform mat4 uViewProj;
uniform vec3 uOffset;
uniform vec3 uScale;
void main(){ gl_Position = uViewProj * vec4(aPos * uScale + uOffset, 1.0); }`;

  const FS_LINE = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 fragColor;
void main(){ fragColor = uColor; }`;

  // Quads pour entités / particules / item en main
  const VS_SPRITE = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUV;
uniform mat4 uMVP;
out vec2 vUV;
void main(){ vUV = aUV; gl_Position = uMVP * vec4(aPos, 1.0); }`;

  const FS_SPRITE = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uAtlas;
uniform vec4 uColor;
uniform float uAlphaTest;
uniform int uUseTex;
out vec4 fragColor;
void main(){
  vec4 c = uColor;
  if(uUseTex == 1){
    vec4 t = texture(uAtlas, vUV);
    if(t.a < uAlphaTest) discard;
    c *= t;
  }
  fragColor = c;
}`;

  /* ====================================================== Renderer ====== */
  function Renderer(canvas) {
    const gl = canvas.getContext('webgl2', {
      antialias: false, alpha: false, depth: true, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: false
    });
    if (!gl) throw new Error('WebGL2 non supporté par ce navigateur.');
    this.gl = gl;
    this.canvas = canvas;

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);

    this.progTerrain = this.program(VS_TERRAIN, FS_TERRAIN);
    this.progSky = this.program(VS_SKY, FS_SKY);
    this.progLine = this.program(VS_LINE, FS_LINE);
    this.progSprite = this.program(VS_SPRITE, FS_SPRITE);

    this.uT = this.uniforms(this.progTerrain,
      ['uViewProj', 'uChunkOrigin', 'uAtlas', 'uFogColor', 'uFogStart', 'uFogEnd',
        'uSunLight', 'uSunTint', 'uAlphaTest', 'uAlpha', 'uTime', 'uWave', 'uUnderwater']);
    this.uS = this.uniforms(this.progSky, ['uInvViewProj', 'uCamPos', 'uSunDir', 'uSkyTop', 'uSkyHorizon', 'uSunLight', 'uTime']);
    this.uL = this.uniforms(this.progLine, ['uViewProj', 'uColor', 'uOffset', 'uScale']);
    this.uP = this.uniforms(this.progSprite, ['uMVP', 'uAtlas', 'uColor', 'uAlphaTest', 'uUseTex']);

    this.initSkyQuad();
    this.initWireCube();
    this.initSpriteCube();

    this.proj = M4.create();
    this.view = M4.create();
    this.viewProj = M4.create();
    this.invViewProj = M4.create();
    this.tmp = M4.create();
    this.tmp2 = M4.create();

    this.drawCalls = 0;
    this.triangles = 0;
  }

  Renderer.prototype.shader = function (type, src) {
    const gl = this.gl;
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      console.error(src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n'));
      throw new Error('Shader: ' + log);
    }
    return s;
  };
  Renderer.prototype.program = function (vs, fs) {
    const gl = this.gl;
    const p = gl.createProgram();
    gl.attachShader(p, this.shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, this.shader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link: ' + gl.getProgramInfoLog(p));
    return p;
  };
  Renderer.prototype.uniforms = function (p, names) {
    const gl = this.gl, o = {};
    names.forEach(n => { o[n] = gl.getUniformLocation(p, n); });
    return o;
  };

  Renderer.prototype.initSkyQuad = function () {
    const gl = this.gl;
    this.skyVAO = gl.createVertexArray();
    gl.bindVertexArray(this.skyVAO);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  };

  Renderer.prototype.initWireCube = function () {
    const gl = this.gl;
    const v = [];
    const e = [[0, 0, 0, 1, 0, 0], [1, 0, 0, 1, 0, 1], [1, 0, 1, 0, 0, 1], [0, 0, 1, 0, 0, 0],
    [0, 1, 0, 1, 1, 0], [1, 1, 0, 1, 1, 1], [1, 1, 1, 0, 1, 1], [0, 1, 1, 0, 1, 0],
    [0, 0, 0, 0, 1, 0], [1, 0, 0, 1, 1, 0], [1, 0, 1, 1, 1, 1], [0, 0, 1, 0, 1, 1]];
    e.forEach(l => v.push(l[0], l[1], l[2], l[3], l[4], l[5]));
    this.wireVAO = gl.createVertexArray();
    gl.bindVertexArray(this.wireVAO);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.wireCount = v.length / 3;
  };

  /** Cube texturé unitaire (entités, items lâchés, item en main). */
  Renderer.prototype.initSpriteCube = function () {
    const gl = this.gl;
    const pos = [], uv = [], idx = [];
    const F = [
      [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
      [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
      [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
      [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
      [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
      [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]
    ];
    const U = [[0, 1], [1, 1], [1, 0], [0, 0]];
    for (let f = 0; f < 6; f++) {
      const base = f * 4;
      for (let v = 0; v < 4; v++) { pos.push(...F[f][v]); uv.push(...U[v]); }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    this.cubeVAO = gl.createVertexArray();
    gl.bindVertexArray(this.cubeVAO);
    const pb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    this.cubeUVBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cubeUVBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.cubeUV = new Float32Array(uv);
    this.cubeBaseUV = uv.slice();
  };

  /* -------------------------------------------------------- Texture ---- */
  Renderer.prototype.uploadAtlas = function (canvasSrc, mipmap) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvasSrc);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    if (mipmap) {
      // Mipmaps limités : évite le bleeding tout en réduisant l'aliasing lointain
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 3);
      const ext = gl.getExtension('EXT_texture_filter_anisotropic');
      if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT,
        Math.min(4, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.atlas = tex;
    return tex;
  };

  /* ---------------------------------------------------- Mesh de chunk -- */
  Renderer.prototype.createMesh = function (geo) {
    const gl = this.gl;
    if (!geo.count) return null;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const mk = (data, loc, size) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      return b;
    };
    const bp = mk(geo.pos, 0, 3);
    const bu = mk(geo.uv, 1, 2);
    const bl = mk(geo.lgt, 2, 3);
    const bt = mk(geo.tnt, 3, 3);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return {
      vao, count: geo.count, big: geo.big,
      type: geo.big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
      buffers: [bp, bu, bl, bt, ib]
    };
  };
  Renderer.prototype.deleteMesh = function (m) {
    if (!m) return;
    const gl = this.gl;
    m.buffers.forEach(b => gl.deleteBuffer(b));
    gl.deleteVertexArray(m.vao);
  };

  /* ------------------------------------------------------- Caméra ----- */
  Renderer.prototype.setCamera = function (pos, yaw, pitch, fov, aspect, near, far) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const dir = [-sy * cp, sp, -cy * cp];
    M4.perspective(this.proj, fov, aspect, near, far);
    M4.lookAt(this.view, pos, [pos[0] + dir[0], pos[1] + dir[1], pos[2] + dir[2]], [0, 1, 0]);
    M4.multiply(this.viewProj, this.proj, this.view);
    this.camPos = pos;
    this.camDir = dir;
    this.buildFrustum();
    return dir;
  };

  /** Extraction des 6 plans du frustum (Gribb-Hartmann). */
  Renderer.prototype.buildFrustum = function () {
    const m = this.viewProj;
    const p = this.frustum || (this.frustum = []);
    const add = (i, a, b, c, d) => { p[i] = [a, b, c, d]; };
    add(0, m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]);   // left
    add(1, m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);   // right
    add(2, m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]);   // bottom
    add(3, m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);   // top
    add(4, m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]);  // near
    add(5, m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]);  // far
    for (let i = 0; i < 6; i++) {
      const pl = p[i];
      const l = Math.hypot(pl[0], pl[1], pl[2]) || 1;
      pl[0] /= l; pl[1] /= l; pl[2] /= l; pl[3] /= l;
    }
  };
  Renderer.prototype.aabbVisible = function (x0, y0, z0, x1, y1, z1) {
    const p = this.frustum;
    for (let i = 0; i < 6; i++) {
      const pl = p[i];
      // sommet le plus positif par rapport au plan
      const vx = pl[0] >= 0 ? x1 : x0;
      const vy = pl[1] >= 0 ? y1 : y0;
      const vz = pl[2] >= 0 ? z1 : z0;
      if (pl[0] * vx + pl[1] * vy + pl[2] * vz + pl[3] < 0) return false;
    }
    return true;
  };

  /* ---------------------------------------------------------- Passes -- */
  Renderer.prototype.beginFrame = function (w, h, fogColor) {
    const gl = this.gl;
    gl.viewport(0, 0, w, h);
    gl.clearColor(fogColor[0], fogColor[1], fogColor[2], 1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.drawCalls = 0; this.triangles = 0;
  };

  Renderer.prototype.drawSky = function (env) {
    const gl = this.gl, u = this.uS;
    // inverse de viewProj : on reconstruit la direction du rayon par pixel
    invert(this.invViewProj, this.viewProj);
    gl.useProgram(this.progSky);
    gl.depthMask(false);
    gl.uniformMatrix4fv(u.uInvViewProj, false, this.invViewProj);
    gl.uniform3fv(u.uCamPos, this.camPos);
    gl.uniform3fv(u.uSunDir, env.sunDir);
    gl.uniform3fv(u.uSkyTop, env.skyTop);
    gl.uniform3fv(u.uSkyHorizon, env.skyHorizon);
    gl.uniform1f(u.uSunLight, env.sunLight);
    gl.uniform1f(u.uTime, env.time);
    gl.bindVertexArray(this.skyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    this.drawCalls++;
  };

  Renderer.prototype.beginTerrain = function (env) {
    const gl = this.gl, u = this.uT;
    gl.useProgram(this.progTerrain);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.uniform1i(u.uAtlas, 0);
    gl.uniformMatrix4fv(u.uViewProj, false, this.viewProj);
    gl.uniform3fv(u.uFogColor, env.fogColor);
    gl.uniform1f(u.uFogStart, env.fogStart);
    gl.uniform1f(u.uFogEnd, env.fogEnd);
    gl.uniform1f(u.uSunLight, env.sunLight);
    gl.uniform3fv(u.uSunTint, env.sunTint);
    gl.uniform1f(u.uTime, env.time);
    gl.uniform1i(u.uUnderwater, env.underwater ? 1 : 0);
  };

  Renderer.prototype.drawChunkLayer = function (mesh, ox, oy, oz, opts) {
    if (!mesh) return;
    const gl = this.gl, u = this.uT;
    gl.uniform3f(u.uChunkOrigin, ox, oy, oz);
    gl.uniform1f(u.uAlphaTest, opts.alphaTest || 0);
    gl.uniform1f(u.uAlpha, opts.alpha === undefined ? 1 : opts.alpha);
    gl.uniform1i(u.uWave, opts.wave ? 1 : 0);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, mesh.type, 0);
    this.drawCalls++; this.triangles += mesh.count / 3;
  };

  Renderer.prototype.drawSelection = function (x, y, z, phase) {
    const gl = this.gl, u = this.uL;
    gl.useProgram(this.progLine);
    gl.uniformMatrix4fv(u.uViewProj, false, this.viewProj);
    const e = 0.003;
    gl.uniform3f(u.uOffset, x - e, y - e, z - e);
    gl.uniform3f(u.uScale, 1 + 2 * e, 1 + 2 * e, 1 + 2 * e);
    gl.uniform4f(u.uColor, 0, 0, 0, 0.55);
    gl.bindVertexArray(this.wireVAO);
    gl.disable(gl.CULL_FACE);
    gl.drawArrays(gl.LINES, 0, this.wireCount);
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(null);
    this.drawCalls++;
  };

  /** Cube texturé arbitraire (mob, item au sol, main). */
  Renderer.prototype.drawCube = function (mvp, uvRects, color, useTex, alphaTest) {
    const gl = this.gl, u = this.uP;
    gl.useProgram(this.progSprite);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.uniform1i(u.uAtlas, 0);
    gl.uniformMatrix4fv(u.uMVP, false, mvp);
    gl.uniform4fv(u.uColor, color);
    gl.uniform1i(u.uUseTex, useTex ? 1 : 0);
    gl.uniform1f(u.uAlphaTest, alphaTest || 0);
    if (uvRects) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cubeUVBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, uvRects);
    }
    gl.bindVertexArray(this.cubeVAO);
    gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
    this.drawCalls++; this.triangles += 12;
  };

  /* ---------------------------------------------- Inversion de matrice */
  function invert(out, a) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1.0 / det;
    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return out;
  }

  root.VCRender = { Renderer, M4, invert };
})(typeof self !== 'undefined' ? self : this);
