# 🌙 MoonLauncher

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/moonlauncher/MoonLauncher)](https://github.com/moonlauncher/MoonLauncher/releases)
[![Downloads](https://img.shields.io/github/downloads/moonlauncher/MoonLauncher/total.svg)](https://github.com/moonlauncher/MoonLauncher/releases)

**MoonLauncher** — это современный, быстрый и удобный лаунчер для Minecraft с поддержкой модов, шейдеров и ресурс-паков. Вход через Microsoft, автоматические обновления и чистый интерфейс.

---

## ✨ Особенности

- 🔐 **Microsoft авторизация** — безопасный вход через учётную запись Microsoft
- 🎮 **Поддержка модов** — Forge, Fabric, Quilt. Установка из Modrinth в один клик
- ✨ **Шейдеры** — встроенный менеджер шейдеров (OptiFine, Iris)
- 🖼️ **Ресурс-паки** — управление и переключение прямо из лаунчера
- 🗂️ **Инстансы** — несколько независимых сборок Minecraft на одном компьютере
- 🔄 **Автообновления** — лаунчер обновляется сам, без лишних телодвижений
- ⚡ **Высокая производительность** — лёгкий и не нагружает систему
- 🌍 **Мультиязычность** — русский, английский и другие языки

---

## 🖥️ Системные требования

| Компонент | Минимум |
|---|---|
| ОС | Windows 10/11 (64-bit) |
| Java | JDK 17+ (устанавливается автоматически при первом запуске) |
| ОЗУ | 4 ГБ (рекомендуется 8 ГБ для модов/шейдеров) |
| Видеокарта | С поддержкой OpenGL 3.2+ / GL 4.6 для новых версий Forge |

---

## 📥 Скачать

Последнюю версию можно скачать на [официальном сайте](https://moonlauncher.ru) или в [разделе релизов](https://github.com/moonlauncher/MoonLauncher/releases).

| Платформа | Ссылка |
|-----------|--------|
| 🪟 Windows | [MoonLauncher-Setup.exe](https://moonlauncher.ru/download/MoonLauncher-Setup.exe) |

---

## 🚀 Быстрый старт

1. **Скачай** лаунчер с сайта или из релизов
2. **Установи** (если используешь установщик)
3. **Запусти** MoonLauncher.exe
4. **Войди** через свою учётную запись Microsoft
5. **Выбери** версию Minecraft и моды
6. **Играй!**

---

## 🛠️ Решение частых проблем

<details>
<summary><b>Ошибка входа: «Произошла ошибка при поиске учётной записи»</b></summary>

Убедись, что используешь именно тот email, к которому привязана лицензия Minecraft (Xbox/Microsoft-аккаунт после миграции Mojang). Проверить это можно, войдя на [account.microsoft.com](https://account.microsoft.com) в браузере.
</details>

<details>
<summary><b>Ошибка 429 (Too Many Requests) при входе через Microsoft</b></summary>

Это временная блокировка со стороны Microsoft из-за слишком частых попыток входа. Закрой лаунчер, подожди 15–30 минут и попробуй войти один раз, не нажимая «Далее» повторно. Если используешь VPN/прокси — попробуй временно отключить.
</details>

<details>
<summary><b>Краш при запуске: ResolutionException / module minecraft contains package</b></summary>

Конфликт дублирующихся библиотек Forge/Minecraft. Удали папку `libraries` в `%userprofile%\.moonlauncher\minecraft\` и запусти профиль заново — файлы перекачаются заново.
</details>

<details>
<summary><b>Краш при запуске: Invalid paths argument, contained no existing paths</b></summary>

Часть файлов Forge/Minecraft отсутствует физически (повреждённая или неполная закачка). Удали соответствующие версии в `libraries\net\minecraft\client\` и `libraries\net\minecraftforge\forge\`, затем перезапусти — лаунчер докачает недостающее.
</details>

Если проблема не решается — приложи лог запуска (`.moonlauncher/logs` или экран «Логи запуска» в настройках) при обращении за помощью.

---

## 🤝 Обратная связь и поддержка

Нашёл баг или есть предложение? Открой [issue на GitHub](https://github.com/moonlauncher/MoonLauncher/issues) или напиши в поддержку через официальный сайт.

---

## 📄 Лицензия

Проект распространяется под лицензией [MIT](LICENSE).
