import { formatNumber } from './utils.js';

export function lineChart({ labels = [], values = [], target = null, unit = '', color = '#2f8a63', title = '趋势图' }) {
  if (!values.length) return '<p class="chart-empty">还没有足够的数据</p>';
  const width = 760;
  const height = 270;
  const padding = { top: 28, right: 30, bottom: 48, left: 58 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const numericValues = values.map(value => Number(value) || 0);
  const candidates = target === null ? numericValues : [...numericValues, Number(target)];
  const rawMax = Math.max(...candidates, 1);
  const max = niceMax(rawMax * 1.12);
  const min = 0;
  const x = index => labels.length <= 1 ? padding.left + plotWidth / 2 : padding.left + (index / (labels.length - 1)) * plotWidth;
  const y = value => padding.top + (1 - ((Number(value) || 0) - min) / (max - min)) * plotHeight;
  const points = numericValues.map((value, index) => `${x(index)},${y(value)}`).join(' ');
  const areaPath = `M ${x(0)} ${padding.top + plotHeight} L ${points.replaceAll(' ', ' L ')} L ${x(numericValues.length - 1)} ${padding.top + plotHeight} Z`;
  const ticks = Array.from({ length: 5 }, (_, index) => max * index / 4).reverse();
  const labelStep = Math.max(1, Math.ceil(labels.length / 7));
  const labelMarkup = labels.map((label, index) => {
    if (index % labelStep !== 0 && index !== labels.length - 1) return '';
    return `<text x="${x(index)}" y="${height - 18}" text-anchor="middle">${escapeSvg(label)}</text>`;
  }).join('');
  const pointMarkup = numericValues.map((value, index) =>
    `<circle cx="${x(index)}" cy="${y(value)}" r="4"><title>${escapeSvg(`${labels[index] || index + 1}: ${formatNumber(value, 0)} ${unit}`)}</title></circle>`
  ).join('');
  const targetMarkup = target === null ? '' : `
    <line class="chart-target-line" x1="${padding.left}" x2="${width - padding.right}" y1="${y(target)}" y2="${y(target)}"/>
    <text class="chart-target-label" x="${width - padding.right}" y="${y(target) - 7}" text-anchor="end">目标 ${formatNumber(target, 0)} ${escapeSvg(unit)}</text>
  `;
  const summaryValues = numericValues.filter(value => value > 0);
  const average = summaryValues.length ? summaryValues.reduce((sum, value) => sum + value, 0) / summaryValues.length : 0;
  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeSvg(title)}" preserveAspectRatio="xMidYMid meet">
      <desc>${escapeSvg(`${title}，${labels.length} 个数据点，平均值 ${formatNumber(average, 0)} ${unit}。`)}</desc>
      <g class="chart-grid-lines">
        ${ticks.map(tick => `<line x1="${padding.left}" x2="${width - padding.right}" y1="${y(tick)}" y2="${y(tick)}"/><text x="${padding.left - 10}" y="${y(tick) + 4}" text-anchor="end">${formatNumber(tick, 0)}</text>`).join('')}
      </g>
      <path class="chart-area" d="${areaPath}" style="--chart-color:${color}"/>
      <polyline class="chart-line" points="${points}" style="--chart-color:${color}"/>
      <g class="chart-points" style="--chart-color:${color}">${pointMarkup}</g>
      ${targetMarkup}
      <g class="chart-axis-labels">${labelMarkup}</g>
    </svg>
  `;
}

function niceMax(value) {
  const exponent = 10 ** Math.floor(Math.log10(Math.max(value, 1)));
  const fraction = value / exponent;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * exponent;
}

function escapeSvg(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}