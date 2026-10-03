export const BASE_THEME = Object.freeze({
  mode: 'light',
  tokens: {
    bg: '#eef6f0',
    surface: '#f8fbf6',
    surfaceRgb: [248, 251, 246],
    text: '#173a34',
    textSoft: '#31554d',
    muted: '#667b74',
    primary: '#2f8a63',
    primaryDeep: '#20684a',
    primaryText: '#ffffff',
    accent: '#f0a43a',
    berry: '#d95c73',
    sky: '#4f9fb4',
    border: '#c7d9d0',
    borderRgb: [23, 58, 52],
    sidebar: '#173a34',
    sidebarText: '#f4faf6',
    danger: '#b8344d',
    chartCalories: '#2f8a63',
    chartWeight: '#d95c73'
  },
  suggestedOpacity: 0.88
});

export function analyzeImageTheme(imageData) {
  const samples = samplePixels(imageData);
  if (!samples.length) return structuredClone(BASE_THEME);
  const meanLuminance = average(samples.map(sample => sample.luminance));
  const mode = meanLuminance < 0.42 ? 'dark' : 'light';
  const clusters = kMeans(samples, 5, 10)
    .filter(cluster => cluster.weight >= 0.015)
    .sort((a, b) => b.score - a.score || b.weight - a.weight);
  const primaryCluster = clusters[0] || { rgb: [47, 138, 99], hsl: rgbToHsl([47, 138, 99]) };
  const secondaryCluster = chooseSecondaryCluster(clusters, primaryCluster);
  const primaryHsl = balancedHsl(primaryCluster.hsl, mode, true);
  const secondaryHsl = balancedHsl(secondaryCluster.hsl, mode, false);
  const tokens = buildTokens(primaryHsl, secondaryHsl, mode);
  return {
    mode,
    tokens,
    suggestedOpacity: suggestPanelOpacity(imageData),
    metrics: {
      meanLuminance: round(meanLuminance, 4),
      contrast: round(Math.sqrt(variance(samples.map(sample => sample.luminance))), 4),
      sampleCount: samples.length
    },
    analyzedAt: new Date().toISOString()
  };
}

export function suggestPanelOpacity(imageData) {
  const samples = samplePixels(imageData);
  if (!samples.length) return BASE_THEME.suggestedOpacity;
  const luminances = samples.map(sample => sample.luminance);
  const mean = average(luminances);
  const spread = Math.sqrt(variance(luminances));
  const edge = edgeComplexity(imageData);
  const neutralPenalty = Math.abs(mean - 0.5) * 0.04;
  const opacity = 0.79 + spread * 0.12 + edge * 0.08 - neutralPenalty;
  return round(clamp(opacity, 0.78, 0.94), 2);
}

export function compositeColor(foreground, background, alpha = 1) {
  const front = hexToRgb(foreground);
  const back = hexToRgb(background);
  const opacity = clamp(Number(alpha), 0, 1);
  return rgbToHex(front.map((channel, index) => channel * opacity + back[index] * (1 - opacity)));
}
export function ensureAccessibleTextColor(color, background, minimum = 4.5) {
  const source = rgbToHex(hexToRgb(color));
  if (contrastRatio(source, background) >= minimum) {
    return { color: source, adjusted: false, contrast: contrastRatio(source, background) };
  }
  const sourceRgb = hexToRgb(source);
  const backgroundRgb = hexToRgb(background);
  const black = [0, 0, 0];
  const white = [255, 255, 255];
  const targetRgb = contrastRatio(rgbToHex(white), background) >= contrastRatio(rgbToHex(black), background) ? white : black;
  for (let step = 1; step <= 20; step++) {
    const candidate = rgbToHex(mixRgb(sourceRgb, targetRgb, step / 20));
    const contrast = contrastRatio(candidate, background);
    if (contrast >= minimum + 0.02) return { color: candidate, adjusted: true, contrast };
  }
  const fallback = rgbToHex(targetRgb);
  return { color: fallback, adjusted: true, contrast: contrastRatio(fallback, background) };
}

