// Подписи корпусов и устройств из данных каталога и переводов. Модуль без DOM.
// t — функция перевода из i18n.js.

import { formatNumber } from './i18n.js';

/** Число без лишних нулей по правилам языка: 1, 1,5 (ru/lt), 1.5 (en). Без языка — 1.5. */
export function num(value, lang) {
  return formatNumber(value, lang);
}

/** Короткая подпись на самом устройстве в щите: { main, sub }. */
export function deviceLabel(device, t) {
  const s = device.specs;
  const a = t('unit.a', { n: num(s.ratedCurrentA, t.lang) });
  switch (device.category) {
    case 'mcb':
      return { main: `${s.curve}${num(s.ratedCurrentA, t.lang)}`, sub: s.poles };
    case 'rcbo':
      return { main: `${s.curve}${num(s.ratedCurrentA, t.lang)}`, sub: `${t('unit.ma', { n: s.sensitivityMa })} ${s.rcdType}` };
    case 'rcd':
      return { main: a, sub: `${t('unit.ma', { n: s.sensitivityMa })} ${s.rcdType}` };
    case 'switch':
      return { main: a, sub: s.poles };
    case 'spd':
      return { main: t('spd.type', { type: s.spdType }), sub: s.poles };
    case 'terminal':
      return { main: s.role, sub: s.clamps ? t('terminal.clampsShort', { n: s.clamps.reduce((sum, [c]) => sum + c, 0) }) : '' };
    case 'distribution':
      return { main: s.poles, sub: s.ratedCurrentA ? a : '' };
    default:
      return { main: device.article, sub: '' };
  }
}

/** Полное название устройства: «Автомат C16, 1P». */
export function deviceTitle(device, t) {
  const s = device.specs;
  // Клеммы и ток — необязательные у клеммников и блоков: «, 2×25 + 7×16 мм²», «, 63 А»
  const clamps = s.clamps ? `, ${t('unit.clamps', { list: s.clamps.map(([c, mm2]) => `${c}×${num(mm2, t.lang)}`).join(' + ') })}` : '';
  const current = s.ratedCurrentA ? `, ${t('unit.a', { n: num(s.ratedCurrentA, t.lang) })}` : '';
  const params = {
    poles: s.poles,
    curve: s.curve,
    current: num(s.ratedCurrentA, t.lang),
    sensitivity: s.sensitivityMa,
    type: s.rcdType ?? s.spdType,
    role: s.role,
    details: device.category === 'terminal' ? clamps : device.category === 'distribution' ? current + clamps : '',
  };
  return t(`device.${device.category}.title`, params);
}

/** Название категории (для вкладок и спецификации). */
export function categoryName(category, t) {
  return t(`category.${category}`);
}

/** Название корпуса: «Volta VA24B» (тип, а если его нет — артикул). */
export function enclosureTitle(enclosure) {
  return `${enclosure.series} ${enclosure.model ?? enclosure.article}`;
}

/** Производитель и тип: «ABB S201-C16» или просто «Hager». */
export function deviceRef(device, brandName) {
  return device.model ? `${brandName} ${device.model}` : brandName;
}

/** Описание корпуса: «накладной · 2 × 12 мод. · IP30 · без дверцы». */
export function enclosureDescription(enclosure, t) {
  return [
    t(`mounting.${enclosure.mounting}`),
    t('enclosure.layout', { rows: enclosure.rows, modules: enclosure.modulesPerRow }),
    `IP${enclosure.ipRating}`,
    t(`door.${enclosure.door}`),
  ].join(' · ');
}

/** Размеры корпуса: «305 × 370 × 96.5 мм». */
export function enclosureSize(enclosure, t) {
  const d = enclosure.dimensionsMm;
  return t('unit.mm3', { w: num(d.width, t.lang), h: num(d.height, t.lang), d: num(d.depth, t.lang) });
}
