// Direct sunlight, drawn additively over the sky and clouds: the disc, the
// glare it causes in the eye, and the aureole of light scattered forward by
// aerosols. Clouds shadow all three through their transmittance (1 - alpha of
// the accumulated cloud texture). The aureole is shadowed by the clouds lying
// between each pixel and the sun on screen, which is where crepuscular rays
// come from: lit lanes of haze through the gaps, dark lanes behind the clouds.
// A clear sky casts no shadow, so it shows no rays.
export const SUNLIGHT = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uClouds;
uniform vec2 uSize;
uniform vec2 uViewTan;
uniform vec2 uSunUV;
uniform vec3 uSun;
uniform float uSunLight;
uniform float uTurbidity;

out vec4 outColor;

const float DEG = 0.017453293;
// Slightly larger than the real 0.27° so the disc survives the low resolution.
const float SUN_RADIUS = 0.55 * DEG;
const int SHAFT_SAMPLES = 40;

float transmittance(vec2 uv) { return 1.0 - texture(uClouds, uv).a; }

// Henyey-Greenstein phase function divided by its value toward the sun.
float phase(float mu, float g) {
  return pow((1.0 - g) * (1.0 - g) / (1.0 + g * g - 2.0 * g * mu), 1.5);
}

// Interleaved gradient noise: a fixed, even dither per pixel.
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  // Angle to the sun measured on screen, at the scale of the view centre.
  // The sun's path is laid out on screen, so its light is too: true angles
  // would be stretched by the perspective toward the bottom corners, where
  // it rises and sets, making the disc and glare swell into ovals.
  float theta = min(length((uv - uSunUV) * 2.0 * uViewTan), 3.14159265);
  float mu = cos(theta);

  // Share of the disc not hidden by clouds, sampled across it.
  vec2 r = SUN_RADIUS / (2.0 * uViewTan);
  float sunTrans = (transmittance(uSunUV) +
                    transmittance(uSunUV + vec2(r.x, 0.0)) +
                    transmittance(uSunUV - vec2(r.x, 0.0)) +
                    transmittance(uSunUV + vec2(0.0, r.y)) +
                    transmittance(uSunUV - vec2(0.0, r.y))) / 5.0;

  // Disc with limb darkening, its edge antialiased over one pixel.
  float x = theta / SUN_RADIUS;
  float aa = max(fwidth(x), 1e-3);
  float disc = (1.0 - smoothstep(1.0 - aa, 1.0 + aa, x)) *
               (1.0 - 0.6 * (1.0 - sqrt(max(1.0 - x * x, 0.0))));
  // Squared: thin veils let a dimmed disc through, thick cloud hides it.
  float discTrans = transmittance(uv);
  disc *= discTrans * discTrans;

  // Glare scattered inside the eye: it only exists while the disc shows.
  // It is what makes the sun look big: the disc itself is tiny, but the core
  // around it burns out to white over a couple of degrees.
  float glare = (1.1 * exp(-theta / (1.6 * DEG)) +
                 0.3 * exp(-theta / (7.0 * DEG))) * sunTrans;

  // How much of the haze toward the sun is lit: transmittance of the clouds
  // between this pixel and the sun, weighted toward the sun where most of the
  // scattered light comes from. Gaps near the disc open lit lanes that fan
  // out across the sky; clouds near it cast dark ones.
  vec2 toSun = uSunUV - uv;
  float jitter = ign(gl_FragCoord.xy);
  float lit = 0.0, weights = 0.0;
  for (int i = 0; i < SHAFT_SAMPLES; i++) {
    float f = (float(i) + jitter) / float(SHAFT_SAMPLES);
    // Angle (rad) between the sample and the sun, near the view centre.
    float a = length(toSun * (1.0 - f) * 2.0 * uViewTan);
    float w = 1.0 + 6.0 * exp(-a / (6.0 * DEG));
    lit += transmittance(uv + toSun * f) * w;
    weights += w;
  }
  lit /= weights;

  // Tight aerosol peak plus a broad humid-air halo, both scaled by turbidity.
  float aureole = uTurbidity * (0.8 * phase(mu, 0.93) + 0.35 * phase(mu, 0.7)) * lit;

  vec3 discColor = mix(uSun, vec3(1.0), 0.6);

  vec3 color = (discColor * disc * 3.0 + uSun * (glare + aureole)) * uSunLight;
  // Dither below one 8-bit step so the smooth falloff doesn't band.
  color += (jitter - 0.5) / 255.0 * step(0.002, color);
  color = clamp(color, 0.0, 1.0);
  // Premultiplied output with rgb <= alpha, composited with 'lighter'.
  outColor = vec4(color, max(color.r, max(color.g, color.b)));
}`
