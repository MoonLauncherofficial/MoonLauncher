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
- 🔄 **Автообновления** — лаунчер обновляется сам, без лишних телодвижений
- ⚡ **Высокая производительность** — лёгкий и не нагружает систему
- 🌍 **Мультиязычность** — русский, английский и другие языки
- 🖥️ **Кроссплатформенность** — Windows, Mac и Linux (в планах)

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

## 🛠️ Сборка из исходников

### Требования
- Visual Studio 2022 (или новее)
- .NET 8.0 SDK
- Git

### Клонирование и сборка
```bash
git clone https://github.com/moonlauncher/MoonLauncher.git
cd MoonLauncher
dotnet restore
dotnet build -c Release
