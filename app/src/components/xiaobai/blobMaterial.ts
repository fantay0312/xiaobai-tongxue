/**
 * 团子本体材质:MeshStandardMaterial + onBeforeCompile 注入
 *   1. simplex noise 顶点位移 —— 柔软"呼吸"形变(mood 驱动幅度/频率/抖动)
 *   2. 菲涅尔边缘光 —— 亚光软糯质感(麻薯/雪见),拒绝塑料高光
 * 整体缩放(呼吸挤压/鼓起)在 CPU 侧作用于 group.scale,保证脸和配饰跟随。
 */
import * as THREE from 'three';
import { BODY_WHITE } from './palette';

export interface BlobUniforms {
  uTime: { value: number };
  uAmp: { value: number };
  uFreq: { value: number };
  uJitter: { value: number };
  uRimColor: { value: THREE.Color };
  uRimStrength: { value: number };
}

/** Ashima 3D simplex noise(经典公版 GLSL 实现) */
const SIMPLEX_GLSL = /* glsl */ `
vec3 xb_mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 xb_mod289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 xb_permute(vec4 x){ return xb_mod289(((x*34.0)+1.0)*x); }
vec4 xb_taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float xb_snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = xb_mod289(i);
  vec4 p = xb_permute(xb_permute(xb_permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = xb_taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

export function createBlobMaterial(rimColorHex: string, rimStrength: number): {
  material: THREE.MeshStandardMaterial;
  uniforms: BlobUniforms;
} {
  const uniforms: BlobUniforms = {
    uTime: { value: 0 },
    uAmp: { value: 0.045 },
    uFreq: { value: 0.35 },
    uJitter: { value: 0 },
    uRimColor: { value: new THREE.Color(rimColorHex) },
    uRimStrength: { value: rimStrength },
  };

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(BODY_WHITE), // ≈ 比 --paper 亮半档的暖白
    roughness: 0.94,                    // 亚光,无塑料高光
    metalness: 0,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform float uAmp;
uniform float uFreq;
uniform float uJitter;
${SIMPLEX_GLSL}`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  vec3 dir = normalize(position);
  // 低频大尺度起伏:柔软呼吸形变
  float soft = xb_snoise(dir * 1.6 + vec3(0.0, uTime * uFreq, uTime * uFreq * 0.7));
  // 高频小尺度抖动:confused 时瑟瑟发抖
  float shiver = xb_snoise(dir * 6.0 + vec3(uTime * 9.0)) * uJitter;
  transformed += normalize(normal) * (soft * uAmp + shiver);
}`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uRimColor;
uniform float uRimStrength;`
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
{
  // 下腹淡墨影:法线朝下处轻压一点冷灰,团子有了体积,不再是均匀死白
  // (smoothstep 规范要求 edge0 < edge1,反序是 UB —— 用 1-smoothstep 表达反坡)
  float belly = 1.0 - smoothstep(-0.85, 0.15, normalize(vNormal).y);
  gl_FragColor.rgb *= mix(vec3(1.0), vec3(0.935, 0.955, 0.975), belly * 0.8);
  // 菲涅尔轻微边缘光:亚光团子的柔和轮廓
  float fres = 1.0 - saturate(dot(normalize(vViewPosition), normalize(vNormal)));
  fres = pow(fres, 2.6);
  gl_FragColor.rgb += uRimColor * fres * uRimStrength;
}`
      );
  };
  // 同一材质不同 rim 配置会命中着色器缓存,自定义 key 防串
  material.customProgramCacheKey = () => 'xiaobai-blob';

  return { material, uniforms };
}
