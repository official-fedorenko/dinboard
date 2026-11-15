// Подписи корпусов и устройств из данных каталога и переводов. Модуль без DOM.
// t — функция перевода из i18n.js.

/** Число без лишних нулей: 1, 1.5, 96.5. */
export function num(value) {
  return String(Number(value));
}

/** Короткая подпись на самом устройстве в щите: { main, sub }. */
export function deviceLabel(device, t) {
  const s = device.specs;
  const a = t('unit.a', { n: s.ratedCurrentA });
  switch (device.category) {
    case 'mcb':
      return { main: `${s.curve}${num(s.ratedCurrentA)}`, sub: s.poles };
    case 'rcbo':
      return { main: `${s.curve}${num(s.ratedCurrentA)}`, sub: `${t('unit.ma', { n: s.sensitivityMa })} ${s.rcdType}` };
    case 'rcd':
      return { main: a, sub: `${t('unit.ma', { n: s.sensitivityMa })} ${s.rcdType}` };
    case 'switch':
      return { main: a, sub: s.poles };
    case 'spd':
      return { main: t('spd.type', { type: s.spdType }), sub: s.poles };
    default:
      return { main: device.article, sub: '' };
  }
}

/** Полное название устройства: «Автомат C16, 1P». */
export function deviceTitle(device, t) {
  const s = device.specs;
  const params = {
    poles: s.poles,
    curve: s.curve,
    current: num(s.ratedCurrentA),
    sensitivity: s.sensitivityMa,
    type: s.rcdType ?? s.spdType,
  };
  return t(`device.${device.category}.title`, params);
}

/** Название категории (для вкладок и спецификации). */
export function categoryName(category, t) {
  return t(`category.${category}`);
}

/** Название корпуса: «Volta VA24B». */
export function enclosureTitle(enclosure) {
  return `${enclosure.series} ${enclosure.article}`;
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
  return t('unit.mm3', { w: num(d.width), h: num(d.height), d: num(d.depth) });
}
