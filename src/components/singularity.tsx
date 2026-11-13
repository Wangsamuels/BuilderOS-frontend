"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/lib/format";

/**
 * The BuilderOS black hole: a ray-marched, gravitationally lensed accretion disk.
 *
 * It is the product's one piece of imagery and it carries meaning wherever it appears:
 * the budget is the mass, agents and spend orbit it, and the horizon is the hard cap nothing passes.
 *   mass   0..1  how much matter is in the disk (brightness and extent)
 *   spin   speed of the disk; 0 freezes it (a paused company)
 *   tilt   camera elevation above the disk plane, radians
 */
const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uTilt; uniform float uMass; uniform float uCool;
uniform vec2 uOffset; uniform float uZoom; uniform float uSteps; uniform float uYaw; uniform float uHeat;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
// value noise, periodic along x so the disk has no seam
float pnoise(vec2 p, float period){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  float x0 = mod(i.x, period), x1 = mod(i.x + 1.0, period);
  return mix(mix(hash(vec2(x0,i.y)), hash(vec2(x1,i.y)), f.x), mix(hash(vec2(x0,i.y+1.0)), hash(vec2(x1,i.y+1.0)), f.x), f.y);
}
vec3 stars(vec3 d){
  vec2 uv = vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0))) * 38.0;
  vec2 id = floor(uv); vec2 f = fract(uv) - 0.5;
  float h = hash(id);
  float s = smoothstep(0.09, 0.0, length(f + (vec2(hash(id+3.1), hash(id+7.7)) - 0.5) * 0.6)) * step(0.86, h);
  vec3 tint = mix(vec3(1.0, 0.86, 0.7), vec3(0.72, 0.84, 1.0), hash(id + 1.7));
  return tint * s * (0.35 + 0.65 * hash(id + 9.2));
}
// One layer of the disk at radius r, angle a. Rings rotate rigidly (Keplerian, faster inside) so the pattern never winds up.
float streaks(float r, float a, float t){
  float band = r * 2.6;
  float i = floor(band), f = fract(band);
  float w0 = 1.9 / pow(max(i / 2.6, 1.2), 1.5), w1 = 1.9 / pow(max((i + 1.0) / 2.6, 1.2), 1.5);
  float u = a / 6.2831853;
  float n0 = pnoise(vec2((u + t * w0) * 26.0, i * 1.7), 26.0);
  float n1 = pnoise(vec2((u + t * w1) * 26.0, (i + 1.0) * 1.7), 26.0);
  float fine = pnoise(vec2((u + t * w0 * 1.3) * 90.0, r * 9.0), 90.0);
  return mix(n0, n1, smoothstep(0.0, 1.0, f)) * 0.75 + fine * 0.25;
}
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y);
  uv = (uv - uOffset) / uZoom;
  // camera orbiting above the disk plane (y = 0); the horizon has radius 1
  float dist = 13.0;
  // the camera orbits a little with the cursor: stars, lensing and the disk all shift as one scene, not as layers
  vec3 ro = vec3(sin(uYaw) * cos(uTilt), sin(uTilt), -cos(uYaw) * cos(uTilt)) * dist;
  vec3 fw = normalize(-ro), rt = normalize(cross(vec3(0.0, 1.0, 0.0), fw)), up = cross(fw, rt);
  // a slight roll so the disk sits on a diagonal, like a photograph rather than a diagram
  float roll = -0.14; uv = mat2(cos(roll), -sin(roll), sin(roll), cos(roll)) * uv;
  vec3 rd = normalize(fw * 1.55 + rt * uv.x + up * uv.y);

  vec3 p = ro, v = rd;
  vec3 hvec = cross(p, v); float h2 = dot(hvec, hvec);
  vec3 col = vec3(0.0); float alpha = 0.0; bool captured = false;
  float rin = 2.6, rout = mix(5.2, 9.0, uMass);
  for (int i = 0; i < 140; i++){
    if (float(i) >= uSteps) break;
    float r2 = dot(p, p); float r = sqrt(r2);
    if (r < 1.0) { captured = true; break; }
    if (r > 30.0 && dot(p, v) > 0.0) break;
    float dt = clamp(r * 0.11, 0.045, 1.4);
    // photon geodesic in Schwarzschild space, written as a force: a = -1.5 h^2 p / r^5
    vec3 acc = -1.5 * h2 * p / (r2 * r2 * r);
    vec3 pn = p + v * dt; v = normalize(v + acc * dt);
    if (p.y * pn.y < 0.0) {
      float k = p.y / (p.y - pn.y);
      vec3 hit = mix(p, pn, k); float hr = length(hit.xz);
      if (hr > rin && hr < rout) {
        float a = atan(hit.z, hit.x);
        float edge = smoothstep(rin, rin + 0.5, hr) * smoothstep(rout, rout - 2.4, hr);
        float n = streaks(hr, a, uTime);
        float dens = edge * (0.25 + 1.25 * n * n) * (0.35 + 0.65 * uMass);
        // temperature: white-hot at the inner edge, gold, then ember
        float tmp = 1.0 - (hr - rin) / (rout - rin);
        vec3 c = mix(vec3(0.85, 0.24, 0.06), vec3(1.0, 0.66, 0.30), smoothstep(0.0, 0.55, tmp));
        c = mix(c, vec3(1.0, 0.94, 0.84), smoothstep(0.55, 1.0, tmp));
        // Doppler beaming: the side rotating toward the camera is brighter and bluer
        vec3 tang = normalize(vec3(-hit.z, 0.0, hit.x));
        float dop = dot(tang, -v) * (1.25 / sqrt(hr));
        c *= pow(max(1.0 + dop, 0.05), 3.0);
        c = mix(c, c * vec3(0.72, 0.9, 1.35), clamp(dop, 0.0, 1.0) * 0.6);
        c *= 1.6 * (0.6 + tmp * 1.6);
        // matter near a visitor heats up: the inner disk flares as the cursor nears the horizon
        c *= 1.0 + uHeat * (0.25 + 0.9 * tmp * tmp);
        float aa = clamp(dens * 0.9, 0.0, 1.0);
        col += (1.0 - alpha) * aa * c; alpha += (1.0 - alpha) * aa;
      }
    }
    p = pn;
    if (alpha > 0.985) break;
  }
  if (!captured) {
    vec3 bg = stars(v) * (0.9 + 0.5 * uHeat);
    bg += vec3(0.10, 0.05, 0.16) * pow(max(0.0, 1.0 - abs(v.y) * 1.4), 3.0) * 0.35;  // faint violet band
    col += (1.0 - alpha) * bg;
  }
  // a paused company cools: the disk loses its heat and goes ash-blue
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(l) * vec3(0.62, 0.74, 0.95) * 0.55, uCool);
  col = col / (1.0 + col * 0.55);              // soft tone map
  col = pow(col, vec3(0.92));
  float vig = smoothstep(1.35, 0.25, length((gl_FragCoord.xy - 0.5 * uRes) / uRes.y));
  gl_FragColor = vec4(col * mix(0.55, 1.0, vig), 1.0);
}`;
const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

export type SingularityProps = {
  className?: string;
  mass?: number;
  spin?: number;
  tilt?: number;
  zoom?: number;
  /** centre of the hole, in units of the short side (0,0 = middle) */
  offset?: [number, number];
  /** follow scroll progress of the page for a slow camera rise */
  scrollTilt?: boolean;
  quality?: "high" | "low";
  /** follow the cursor: the camera drifts with it, and the disk flares as it nears the horizon */
  interactive?: boolean;
};

export function Singularity({ className, mass = 0.7, spin = 1, tilt = 0.16, zoom = 1, offset = [0, 0], scrollTilt, quality = "high", interactive }: SingularityProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef({ mass, spin, tilt, zoom, offset });
  live.current = { mass, spin, tilt, zoom, offset };
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance" });
    if (!gl) {
      setFailed(true);
      return;
    }
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram()!;
    if (!vs || !fs) {
      setFailed(true);
      return;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      setFailed(true);
      return;
    }
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = (n: string) => gl.getUniformLocation(prog, n);
    const u = { res: U("uRes"), time: U("uTime"), tilt: U("uTilt"), mass: U("uMass"), cool: U("uCool"), offset: U("uOffset"), zoom: U("uZoom"), steps: U("uSteps"), yaw: U("uYaw"), heat: U("uHeat") };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const small = window.matchMedia("(max-width: 720px)").matches;
    const low = quality === "low" || small;
    let scale = Math.min(window.devicePixelRatio || 1, low ? 1 : 1.5) * (low ? 0.7 : 0.85);
    const steps = low ? 80 : 120;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const w = Math.max(2, Math.round(r.width * scale));
      const h = Math.max(2, Math.round(r.height * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    // eased state so prop changes glide instead of snapping
    const cur = { mass: live.current.mass, tilt: live.current.tilt, zoom: live.current.zoom, spin: live.current.spin, cool: live.current.spin === 0 ? 1 : 0, ox: live.current.offset[0], oy: live.current.offset[1] };
    // cursor, in the shader's own units (short side = 1, centre = 0, y up)
    const aim = { yaw: 0, lift: 0, heat: 0 };
    const ptr = { yaw: 0, lift: 0, heat: 0 };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const r = canvas.getBoundingClientRect();
      if (e.clientY < r.top || e.clientY > r.bottom) return void Object.assign(aim, { yaw: 0, lift: 0, heat: 0 });
      const m = Math.min(r.width, r.height);
      const nx = (e.clientX - r.left - r.width / 2) / m;
      const ny = -(e.clientY - r.top - r.height / 2) / m;
      const L = live.current;
      const d = Math.hypot(nx - L.offset[0], ny - L.offset[1]) / L.zoom;
      aim.yaw = Math.max(-1, Math.min(1, nx)) * 0.14;
      aim.lift = Math.max(-1, Math.min(1, ny)) * 0.07;
      aim.heat = Math.max(0, Math.min(1, (1.25 - d) / 0.9));
    };
    const onLeave = () => Object.assign(aim, { yaw: 0, lift: 0, heat: 0 });
    if (interactive && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      window.addEventListener("pointermove", onMove, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
    }
    let t = 40;
    let last = performance.now();
    let raf = 0;
    let visible = true;
    let frames = 0;
    let cost = 0.016;
    let delay = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const draw = (now: number) => {
      const raw = (now - last) / 1000 - delay / 1000; // time this frame really cost, without the pause we chose
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const L = live.current;
      const k = 1 - Math.exp(-dt * 3.2);
      const scrollT = scrollTilt ? Math.min(1, window.scrollY / Math.max(1, window.innerHeight)) * 0.22 : 0;
      cur.mass += (L.mass - cur.mass) * k;
      const kp = 1 - Math.exp(-dt * 2.2); // the scene follows the hand with a little weight, never twitchy
      ptr.yaw += (aim.yaw - ptr.yaw) * kp;
      ptr.lift += (aim.lift - ptr.lift) * kp;
      ptr.heat += (aim.heat - ptr.heat) * kp;
      cur.tilt += (L.tilt + scrollT + ptr.lift - cur.tilt) * k;
      cur.zoom += (L.zoom - cur.zoom) * k;
      cur.spin += (L.spin - cur.spin) * k;
      cur.cool += ((L.spin === 0 ? 1 : 0) - cur.cool) * k;
      cur.ox += (L.offset[0] - cur.ox) * k;
      cur.oy += (L.offset[1] - cur.oy) * k;
      t += dt * cur.spin * 0.16 * (1 + ptr.heat * 1.4);
      gl.uniform2f(u.res, canvas.width, canvas.height);
      gl.uniform1f(u.time, t);
      gl.uniform1f(u.tilt, cur.tilt);
      gl.uniform1f(u.mass, cur.mass);
      gl.uniform1f(u.cool, cur.cool);
      gl.uniform2f(u.offset, cur.ox, cur.oy);
      gl.uniform1f(u.zoom, cur.zoom);
      gl.uniform1f(u.steps, steps);
      gl.uniform1f(u.yaw, ptr.yaw);
      gl.uniform1f(u.heat, ptr.heat);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // Never let the picture cost the page its responsiveness. On a slow GPU (or none), first drop resolution,
      // then drop the frame rate: a slow disk still reads as a disk; a frozen button does not.
      if (++frames > 2) cost = cost * 0.7 + raw * 0.3;
      if (frames > 6 && cost > 0.04 && scale > 0.3) {
        scale *= 0.65;
        resize();
        frames = 3;
        cost = 0.02;
      }
      delay = cost > 0.05 ? 220 : cost > 0.03 ? 60 : 0;
      if (reduced || !visible) return;
      if (delay) timer = setTimeout(() => (raf = requestAnimationFrame(draw)), delay);
      else raf = requestAnimationFrame(draw);
    };
    const io = new IntersectionObserver(([e]) => {
      const was = visible;
      visible = e.isIntersecting && !document.hidden;
      if (visible && !was && !reduced) {
        last = performance.now();
        raf = requestAnimationFrame(draw);
      }
    });
    io.observe(canvas);
    const onVis = () => {
      const was = visible;
      visible = !document.hidden;
      if (visible && !was && !reduced) {
        last = performance.now();
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [quality, scrollTilt, interactive]);

  if (failed) return <div aria-hidden className={cx(className)} style={{ background: "radial-gradient(closest-side at 50% 50%, #000 0 13%, #ffe9c8 14.5%, #ffb35a 17%, #e8892c55 26%, transparent 46%), radial-gradient(60% 18% at 50% 52%, #ffb35a66, transparent 70%), #050509" }} />;
  return <canvas ref={ref} aria-hidden role="presentation" className={cx("block", className)} />;
}

export type Body = { color: string; ring: number; period: number; phase: number; size?: number };
/** Teams as bodies in orbit: blue build, orange ops, green growth, in the same colours the charts use. */
export const TEAM_BODIES: Body[] = [
  { color: "var(--color-s1)", ring: 0, period: 46, phase: 0.08 },
  { color: "var(--color-s2)", ring: 1, period: 74, phase: 0.42 },
  { color: "var(--color-s3)", ring: 1, period: 74, phase: 0.86 },
  { color: "var(--color-ember)", ring: 0, period: 46, phase: 0.61, size: 3 },
];
const RINGS = [0.33, 0.47];

/**
 * Orbit rings and the bodies on them, drawn over a Singularity with the same offset and zoom.
 * Wherever the black hole stands for a company, each body is a team (or an agent) working around its budget.
 */
export function Orbits({ className, offset = [0, 0], zoom = 1, bodies = TEAM_BODIES, interactive }: { className?: string; offset?: [number, number]; zoom?: number; bodies?: Body[]; interactive?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const layer = useRef<SVGGElement>(null);
  const at = useRef({ offset, zoom });
  at.current = { offset, zoom };
  // The orbits sit in front of the hole, so they shift a little more than it does: depth, without a single extra asset.
  useEffect(() => {
    if (!interactive || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const svg = ref.current;
    const g = layer.current;
    if (!svg || !g) return;
    const reset = () => {
      g.style.transform = "";
      g.style.setProperty("--near", "0");
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const r = svg.getBoundingClientRect();
      if (e.clientY < r.top || e.clientY > r.bottom) return reset();
      const m = Math.min(r.width, r.height);
      const nx = (e.clientX - r.left - r.width / 2) / m;
      const ny = (e.clientY - r.top - r.height / 2) / m;
      const d = Math.hypot(nx - at.current.offset[0], ny + at.current.offset[1]) / at.current.zoom;
      g.style.transform = `translate(${(-nx * 14).toFixed(1)}px, ${(-ny * 10).toFixed(1)}px)`;
      g.style.setProperty("--near", Math.max(0, Math.min(1, (1.25 - d) / 0.9)).toFixed(2));
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", reset);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", reset);
    };
  }, [interactive]);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const m = box ? Math.min(box.w, box.h) : 0;
  const cx = box ? box.w / 2 + offset[0] * m : 0;
  const cy = box ? box.h / 2 - offset[1] * m : 0;
  return (
    <svg ref={ref} aria-hidden className={cx_(className)} style={{ transition: "opacity 1.2s ease", opacity: box ? 1 : 0 }}>
      <g ref={layer} style={{ transition: "transform 0.7s cubic-bezier(0.16, 1, 0.3, 1)" }}>
      {box
        ? RINGS.map((r, i) => <circle key={r} cx={cx} cy={cy} r={r * zoom * m * 1.7} fill="none" stroke="#f3ebdd" strokeWidth="1" strokeDasharray="2 7" style={{ strokeOpacity: `calc(${i ? 0.1 : 0.16} + var(--near, 0) * 0.28)`, transition: "stroke-opacity 0.5s ease" }} />)
        : null}
      {box
        ? bodies.map((b, i) => {
            const R = RINGS[b.ring] * zoom * m * 1.7;
            const size = b.size ?? 4.5;
            return (
              <g key={i} transform={`rotate(${b.phase * 360} ${cx} ${cy})`}>
                <g style={{ transformOrigin: `${cx}px ${cy}px`, animation: `orbit ${b.period}s linear infinite` }}>
                  <circle cx={cx + R} cy={cy} r={size * 2.6} fill={b.color} opacity="0.16" />
                  <circle cx={cx + R} cy={cy} r={size} fill={b.color} />
                </g>
              </g>
            );
          })
        : null}
      </g>
    </svg>
  );
}
const cx_ = (c?: string) => cx("pointer-events-none", c);

/** The mark: a horizon, its photon ring, and the disk crossing in front. Also the static stand-in where a shader would be too much. */
export function Mark({ size = 28, paused, className }: { size?: number; paused?: boolean; className?: string }) {
  const hot = paused ? "#8fa3c4" : "#ffb35a";
  const light = paused ? "#c9d4e6" : "#fff1dc";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={className}>
      <defs>
        <linearGradient id={`mk-${paused ? "p" : "a"}`} x1="0" x2="1">
          <stop offset="0" stopColor={hot} stopOpacity="0.15" />
          <stop offset="0.5" stopColor={light} />
          <stop offset="1" stopColor={hot} stopOpacity="0.15" />
        </linearGradient>
      </defs>
      <ellipse cx="16" cy="16" rx="14.500" ry="4.200" fill="none" stroke={hot} strokeOpacity="0.55" strokeWidth="1.200" transform="rotate(-14 16 16)" />
      <circle cx="16" cy="16" r="7.600" fill="#050509" stroke={light} strokeWidth="1.300" />
      <path d="M2 17.200C6 20.800 26 14.800 30 13" fill="none" stroke={`url(#mk-${paused ? "p" : "a"})`} strokeWidth="2.200" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Daily cap as an event horizon: the ring fills as today's spend approaches the cap.
 * Nothing spends past it, which is exactly what the contract enforces.
 */
export function HorizonGauge({ pct, label, sub, size = 168 }: { pct: number; label: string; sub: string; size?: number }) {
  const p = Math.max(0, Math.min(100, pct));
  const r = 62;
  const c = 2 * Math.PI * r;
  const tone = p >= 90 ? "#ff6b57" : p >= 70 ? "#f5b642" : "#ffb35a";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${label}, ${sub}. ${Math.round(p)}% of the daily cap used.`}>
      <svg viewBox="0 0 160 160" className="size-full -rotate-90">
        <circle cx="80" cy="80" r="52" fill="#050509" />
        <circle cx="80" cy="80" r={r} fill="none" stroke="#ffffff12" strokeWidth="6" />
        <circle cx="80" cy="80" r={r} fill="none" stroke={tone} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(c * p) / 100} ${c}`} style={{ filter: `drop-shadow(0 0 6px ${tone}88)`, transition: "stroke-dasharray 0.8s cubic-bezier(0.16,1,0.3,1)" }} />
        <circle cx="80" cy="80" r="74" fill="none" stroke="#ffffff0d" strokeWidth="1" strokeDasharray="1 5" />
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <div className="num text-[22px] leading-none font-semibold text-ink">{label}</div>
        <div className="mt-1 text-xs text-ink-3">{sub}</div>
      </div>
    </div>
  );
}
