# Архитектура

> Пометка **(планируется)** означает, что папки или модуля ещё нет. Всё без пометки уже создано.

## Структура папок
- `site/` — публикуемый сайт (только он попадает на GitHub Pages). Точка входа `site/index.html`.
- `site/css/` — стили (`style.css`: токены цветов, светлая и тёмная тема).
- `site/js/` — ES-модули приложения: `main.js`, `catalog.js`.
- `site/data/` — каталог оборудования в JSON: `index.json` (список брендов) и по файлу на бренд (`hager.json`).
- `site/i18n/` — файлы переводов `ru.json`, `lt.json`, `en.json` **(планируется, этап 7)**.
- `tests/` — тесты `node --test` (файлы `*.test.js`): сервер, `index.html`, workflow публикации, каталог (схема и настоящие данные).
- `tools/` — скрипты для разработки: `serve.js`, локальный сервер для `site/`.
- `docs/` — документация проекта.
- `.github/workflows/` — `pages.yml`: тесты (Node 22 и 26) на каждый push и pull request, публикация `site/` на GitHub Pages только из `main` и только после тестов.

Файлы в корне: `package.json` (без зависимостей, только `"type": "module"`, `engines` и команды `npm start` / `npm test`), `.gitignore`, `.gitattributes` (переводы строк LF во всех текстовых файлах), `AGENTS.md`, `PLAN.md`.

## Как устроено
Сайт работает без сборки: браузер загружает `site/index.html`, а тот подключает `css/style.css` и `js/main.js` как ES-модуль. Все пути относительные, потому что на GitHub Pages сайт открывается из подпапки (`/<repo>/`).

Опубликованный сайт: https://official-fedorenko.github.io/dinboard/ (репозиторий `official-fedorenko/dinboard`, публикует `.github/workflows/pages.yml` при push в `main`).

`tools/serve.js` нужен только для локальной разработки: отдаёт файлы из `site/`, слушает только `127.0.0.1`, не выпускает запросы за пределы `site/`. Функции `resolveRequestPath`, `contentType` и `createSiteServer` экспортируются для тестов.

Модули в `site/js/` делятся на две группы.

Логика (без DOM, тестируется в Node):
- `catalog.js` — схема каталога, проверка (`validateIndex`, `validateBrandFile`, `validateCatalog`, `categorySchema`) и загрузка (`loadCatalog(baseUrl, fetchJson)`). Подробно — в разделе «Каталог».
- `board.js` **(планируется)** — модель щита: корпус, ряды DIN-реек, расставленные устройства, подсчёт занятых и свободных модулей.
- `storage.js` **(планируется)** — сериализация сборки: localStorage, ссылка, файл проекта; проверка входящих данных.
- `i18n.js` **(планируется)** — выбор языка и получение строк перевода.

Интерфейс (работает с DOM):
- `main.js` — точка входа. Сейчас только ставит `data-app-state="ready"` на `<html>`. Дальше будет связывать модули.
- `render-svg.js` — отрисовка щита и устройств в SVG по данным модели **(планируется)**.
- `ui.js` — выбор корпуса, панель оборудования, действия пользователя **(планируется)**.

Связи (по плану): `main.js` загружает каталог (`catalog.js`) и переводы (`i18n.js`), создаёт модель (`board.js`), восстанавливает сборку (`storage.js`), передаёт модель в `ui.js` и `render-svg.js`.

## Каталог
Формат версии `schemaVersion: 1`. Проверка строгая: обязательные поля, допустимые значения, неизвестные поля запрещены (ловит опечатки); учитываются только собственные поля объектов, так что имена вроде `constructor` или `__proto__` не проходят. Тест `tests/catalog.test.js` проверяет и схему, и настоящие файлы в `site/data/`.

- `index.json`: `{ schemaVersion, brands: [{ id, name, file }] }`. `file` — только имя вида `brand.json` в той же папке.
- `<brand>.json`: `{ schemaVersion, brand: { id, name }, enclosures: [...], devices: [...] }`.
- Общие поля позиций: `id` (уникален во всём каталоге, вида `hager-mbn116`), `brand`, `series`, `article` (артикул производителя), `verified` (проверено по официальному источнику), `source` (ссылка https на источник; обязательна при `verified: true`), `notes` (необязательно; служебная заметка для разработчиков на русском, в интерфейсе не показывается).
- Корпус (`enclosures`): `mounting` (`surface` — накладной, `flush` — встраиваемый), `rows`, `modulesPerRow`, `material` (`plastic`/`metal`), `door` (`transparent`/`opaque`/`none`), `ipRating` (число, например 41), `dimensionsMm` `{ width, height, depth }` (мм, допускаются дробные, например 96.5).
- Устройство (`devices`): `category`, `modules` (ширина в модулях, шаг 0.5), `specs` — набор полей зависит от категории:
  - `mcb` — автомат: `poles`, `ratedCurrentA`, `curve` (B/C/D), `breakingCapacityKa`;
  - `rcd` — УЗО: `poles` (1P+N/2P/3P+N/4P, как у производителя), `ratedCurrentA`, `sensitivityMa`, `rcdType` (AC/A/F/B);
  - `rcbo` — дифавтомат: поля `mcb` + `sensitivityMa`, `rcdType`;
  - `switch` — выключатель нагрузки: `poles`, `ratedCurrentA`;
  - `spd` — УЗИП: `poles`, `spdType` (1, 1+2, 1+2+3, 2, 2+3, 3).
- `poles`: `1P`, `1P+N`, `2P`, `3P`, `3P+N`, `4P`.

Сейчас в каталоге Hager: корпуса Volta (накладные VA..B и встраиваемые VU..NE, 1–4 ряда по 12 модулей), автоматы MBN/MCN, УЗО CDA/CDC, дифавтоматы ADA/ADC, выключатели нагрузки SBN, УЗИП SPE/SPB/SPA — 8 корпусов и 62 устройства.

Названия позиций в интерфейсе собираются из этих полей и переводов, поэтому в данных нет текстов на конкретном языке.

## Потоки данных
Сейчас интерфейс каталог ещё не использует (этап 4). По плану:
1. Каталог: `site/data/*.json` → `catalog.js` (проверка) → списки корпусов и устройств в интерфейсе.
2. Сборка: действие пользователя в `ui.js` → изменение модели в `board.js` → перерисовка в `render-svg.js` → сохранение в localStorage через `storage.js`.
3. Восстановление: ссылка (URL) / файл проекта / localStorage → `storage.js` (проверка) → модель `board.js`.
