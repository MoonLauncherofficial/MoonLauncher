# 🌙 MoonLauncher

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/MoonLauncherofficial/MoonLauncher)](https://github.com/MoonLauncherofficial/MoonLauncher/releases)
[![Downloads](https://img.shields.io/github/downloads/MoonLauncherofficial/MoonLauncher/total.svg)](https://github.com/MoonLauncherofficial/MoonLauncher/releases)

**MoonLauncher** — лаунчер для Minecraft на Electron с поддержкой модов, шейдеров, ресурс-паков и входом через Microsoft.

---

## ✨ Особенности

- 🔐 **Microsoft/Xbox авторизация** — полноценный OAuth-вход (MSA → Xbox Live → XSTS)
- 🎮 **Загрузчики модов** — Forge, NeoForge, Fabric, Quilt
- 📦 **Установка из Modrinth** — моды, шейдеры и ресурс-паки прямо из лаунчера (Modrinth API v2)
- ☕ **Автозагрузка Java** — если подходящей JRE нет, лаунчер сам скачает и распакует нужную версию (Eclipse Temurin)
- 🗂️ **Инстансы** — несколько независимых профилей/сборок, с возможностью дублирования
- 🌐 **Серверы** — пинг серверов и список рекомендуемых
- 🔗 **Обмен сборками** — экспорт/импорт инстанса по короткому коду
- 🔄 **Автообновление лаунчера**
- 🌍 **Локализация** — русский и английский
- 🪟 **Кастомный интерфейс** — окно без системной рамки

---

## 🖥️ Системные требования

| Компонент | Минимум |
|---|---|
| ОС | Windows 10/11 (64-bit) |
| Java | Не требуется вручную — лаунчер скачает нужную версию автоматически |
| ОЗУ | 4 ГБ (рекомендуется 8 ГБ для модов/шейдеров) |
| Видеокарта | С поддержкой OpenGL 3.2+ / GL 4.6 для современных версий Forge |

---

## 📥 Скачать

Последнюю версию можно скачать на [официальном сайте](https://moonlauncher.ru) или в [разделе релизов](https://github.com/MoonLauncherofficial/MoonLauncher/releases).

| Платформа | Ссылка |
|-----------|--------|
| 🪟 Windows | [MoonLauncher-Setup.exe](https://moonlauncher.ru/download/MoonLauncher-Setup.exe) |

---

## 🚀 Быстрый старт

1. **Скачай** лаунчер с сайта или из релизов
2. **Установи** (если используешь установщик)
3. **Запусти** MoonLauncher.exe
4. **Войди** через свою учётную запись Microsoft
5. **Выбери** версию Minecraft, загрузчик модов и нужные моды
6. **Играй!**

---

## 🛠️ Решение частых проблем

<details>
<summary><b>Ошибка входа: «Произошла ошибка при поиске учётной записи»</b></summary>

Убедись, что используешь именно тот email, к которому привязана лицензия Minecraft (Xbox/Microsoft-аккаунт после миграции Mojang).
</details>

<details>
<summary><b>Ошибка 429 (Too Many Requests) при входе через Microsoft</b></summary>

Временная блокировка со стороны Microsoft из-за частых попыток входа. Закрой лаунчер, подожди 15–30 минут и попробуй снова, не нажимая «Далее» несколько раз подряд.
</details>

<details>
<summary><b>Краш: ResolutionException / module minecraft contains package</b></summary>

Конфликт дублирующихся библиотек Forge/Minecraft. Удали папку `libraries` в `%userprofile%\.moonlauncher\minecraft\` и запусти профиль заново.
</details>

<details>
<summary><b>Краш: Invalid paths argument, contained no existing paths</b></summary>

Часть файлов Forge/Minecraft отсутствует (повреждённая или неполная закачка). Удали версии в `libraries\net\minecraft\client\` и `libraries\net\minecraftforge\forge\`, затем перезапусти для повторной закачки.
</details>

---

## 🤝 Обратная связь

- [Discord](https://discord.gg/pqtJZ5GFkk)
- [Issues на GitHub](https://github.com/MoonLauncherofficial/MoonLauncher/issues)

---

## 📄 Лицензия

MIT.