export function contrastRatio(first, second) {
  const firstLuminance = relativeLuminance(hexToRgb(first));
  const secondLuminance = relativeLuminance(hexToRgb(second));
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function hexToRgb(hex) {
  const clean = String(hex || '').trim().replace(/^#/, '');
  const normalized = clean.length === 3 ? clean.split('').map(character => character + character).join('') : clean;
  if (!/^[0-9a-f]{6}$/i.test(normalized)) throw new Error(`Invalid hex color: ${hex}`);
  return [0, 2, 4].map(index => parseInt(normalized.slice(index, index + 2), 16));
}

export function rgbToHex(rgb) {
  return `#${rgb.map(channel => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

function buildTokens(primary, secondary, mode) {
  const primaryHue = primary.h;
  const secondaryHue = secondary.h;
  const bg = hslToHex(primaryHue, mode === 'dark' ? 0.2 : 0.18, mode === 'dark' ? 0.075 : 0.955);
  const surface = hslToHex(primaryHue, mode === 'dark' ? 0.13 : 0.1, mode === 'dark' ? 0.115 : 0.985);
  const rawText = hslToHex(primaryHue, mode === 'dark' ? 0.14 : 0.38, mode === 'dark' ? 0.96 : 0.12);
  const text = ensureAccessibleTextColor(rawText, surface, 7).color;
  const rawMuted = mixRgb(hexToRgb(text), hexToRgb(surface), 0.52);
  const muted = ensureAccessibleTextColor(rgbToHex(rawMuted), surface, 4.5).color;
  const primaryColor = hslToHex(primary.h, clamp(primary.s, 0.36, 0.7), mode === 'dark' ? 0.58 : 0.4);
  const primaryDeep = hslToHex(primary.h, clamp(primary.s + 0.04, 0.4, 0.72), mode === 'dark' ? 0.48 : 0.31);
  const primaryText = ensureAccessibleTextColor('#ffffff', primaryColor, 4.5).color;
  const accent = hslToHex(secondary.h, clamp(secondary.s, 0.34, 0.72), mode === 'dark' ? 0.64 : 0.52);
  const berry = hslToHex((primaryHue + 325) % 360, 0.48, mode === 'dark' ? 0.65 : 0.52);
  const sky = hslToHex((primaryHue + 185) % 360, 0.42, mode === 'dark' ? 0.66 : 0.46);
  const border = hslToHex(primaryHue, mode === 'dark' ? 0.18 : 0.16, mode === 'dark' ? 0.31 : 0.78);
  const sidebar = hslToHex(primaryHue, 0.34, mode === 'dark' ? 0.065 : 0.13);
  const sidebarText = ensureAccessibleTextColor('#f4faf6', sidebar, 4.5).color;
  const danger = hslToHex(352, 0.55, mode === 'dark' ? 0.66 : 0.48);
  return {
    bg,
    surface,
    surfaceRgb: hexToRgb(surface),
    text,
    textSoft: ensureAccessibleTextColor(rgbToHex(mixRgb(hexToRgb(text), hexToRgb(surface), 0.18)), surface, 4.5).color,
    muted,
    primary: primaryColor,
    primaryDeep,
    primaryText,
    accent,
    berry,
    sky,
    border,
    borderRgb: hexToRgb(border),
    sidebar,
    sidebarText,
    danger,
    chartCalories: primaryColor,
    chartWeight: berry,
    chartProtein: sky
  };
}

function samplePixels(imageData) {
  const { data, width, height } = imageData;
  const total = width * height;
  if (!total) return [];
  const step = Math.max(1, Math.floor(Math.sqrt(total / 1600)));
  const samples = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const offset = (y * width + x) * 4;
      if (data[offset + 3] < 128) continue;
      const rgb = [data[offset], data[offset + 1], data[offset + 2]];
      samples.push({ rgb, hsl: rgbToHsl(rgb), luminance: relativeLuminance(rgb), x, y });
    }
  }
  return samples;
}

function kMeans(samples, count, iterations) {
  const sorted = [...samples].sort((a, b) => a.luminance - b.luminance || a.rgb[0] - b.rgb[0]);
  let centers = Array.from({ length: count }, (_, index) => {
    const position = Math.min(sorted.length - 1, Math.floor((index + 0.5) * sorted.length / count));
    return [...sorted[position].rgb];
  });
  let assignments = [];
  for (let iteration = 0; iteration < iterations; iteration++) {
    assignments = samples.map(sample => nearestCenter(sample.rgb, centers));
    const next = centers.map((center, index) => {
      const members = samples.filter((_, sampleIndex) => assignments[sampleIndex] === index);
      if (!members.length) return center;
      return [0, 1, 2].map(channel => average(members.map(member => member.rgb[channel])));
    });
    if (next.every((center, index) => distance(center, centers[index]) < 0.2)) {
      centers = next;
      break;
    }
    centers = next;
  }
  return centers.map((rgb, index) => {
    const members = samples.filter((_, sampleIndex) => assignments[sampleIndex] === index);
    const hsl = rgbToHsl(rgb);
    const weight = members.length / samples.length;
    const midLightness = 1 - Math.min(1, Math.abs(hsl.l - 0.5) * 2);
    const score = (0.18 + hsl.s) * (0.35 + midLightness) * Math.sqrt(weight);
    return { rgb, hsl, weight, score, members };
  });
}

function chooseSecondaryCluster(clusters, primary) {
  if (clusters.length < 2) return { rgb: [79, 159, 180], hsl: rgbToHsl([79, 159, 180]) };
  return clusters
    .filter(cluster => cluster !== primary)
    .map(cluster => ({ cluster, score: hueDistance(cluster.hsl.h, primary.hsl.h) * (0.3 + cluster.hsl.s) * Math.sqrt(cluster.weight) }))
    .sort((a, b) => b.score - a.score)[0].cluster;
}

function balancedHsl(hsl, mode, primary) {
  return {
    h: hsl.h,
    s: clamp(hsl.s * (primary ? 0.78 : 0.68), 0.28, primary ? 0.7 : 0.66),
    l: mode === 'dark' ? (primary ? 0.58 : 0.62) : (primary ? 0.4 : 0.48)
  };
}

function rgbToHsl(rgb) {
  const [r, g, b] = rgb.map(channel => channel / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return { h: hue, s: saturation, l: lightness };
}

function hslToHex(h, s, l) {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const section = h / 60;
  const x = chroma * (1 - Math.abs(section % 2 - 1));
  let rgb;
  if (section < 1) rgb = [chroma, x, 0];
  else if (section < 2) rgb = [x, chroma, 0];
  else if (section < 3) rgb = [0, chroma, x];
  else if (section < 4) rgb = [0, x, chroma];
  else if (section < 5) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];
  const m = l - chroma / 2;
  return rgbToHex(rgb.map(channel => (channel + m) * 255));
}

function edgeComplexity(imageData) {
  const { data, width, height } = imageData;
  if (width < 2 || height < 2) return 0;
  let difference = 0;
  let count = 0;
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 1024)));
  for (let y = 0; y < height - step; y += step) {
    for (let x = 0; x < width - step; x += step) {
      const current = pixelRgb(data, width, x, y);
      const right = pixelRgb(data, width, x + step, y);
      const down = pixelRgb(data, width, x, y + step);
      difference += Math.abs(relativeLuminance(current) - relativeLuminance(right));
      difference += Math.abs(relativeLuminance(current) - relativeLuminance(down));
      count += 2;
    }
  }
  return clamp(count ? difference / count * 5 : 0, 0, 1);
}

function pixelRgb(data, width, x, y) {
  const offset = (y * width + x) * 4;
  return [data[offset], data[offset + 1], data[offset + 2]];
}

function mixRgb(first, second, amount) {
  return first.map((channel, index) => channel + (second[index] - channel) * amount);
}

function hueDistance(first, second) {
  const difference = Math.abs(first - second) % 360;
  return Math.min(difference, 360 - difference) / 180;
}

function nearestCenter(rgb, centers) {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  centers.forEach((center, index) => {
    const currentDistance = distance(rgb, center);
    if (currentDistance < bestDistance) {
      bestDistance = currentDistance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function distance(first, second) {
  return Math.sqrt(first.reduce((sum, channel, index) => sum + (channel - second[index]) ** 2, 0));
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function variance(values) {
  if (!values.length) return 0;
  const mean = average(values);
  return average(values.map(value => (value - mean) ** 2));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}