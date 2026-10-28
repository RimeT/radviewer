export const volumeVertex = /* glsl */ `
out vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const volumeFragment = /* glsl */ `
precision highp float;
precision highp sampler3D;
in vec3 vLocal;
uniform sampler3D uVolume;
uniform vec3 uCamLocal;
uniform vec3 uSize;
uniform vec3 uTexel;
uniform float uCenter;
uniform float uWidth;
out vec4 fragColor;

vec2 hitBox(vec3 ro, vec3 rd, vec3 halfSize) {
  vec3 inv = 1.0 / rd;
  vec3 a = (-halfSize - ro) * inv;
  vec3 b = (halfSize - ro) * inv;
  vec3 tmin = min(a, b);
  vec3 tmax = max(a, b);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}

void main() {
  vec3 halfSize = uSize * 0.5;
  vec3 ro = uCamLocal;
  vec3 rd = normalize(vLocal - ro);
  vec2 span = hitBox(ro, rd, halfSize);
  if (span.x > span.y) discard;
  float t0 = max(span.x, 0.0);
  float t1 = span.y;
  float ref = length(uSize) / 150.0;
  float steps = clamp((t1 - t0) / ref, 28.0, 150.0);
  float dt = (t1 - t0) / steps;
  vec3 light = normalize(vec3(0.42, 0.78, 0.4));
  vec3 acc = vec3(0.0);
  float alpha = 0.0;
  float low = uCenter - uWidth * 0.5;
  float width = max(uWidth, 1.0);
  for (int i = 0; i < 150; i++) {
    if (float(i) >= steps || alpha > 0.94) break;
    vec3 p = ro + rd * (t0 + (float(i) + 0.5) * dt);
    vec3 uv = p / uSize + 0.5;
    float hu = texture(uVolume, uv).r;
    float windowed = clamp((hu - low) / width, 0.0, 1.0);
    float gx = texture(uVolume, uv + vec3(uTexel.x, 0.0, 0.0)).r - texture(uVolume, uv - vec3(uTexel.x, 0.0, 0.0)).r;
    float gy = texture(uVolume, uv + vec3(0.0, uTexel.y, 0.0)).r - texture(uVolume, uv - vec3(0.0, uTexel.y, 0.0)).r;
    float gz = texture(uVolume, uv + vec3(0.0, 0.0, uTexel.z)).r - texture(uVolume, uv - vec3(0.0, 0.0, uTexel.z)).r;
    float grad = length(vec3(gx, gy, gz)) / width;
    float sampleAlpha = smoothstep(0.1, 0.58, windowed) * (0.28 + 0.72 * smoothstep(0.015, 0.22, grad));
    sampleAlpha = 1.0 - pow(1.0 - clamp(sampleAlpha, 0.0, 1.0), dt / ref);
    if (sampleAlpha > 0.003) {
      vec3 normal = normalize(vec3(gx, gy, gz) + vec3(1e-4));
      float shade = 0.28 + 0.72 * abs(dot(normal, light));
      float rim = pow(1.0 - abs(dot(normal, -rd)), 2.2);
      vec3 rgb = mix(vec3(0.78, 0.38, 0.34), vec3(0.96, 0.93, 0.88), smoothstep(0.42, 0.9, windowed));
      rgb = rgb * shade + vec3(0.45, 0.82, 1.0) * rim * 0.22;
      acc += (1.0 - alpha) * rgb * sampleAlpha;
      alpha += (1.0 - alpha) * sampleAlpha;
    }
  }
  if (alpha < 0.015) discard;
  fragColor = vec4(acc / max(alpha, 0.001), alpha);
}
`;

export const blitVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const blitFragment = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uTex;
void main() {
  gl_FragColor = texture2D(uTex, vUv);
}
`;
