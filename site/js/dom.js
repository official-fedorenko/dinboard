// Помощники для работы с DOM.

/**
 * Применяет стили к CSSStyleDeclaration.
 * CSS-переменные (--name) задаются только через setProperty: присваивание
 * style['--name'] создаёт обычное JS-поле, и браузер его не видит.
 */
export function applyStyle(style, values) {
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined) continue;
    if (key.startsWith('--')) style.setProperty(key, String(value));
    else style[key] = value;
  }
}

/**
 * Создаёт DOM-элемент. Строки-потомки вставляются как текст (не HTML).
 * props: class, style (объект), dataset (объект), onXxx (обработчики), остальное — атрибуты.
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style') applyStyle(el.style, value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}
