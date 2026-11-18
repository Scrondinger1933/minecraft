/* ===========================================================================
 * L'ARÈNE ÉTEINTE — rendu WebGL 2
 *
 * Trois programmes GLSL ES 3.00 :
 *   · monde    : voxel éclairé par torches (boucles bornées) + torche
 *                frontale à cône doux, brume exponentielle, découpe alpha ;
 *   · entités  : cubes composés (mains, gardiens, boss, particules) via
 *                matrice de modèle par membre ;
 *   · post     : vignette, grain de pellicule, aberration chromatique et
 *                désaturation pilotées par la PEUR du joueur.
 * L'atlas de textures est dessiné procéduralement au canvas (6×6 tiles,
 * 32 px) — aucun actif graphique externe, aucune image fournie.
 *
 * Publie l'objet global : HR. Dépend de HM (tiles), HNoise.
 * ========================================================================= */
(function () {
  'use strict';

  var API = {};
  globalThis.HR = API;
  var gl = null, cnv = null;

  /* ------------------------------------------------------------- mat4 ---- */
  function m4() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
  function mul(a, b) {
    var o = new Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }
  function perspective(fov, aspect, near, far) {
    var f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  function translate(m, x, y, z) {
    var t = m4();
    t[12] = x; t[13] = y; t[14] = z;
    return mul(m, t);
  }
  function rotY(m, a) {
    var c = Math.cos(a), s = Math.sin(a);
    var r = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
    return mul(m, r);
  }
  function rotX(m, a) {
    var c = Math.cos(a), s = Math.sin(a);
    var r = [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
    return mul(m, r);
  }
  function rotZ(m, a) {
    var c = Math.cos(a), s = Math.sin(a);
    var r = [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    return mul(m, r);
  }
  function scale(m, x, y, z) {
    var t = [x,0,0,0, 0,y,0,0, 0,0,z,0, 0,0,0,1];
    return mul(m, t);
  }
  API.mat = { m4: m4, mul: mul, perspective: perspective, translate: translate,
              rotY: rotY, rotX: rotX, rotZ: rotZ, scale: scale };

  /* ------------------------------------------------------------- shaders -- */
  var VS_WORLD = [
    '#version 300 es',
    'layout(location=0) in vec3 aPos;',
    'layout(location=1) in vec2 aUV;',
    'layout(location=2) in float aAO;',
    'layout(location=3) in float aEM;',
    'uniform mat4 uVP;',
    'out vec2 vUV; out float vAO; out float vEM; out vec3 vPos;',
    'void main(){ vUV=aUV; vAO=aAO; vEM=aEM; vPos=aPos;',
    ' gl_Position = uVP * vec4(aPos, 1.0); }'
  ].join('\n');

  var FS_WORLD = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUV; in float vAO; in float vEM; in vec3 vPos;',
    'uniform sampler2D uAtlas;',
    'uniform vec3 uCam;',
    'uniform vec4 uLampP[14];',
    'uniform vec3 uLampC[14];',
    'uniform int uLampN;',
    'uniform vec3 uFlashPos; uniform vec3 uFlashDir;',
    'uniform float uFlashPow;',
    'uniform vec3 uFogC; uniform float uFogK;',
    'uniform float uAmb; uniform float uTime;',
    'out vec4 frag;',
    'void main(){',
    '  vec4 tex = texture(uAtlas, vUV);',
    '  if (tex.a < 0.5) discard;',
    '  vec3 col = tex.rgb * (0.35 + 0.65 * vAO);',
    '  vec3 add = vec3(0.0);',
    '  for (int i = 0; i < 14; i++) {',
    '    if (i >= uLampN) break;',
    '    float d = distance(vPos, uLampP[i].xyz);',
    '    float att = clamp(1.0 - d / max(uLampP[i].w, 0.01), 0.0, 1.0);',
    '    add += uLampC[i] * (att * att);',
    '  }',
    '  vec3 fd = vPos - uFlashPos;',
    '  float dist = length(fd);',
    '  float ang = dot(fd / max(dist, 0.001), uFlashDir);',
    '  float cone = smoothstep(0.70, 0.92, ang);',
    '  float fall = clamp(1.0 - dist / 24.0, 0.0, 1.0);',
    '  add += vec3(1.0, 0.93, 0.80) * (cone * fall * fall * uFlashPow * 2.6);',
    '  float sh = 0.55 + 0.45 * vAO;',
    '  col = col * (uAmb + add * sh);',
    '  col += tex.rgb * vEM * (1.0 + 0.22 * sin(uTime * 6.3 + vPos.x * 2.7 + vPos.z * 1.9));',
    '  float dcam = distance(vPos, uCam);',
    '  float fog = exp(-uFogK * dcam * dcam);',
    '  col = mix(uFogC, col, clamp(fog, 0.0, 1.0));',
    '  frag = vec4(col, 1.0);',
    '}'
  ].join('\n');

  var VS_ENT = [
    '#version 300 es',
    'layout(location=0) in vec3 aPos;',
    'layout(location=1) in vec3 aNor;',
    'uniform mat4 uVP; uniform mat4 uModel;',
    'out vec3 vNor; out vec3 vPos;',
    'void main(){ vec4 wp = uModel * vec4(aPos, 1.0);',
    ' vNor = mat3(uModel) * aNor; vPos = wp.xyz;',
    ' gl_Position = uVP * wp; }'
  ].join('\n');

  var FS_ENT = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 vNor; in vec3 vPos;',
    'uniform vec3 uColor; uniform vec3 uCam;',
    'uniform vec3 uFlashPos; uniform vec3 uFlashDir;',
    'uniform float uFlashPow; uniform float uEm;',
    'uniform vec4 uLampP[14]; uniform vec3 uLampC[14]; uniform int uLampN;',
    'uniform vec3 uFogC; uniform float uFogK;',
    'out vec4 frag;',
    'void main(){',
    '  vec3 n = normalize(vNor);',
    '  float lam = max(dot(n, normalize(uCam - vPos)), 0.0);',
    '  vec3 add = vec3(0.0);',
    '  for (int i = 0; i < 14; i++) {',
    '    if (i >= uLampN) break;',
    '    float d = distance(vPos, uLampP[i].xyz);',
    '    float att = clamp(1.0 - d / max(uLampP[i].w, 0.01), 0.0, 1.0);',
    '    add += uLampC[i] * (att * att);',
    '  }',
    '  vec3 fd = vPos - uFlashPos;',
    '  float dist = length(fd);',
    '  float ang = dot(fd / max(dist, 0.001), uFlashDir);',
    '  float cone = smoothstep(0.70, 0.92, ang);',
    '  float fall = clamp(1.0 - dist / 24.0, 0.0, 1.0);',
    '  add += vec3(1.0, 0.93, 0.80) * (cone * fall * fall * uFlashPow * 2.6);',
    '  float lit = 0.06 + 0.5 * lam + (add.r * 0.4 + add.g * 0.5 + add.b * 0.35);',
    '  vec3 col = uColor * lit;',
    '  col += uColor * uEm * 1.6;',
    '  float dcam = distance(vPos, uCam);',
    '  float fog = exp(-uFogK * dcam * dcam);',
    '  col = mix(uFogC, col, clamp(fog, 0.0, 1.0));',
    '  frag = vec4(col, 1.0);',
    '}'
  ].join('\n');

  var VS_POST = [
    '#version 300 es',
    'layout(location=0) in vec2 aP;',
    'out vec2 vUV;',
    'void main(){ vUV = aP * 0.5 + 0.5; gl_Position = vec4(aP, 0.0, 1.0); }'
  ].join('\n');

  var FS_POST = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUV;',
    'uniform sampler2D uScene;',
    'uniform float uTime; uniform float uFear; uniform float uHurt;',
    'uniform vec2 uRes;',
    'out vec4 frag;',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }',
    'void main(){',
    '  vec2 uv = vUV;',
    '  vec2 c = uv - 0.5;',
    '  float r2 = dot(c, c);',
    '  vec2 sh = c * (r2 * 0.012 * (0.4 + uFear));',
    '  float ca = 0.0016 + 0.004 * uFear;',
    '  vec3 col;',
    '  col.r = texture(uScene, uv + sh + vec2(ca, 0.0)).r;',
    '  col.g = texture(uScene, uv + sh).g;',
    '  col.b = texture(uScene, uv + sh - vec2(ca, 0.0)).b;',
    '  float lum = dot(col, vec3(0.299, 0.587, 0.114));',
    '  col = mix(col, vec3(lum), 0.10 + 0.32 * uFear);',
    '  float vig = 1.0 - 1.05 * r2 * (1.1 + 0.55 * uFear);',
    '  col *= clamp(vig, 0.05, 1.0);',
    '  float g = hash(gl_FragCoord.xy + vec2(mod(uTime * 60.0, 1000.0)));',
    '  col += (g - 0.5) * (0.028 + 0.032 * uFear);',
    '  col = mix(col, vec3(0.42, 0.03, 0.03), clamp(uHurt, 0.0, 0.8) * 0.65);',
    '  frag = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function compile(glx, type, src) {
    var sh = glx.createShader(type);
    glx.shaderSource(sh, src);
    glx.compileShader(sh);
    if (!glx.getShaderParameter(sh, glx.COMPILE_STATUS)) {
      throw new Error('shader: ' + glx.getShaderInfoLog(sh));
    }
    return sh;
  }

  function program(glx, vs, fs) {
    var p = glx.createProgram();
    glx.attachShader(p, compile(glx, glx.VERTEX_SHADER, vs));
    glx.attachShader(p, compile(glx, glx.FRAGMENT_SHADER, fs));
    glx.linkProgram(p);
    if (!glx.getProgramParameter(p, glx.LINK_STATUS)) {
      throw new Error('lien: ' + glx.getProgramInfoLog(p));
    }
    return p;
  }

  /* ------------------------------------------------------------ atlas ---- */
  function makeAtlas() {
    var N = API.TILE_N = 6, T = 32, S = N * T;
    var cnv2 = document.createElement('canvas');
    cnv2.width = S; cnv2.height = S;
    var g = cnv2.getContext('2d');
    g.clearRect(0, 0, S, S);
    var n = globalThis.HNoise;

    function tile(ti, fn) {
      var ox = (ti % N) * T, oy = Math.floor(ti / N) * T;
      var img = g.createImageData(T, T);
      for (var y = 0; y < T; y++) for (var x = 0; x < T; x++) {
        var px = fn(x, y, function (a, b, sd) { return n.hash2(a | 0, b | 0, sd); });
        var o = (y * T + x) * 4;
        img.data[o] = Math.max(0, Math.min(255, px[0] * 255));
        img.data[o + 1] = Math.max(0, Math.min(255, px[1] * 255));
        img.data[o + 2] = Math.max(0, Math.min(255, px[2] * 255));
        img.data[o + 3] = (px.length > 3) ? Math.max(0, Math.min(255, px[3] * 255)) : 255;
      }
      g.putImageData(img, ox, oy);
    }

    var grain = function (x, y, sd, amt) {
      return (n.hash2(x * 7 + sd, y * 13, 1234) - 0.5) * amt;
    };

    /* 0 STONE  1 STONE_TOP  2 CRACK  3 MOSS */
    tile(0, function (x, y, h) {
      var v = 0.30 + 0.10 * h(x, y, 5) + grain(x, y, 2, 0.06);
      return [v * 1.0, v * 1.0, v * 1.08];
    });
    tile(1, function (x, y, h) {
      var v = 0.36 + 0.08 * h(x, y, 6);
      return [v, v, v * 1.05];
    });
    tile(2, function (x, y, h) {
      var v = 0.28 + 0.10 * h(x, y, 5);
      var crack = Math.abs(Math.sin(x * 0.9 + y * 1.3)) < 0.06 ? 0.18 : 0;
      return [v - crack, v - crack, v - crack + 0.02];
    });
    tile(3, function (x, y, h) {
      var v = 0.26 + 0.09 * h(x, y, 7);
      var m = ((x * 3 + y * 5) % 11 < 3) ? 0.10 : 0;
      return [v, v * 1.02 + m * 0.5, v * 0.92 + m];
    });
    /* 4 FLOOR_SIDE 5 FLOOR_TOP 6 FC_SIDE 7 FC_TOP */
    tile(4, function (x, y, h) {
      var v = 0.34 + grain(x, y, 3, 0.05);
      var line = (y % 8 === 0) ? 0.10 : 0;
      return [v * 1.02 - line, v - line, v * 0.95 - line];
    });
    tile(5, function (x, y, h) {
      var v = 0.40 + 0.07 * h(x, y, 9);
      var chess = ((x >> 4) + (y >> 4)) % 2 === 0 ? 0.04 : -0.04;
      return [v + chess, v + chess * 0.4, v * 0.9 + chess * 0.5];
    });
    tile(6, function (x, y, h) {
      var v = 0.30 + grain(x, y, 3, 0.06);
      var crack = (Math.abs(Math.sin(x * 1.1 - y * 0.7)) < 0.05) ? 0.15 : 0;
      return [v - crack, v - crack, v * 0.92 - crack];
    });
    tile(7, function (x, y, h) {
      var v = 0.34 + 0.06 * h(x, y, 4);
      var crack = (Math.abs(Math.sin(x * 0.6 + y * 2.0)) < 0.05) ? 0.16 : 0;
      var chess = ((x >> 4) + (y >> 4)) % 2 === 0 ? 0.03 : -0.03;
      return [v + chess - crack, v + chess * 0.5 - crack, v * 0.88 - crack];
    });
    /* 8 WOOD 9 WOOD_DARK */
    tile(8, function (x, y, h) {
      var v = 0.34 + 0.06 * Math.sin(x * 1.4 + n.hash2(x, y, 9) * 0.4) + grain(x, y, 2, 0.04);
      return [v * 1.35, v * 0.92, v * 0.58];
    });
    tile(9, function (x, y, h) {
      var v = 0.22 + grain(x, y, 4, 0.05);
      return [v * 1.1, v * 0.7, v * 0.4];
    });
    /* 10 STATUE */
    tile(10, function (x, y, h) {
      var v = 0.16 + 0.05 * h(x, y, 8);
      return [v * 0.9, v * 0.95, v * 1.1];
    });
    /* 11 ALTAR 12 ALTAR_TOP */
    tile(11, function (x, y, h) {
      var v = 0.30 + grain(x, y, 1, 0.05);
      var trim = (x % 8 < 1) ? 0.22 : 0;
      return [v * 1.1 + trim, v * 0.95 + trim * 0.85, v * 0.7 + trim * 0.4];
    });
    tile(12, function (x, y, h) {
      var v = 0.34 + 0.06 * h(x, y, 2);
      var rune = (Math.abs(Math.sin(x * 0.5) + Math.sin(y * 0.5)) < 0.25) ? 0.2 : 0;
      return [v + rune, v * 0.9 + rune * 0.9, v * 0.62 + rune * 0.5];
    });
    /* 13 SCEAU (porte de sceau, vermille sombre) */
    tile(13, function (x, y, h) {
      var gd = Math.sqrt((x - 16) * (x - 16) + (y - 16) * (y - 16));
      var v = 0.20 + 0.10 * h(x, y, 3);
      var g2 = (gd < 11) ? 0.30 : (gd < 13.5 ? 0.12 : 0);
      return [v + g2, v * 0.35 + g2 * 0.3, v * 0.4 + g2 * 0.2];
    });
    /* 14 TORCH (flamme, découpée) */
    tile(14, function (x, y, h) {
      var flame = Math.abs(x - 16) < (12 - y) && y < 24;
      if (flame) return [1.0, 0.75 - y * 0.012, 0.25 + 0.02 * h(x, y, 11)];
      if (y >= 24 && y < 30 && Math.abs(x - 16) < 3) return [0.30, 0.20, 0.12];
      return [0, 0, 0, 0];
    });
    /* 15 BONE */
    tile(15, function (x, y, h) {
      var v = 0.62 + 0.10 * h(x, y, 10);
      return [v, v, v * 0.92];
    });
    /* 16 BLOOD */
    tile(16, function (x, y, h) {
      var v = 0.18 + 0.08 * h(x, y, 12);
      return [v * 1.4, v * 0.3, v * 0.3];
    });
    /* 17 DIRT 18 GRASS 19 GRASS_DEAD_TOP */
    tile(17, function (x, y, h) {
      var v = 0.20 + 0.06 * h(x, y, 13);
      return [v * 1.3, v, v * 0.8];
    });
    tile(18, function (x, y, h) {
      var v = 0.22 + 0.05 * h(x, y, 14);
      return [v * 1.25, v * 1.05, v * 0.7];
    });
    tile(19, function (x, y, h) {
      var v = 0.26 + 0.06 * h(x, y, 15);
      return [v * 1.2, v * 1.08, v * 0.65];
    });
    /* 20 TREE_DEAD */
    tile(20, function (x, y, h) {
      var v = 0.12 + 0.05 * h(x, y, 16);
      return [v * 1.4, v * 1.1, v * 0.9];
    });
    /* 21 MURAL (fresque rouge pâle sur pierre) */
    tile(21, function (x, y, h) {
      var v = 0.24 + 0.05 * h(x, y, 17);
      var bord = (Math.min(x, 31 - x, y, 31 - y) < 2) ? 0.12 : 0;
      var glyphe = (Math.sin(x * 0.7) * Math.cos(y * 0.9) > 0.75) ? 0.3 : 0;
      return [v + bord + glyphe, v * 0.9 + bord * 0.6, v * 0.85 + bord * 0.4];
    });
    /* 22 DOOR_WOOD (porte) */
    tile(22, function (x, y, h) {
      var v = 0.26 + 0.05 * Math.sin(x * 1.2) + grain(x, y, 5, 0.04);
      var g2 = (x < 2 || x > 29) ? 0.10 : 0;
      return [v * 1.2 + g2, v * 0.85 + g2 * 0.7, v * 0.5 + g2 * 0.3];
    });
    /* 23 FLESH */
    tile(23, function (x, y, h) {
      var v = 0.24 + 0.07 * h(x, y, 18);
      return [v * 1.5, v * 0.55, v * 0.55];
    });
    /* 24 GRAVE */
    tile(24, function (x, y, h) {
      var v = 0.28 + 0.06 * h(x, y, 19);
      var m = (Math.abs(x - 16) < 8 && Math.abs(y - 18) < 10) ? 0.05 : 0;
      return [v + m, v + m, v * 1.05 + m];
    });
    /* 25 CANDLE */
    tile(25, function (x, y, h) {
      var wick = Math.abs(x - 16) < 9 && y > 6 && y < 26;
      if (wick) return [0.85, 0.75, 0.6];
      return [0.35, 0.30, 0.25];
    });
    /* 26 BATTLEMENT 27 RUBBLE */
    tile(26, function (x, y, h) {
      var v = 0.28 + 0.08 * h(x, y, 20);
      return [v, v, v * 1.02];
    });
    tile(27, function (x, y, h) {
      var v = 0.24 + 0.10 * h(x, y, 21);
      return [v, v * 0.98, v * 0.9];
    });

    return cnv2;
  }

  /* --------------------------------------------------------------- init --- */
  var pWorld, pEnt, pPost, uW = {}, uE = {}, uP = {};
  var quadVAO, entVAO, fbo, fboTex, fboDepth;
  var atlasTex;

  API.init = function (canvas) {
    cnv = canvas;
    gl = cnv.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL 2 indisponible');
    API.gl = gl;

    pWorld = program(gl, VS_WORLD, FS_WORLD);
    uW.uVP = gl.getUniformLocation(pWorld, 'uVP');
    uW.uAtlas = gl.getUniformLocation(pWorld, 'uAtlas');
    uW.uCam = gl.getUniformLocation(pWorld, 'uCam');
    uW.uLampP = gl.getUniformLocation(pWorld, 'uLampP[0]');
    uW.uLampC = gl.getUniformLocation(pWorld, 'uLampC[0]');
    uW.uLampN = gl.getUniformLocation(pWorld, 'uLampN');
    uW.uFlashPos = gl.getUniformLocation(pWorld, 'uFlashPos');
    uW.uFlashDir = gl.getUniformLocation(pWorld, 'uFlashDir');
    uW.uFlashPow = gl.getUniformLocation(pWorld, 'uFlashPow');
    uW.uFogC = gl.getUniformLocation(pWorld, 'uFogC');
    uW.uFogK = gl.getUniformLocation(pWorld, 'uFogK');
    uW.uAmb = gl.getUniformLocation(pWorld, 'uAmb');
    uW.uTime = gl.getUniformLocation(pWorld, 'uTime');

    pEnt = program(gl, VS_ENT, FS_ENT);
    uE.uVP = gl.getUniformLocation(pEnt, 'uVP');
    uE.uModel = gl.getUniformLocation(pEnt, 'uModel');
    uE.uColor = gl.getUniformLocation(pEnt, 'uColor');
    uE.uCam = gl.getUniformLocation(pEnt, 'uCam');
    uE.uFlashPos = gl.getUniformLocation(pEnt, 'uFlashPos');
    uE.uFlashDir = gl.getUniformLocation(pEnt, 'uFlashDir');
    uE.uFlashPow = gl.getUniformLocation(pEnt, 'uFlashPow');
    uE.uEm = gl.getUniformLocation(pEnt, 'uEm');
    uE.uLampP = gl.getUniformLocation(pEnt, 'uLampP[0]');
    uE.uLampC = gl.getUniformLocation(pEnt, 'uLampC[0]');
    uE.uLampN = gl.getUniformLocation(pEnt, 'uLampN');
    uE.uFogC = gl.getUniformLocation(pEnt, 'uFogC');
    uE.uFogK = gl.getUniformLocation(pEnt, 'uFogK');

    pPost = program(gl, VS_POST, FS_POST);
    uP.uScene = gl.getUniformLocation(pPost, 'uScene');
    uP.uTime = gl.getUniformLocation(pPost, 'uTime');
    uP.uFear = gl.getUniformLocation(pPost, 'uFear');
    uP.uHurt = gl.getUniformLocation(pPost, 'uHurt');
    uP.uRes = gl.getUniformLocation(pPost, 'uRes');

    /* atlas procédural */
    atlasTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, makeAtlas());
    gl.generateMipmap(gl.TEXTURE_2D);

    /* triangle plein écran pour le post */
    quadVAO = gl.createVertexArray();
    gl.bindVertexArray(quadVAO);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    /* cube unité (positions + normales) pour les entités */
    entVAO = gl.createVertexArray();
    gl.bindVertexArray(entVAO);
    var eb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, eb);
    gl.bufferData(gl.ARRAY_BUFFER, unitCube(), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);

    /* frame buffer du post */
    fbo = gl.createFramebuffer();
    fboTex = gl.createTexture();
    fboDepth = gl.createRenderbuffer();
    API.resize();

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    return API;
  };

  function unitCube() {
    var v = [];
    var faces = [
      [[1, 0, 0], 1], [[-1, 0, 0], 1], [[0, 1, 0], 1], [[0, -1, 0], 1], [[0, 0, 1], 1], [[0, 0, -1], 1]
    ];
    var corners = [];
    for (var i = 0; i < 8; i++) corners.push([(i & 1) * 2 - 1, ((i >> 1) & 1) * 2 - 1, ((i >> 2) & 1) * 2 - 1]);
    function quad(a, b, c, d, nrm) {
      var t = [a, b, c, a, c, d];
      for (var i = 0; i < 6; i++) {
        var p = t[i];
        v.push(p[0], p[1], p[2], nrm[0], nrm[1], nrm[2]);
      }
    }
    /* faces du cube parCCC orientation CCW vue de l'extérieur */
    quad(corners[1], corners[3], corners[7], corners[5], [1, 0, 0]);
    quad(corners[0], corners[4], corners[6], corners[2], [-1, 0, 0]);
    quad(corners[4], corners[5], corners[7], corners[6], [0, 1, 0]);
    quad(corners[0], corners[2], corners[3], corners[1], [0, -1, 0]);
    quad(corners[4], corners[5], corners[7], corners[6], [0, 0, 1]);
    quad(corners[0], corners[2], corners[3], corners[1], [0, 0, -1]);
    return new Float32Array(v);
  }

  API.resize = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var scale = (globalThis.HSTATE && globalThis.HSTATE.quality) || 1;
    var w = Math.max(2, Math.floor(cnv.clientWidth * dpr * (scale === 1 ? 0.85 : scale)));
    var h = Math.max(2, Math.floor(cnv.clientHeight * dpr * (scale === 1 ? 0.85 : scale)));
    if (cnv.width !== w || cnv.height !== h) {
      cnv.width = w; cnv.height = h;
      gl.bindTexture(gl.TEXTURE_2D, fboTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.bindRenderbuffer(gl.RENDERBUFFER, fboDepth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, fboDepth);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    API.w = w; API.h = h;
  };

  /* ------------------------------------------------------- chunks VAO ----- */
  var chunkVAOs = {};  /* id -> {vao, count} */

  API.uploadChunk = function (id, data) {
    var old = chunkVAOs[id];
    if (old) gl.deleteVertexArray(old.vao);
    if (!data || data.length === 0) { chunkVAOs[id] = null; return; }
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 36, 20);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 36, 24);
    gl.bindVertexArray(null);
    chunkVAOs[id] = { vao: vao, count: data.length / 7 };
  };

  API.chunkUploaded = function (id) { return chunkVAOs[id]; };

  /* --------------------------------------------------------------- rendu -- */
  /* state: {camPos, yaw, pitch, fov, lamps(list), flashOn, flashPow, fear,
   *         hurt, fogC, fogK, ambient, time, entities:[{mat,color,em}]}     */
  API.render = function (state) {
    var w = API.w, h = API.h;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    var sky = state.fogC;
    gl.clearColor(sky[0], sky[1], sky[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    var proj = perspective(state.fov || 1.25, w / h, 0.06, 110);
    var view = m4();
    view = rotX(view, -state.pitch);
    view = rotY(view, -state.yaw);
    view = translate(view, -state.camPos[0], -state.camPos[1], -state.camPos[2]);
    var vp = mul(proj, view);

    /* direction torche frontale */
    var cy = Math.cos(state.yaw), sy = Math.sin(state.yaw);
    var cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
    var fdir = [sy * cp, sp, -cy * cp];

    /* collecte des 14 lampes les plus pertinentes */
    var lamps = state.lamps || [];
    var lp = new Array(14 * 4).fill(0);
    var lc = new Array(14 * 3).fill(0);
    var ln = Math.min(14, lamps.length);
    for (var i = 0; i < ln; i++) {
      var L = lamps[i];
      lp[i * 4] = L.x; lp[i * 4 + 1] = L.y; lp[i * 4 + 2] = L.z; lp[i * 4 + 3] = L.rad;
      lc[i * 3] = L.color[0]; lc[i * 3 + 1] = L.color[1]; lc[i * 3 + 2] = L.color[2];
      if (L.flicker) {
        var fl = 0.82 + 0.18 * Math.sin(state.time * 9.1 + L.phase) * Math.sin(state.time * 3.7 + L.phase * 1.7);
        lc[i * 3] *= fl; lc[i * 3 + 1] *= fl; lc[i * 3 + 2] *= fl;
      }
    }

    /* ---------- passe monde (culling par distance de chunk) ---------- */
    var NCX = HM.NCX, NCY = HM.NCY, NCZ = HM.NCZ;
    gl.useProgram(pWorld);
    gl.uniformMatrix4fv(uW.uVP, false, new Float32Array(vp));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.uniform1i(uW.uAtlas, 0);
    gl.uniform3fv(uW.uCam, state.camPos);
    gl.uniform4fv(uW.uLampP, new Float32Array(lp));
    gl.uniform3fv(uW.uLampC, new Float32Array(lc));
    gl.uniform1i(uW.uLampN, ln);
    gl.uniform3fv(uW.uFlashPos, [state.camPos[0], state.camPos[1], state.camPos[2]]);
    gl.uniform3fv(uW.uFlashDir, fdir);
    gl.uniform1f(uW.uFlashPow, state.flashPow || 0);
    gl.uniform3fv(uW.uFogC, state.fogC);
    gl.uniform1f(uW.uFogK, state.fogK || 0.0035);
    gl.uniform1f(uW.uAmb, state.ambient === undefined ? 0.035 : state.ambient);
    gl.uniform1f(uW.uTime, state.time);

    var camP = state.camPos;
    for (var id in chunkVAOs) {
      var cv = chunkVAOs[id];
      if (!cv) continue;
      var iid = +id;
      var ccx = (iid % NCX) * 16 + 8;
      var ccz = (((iid / NCX) | 0) % NCZ) * 16 + 8;
      var ccy = ((iid / (NCX * NCZ)) | 0) * 8 + 4;
      var cdx = ccx - camP[0], cdy = ccy - camP[1], cdz = ccz - camP[2];
      if (cdx * cdx + cdy * cdy + cdz * cdz > 3600) continue;   /* 60 m */
      gl.bindVertexArray(cv.vao);
      gl.drawArrays(gl.TRIANGLES, 0, cv.count);
    }

    /* ---------- passe entités ---------- */
    gl.useProgram(pEnt);
    gl.uniformMatrix4fv(uE.uVP, false, new Float32Array(vp));
    gl.uniform3fv(uE.uCam, state.camPos);
    gl.uniform4fv(uE.uLampP, new Float32Array(lp));
    gl.uniform3fv(uE.uLampC, new Float32Array(lc));
    gl.uniform1i(uE.uLampN, ln);
    gl.uniform3fv(uE.uFlashPos, [state.camPos[0], state.camPos[1], state.camPos[2]]);
    gl.uniform3fv(uE.uFlashDir, fdir);
    gl.uniform1f(uE.uFlashPow, state.flashPow || 0);
    gl.uniform3fv(uE.uFogC, state.fogC);
    gl.uniform1f(uE.uFogK, state.fogK || 0.0035);
    gl.bindVertexArray(entVAO);
    var ents = state.entities || [];
    for (var e = 0; e < ents.length; e++) {
      var ent = ents[e];
      gl.uniformMatrix4fv(uE.uModel, false, new Float32Array(ent.mat));
      gl.uniform3fv(uE.uColor, ent.color);
      gl.uniform1f(uE.uEm, ent.em || 0);
      gl.drawArrays(gl.TRIANGLES, 0, 36);
    }

    /* ---------- post ---------- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(pPost);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fboTex);
    gl.uniform1i(uP.uScene, 0);
    gl.uniform1f(uP.uTime, state.time);
    gl.uniform1f(uP.uFear, state.fear || 0);
    gl.uniform1f(uP.uHurt, state.hurt || 0);
    gl.uniform2f(uP.uRes, w, h);
    gl.bindVertexArray(quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
    gl.bindVertexArray(null);
  };
})();
