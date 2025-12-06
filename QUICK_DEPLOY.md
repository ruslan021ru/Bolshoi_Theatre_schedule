# Быстрая инструкция по деплою

## Проблема: GitHub Pages показывает только папку root

GitHub Pages позволяет выбрать только корневую папку, а не подпапку `/web`. Есть два решения:

## Решение 1: GitHub Actions (автоматическое)

1. **Включите GitHub Pages с GitHub Actions:**
   - Зайдите в **Settings** → **Pages**
   - В разделе **Source** выберите: **GitHub Actions**
   - Нажмите **Save**

2. **Файл `.github/workflows/deploy.yml` уже создан** - он автоматически скопирует файлы из `web/` в корень при каждом push

3. **Сделайте commit и push:**
   ```bash
   git add .
   git commit -m "Add GitHub Actions workflow"
   git push
   ```

4. **Проверьте деплой:**
   - Зайдите во вкладку **Actions** в вашем репозитории
   - Дождитесь завершения workflow "Deploy to GitHub Pages"
   - Ваш сайт будет доступен по адресу: `https://your-username.github.io/your-repo-name/`

## Решение 2: Ручное копирование (проще)

Если GitHub Actions не работает или вы хотите быстро протестировать:

1. **Скопируйте файлы в корень:**
   ```bash
   # В корне проекта
   cp web/index.html index.html
   cp web/app.js app.js
   ```

2. **Настройте GitHub Pages:**
   - Зайдите в **Settings** → **Pages**
   - В разделе **Source** выберите:
     - **Source**: `Deploy from a branch`
     - **Branch**: `main`
     - **Folder**: `/ (root)`
   - Нажмите **Save**

3. **Сделайте commit и push:**
   ```bash
   git add index.html app.js
   git commit -m "Add frontend files to root for GitHub Pages"
   git push
   ```

4. **Дождитесь публикации** (обычно 1-2 минуты)

## После деплоя

1. Откройте ваш сайт на GitHub Pages
2. Перейдите во вкладку **"Действия"** в планировщике
3. Введите URL вашего API с Render.com
4. Нажмите **"Сохранить API URL"**
5. Готово!

## Важно

- Если используете **Решение 2**, при обновлении файлов в `web/` нужно будет снова копировать их в корень
- **Решение 1** автоматически обновляет файлы при каждом push

