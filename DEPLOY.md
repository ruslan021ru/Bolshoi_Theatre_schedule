# Инструкция по развертыванию проекта

Этот проект состоит из двух частей:
1. **Backend API** (FastAPI) - развертывается на Render.com
2. **Frontend** (HTML/JS) - размещается на GitHub Pages или другом статическом хостинге

## Шаг 1: Подготовка репозитория на GitHub

1. Создайте новый репозиторий на GitHub
2. Загрузите весь код проекта в репозиторий:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/your-username/your-repo-name.git
   git push -u origin main
   ```

## Шаг 2: Развертывание API на Render.com

1. Зайдите на [Render.com](https://render.com) и зарегистрируйтесь/войдите
2. Нажмите "New +" → "Web Service"
3. Подключите ваш GitHub репозиторий
4. Настройте сервис:
   - **Name**: `theater-scheduler-api` (или любое другое имя)
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn theater_sched.api.main:app --host 0.0.0.0 --port $PORT`
   - **Plan**: Выберите Free план (или платный, если нужен)

5. Нажмите "Create Web Service"
6. Дождитесь завершения деплоя (обычно 2-5 минут)
7. После успешного деплоя скопируйте URL вашего сервиса (например: `https://theater-scheduler-api.onrender.com`)

## Шаг 3: Развертывание Frontend на GitHub Pages

1. В вашем GitHub репозитории перейдите в **Settings** → **Pages**
2. В разделе **Source** выберите:
   - **Branch**: `main` (или `master`)
   - **Folder**: `/web` (важно указать папку web!)
3. Нажмите **Save**
4. Дождитесь публикации (обычно 1-2 минуты)
5. Ваш сайт будет доступен по адресу: `https://your-username.github.io/your-repo-name/`

## Шаг 4: Настройка Frontend для работы с API

1. Откройте ваш сайт на GitHub Pages
2. Перейдите во вкладку **"Действия"** в планировщике
3. В поле **"API Base URL"** введите URL вашего API с Render.com (например: `https://theater-scheduler-api.onrender.com`)
4. Нажмите **"Сохранить API URL"**
5. Теперь приложение готово к использованию!

## Альтернативный вариант: Развертывание Frontend на Render.com

Если вы хотите разместить Frontend тоже на Render.com:

1. Создайте новый **Static Site** на Render.com
2. Укажите:
   - **Name**: `theater-scheduler-frontend`
   - **Build Command**: (оставьте пустым)
   - **Publish Directory**: `web`
3. После деплоя получите URL и используйте его

## Проверка работы

1. Откройте ваш Frontend сайт
2. Убедитесь, что API URL сохранён правильно
3. Создайте тестовый сценарий:
   - Добавьте сцену
   - Добавьте постановку
   - Добавьте таймслоты
   - Нажмите "Создать сценарий"
4. Если всё работает, вы увидите сообщение "✅ Сценарий создан"

## Решение проблем

### API не отвечает
- Проверьте, что API сервис на Render.com запущен (статус должен быть "Live")
- Проверьте логи в Render.com Dashboard
- Убедитесь, что URL API указан правильно (без завершающего слэша)

### CORS ошибки
- API уже настроен для работы с любыми доменами (`allow_origins=["*"]`)
- Если проблемы остаются, проверьте логи API

### Frontend не загружается
- Убедитесь, что в настройках GitHub Pages указана папка `/web`
- Проверьте, что файлы `index.html` и `app.js` находятся в папке `web`

## Важные замечания

1. **Free план Render.com**:
   - Сервисы на Free плане "засыпают" после 15 минут неактивности
   - Первый запрос после "сна" может занять 30-60 секунд
   - Для production рекомендуется использовать платный план

2. **Хранение данных**:
   - Текущая версия использует in-memory хранилище
   - Данные теряются при перезапуске сервиса
   - Для production рекомендуется добавить базу данных (PostgreSQL на Render.com)

3. **Безопасность**:
   - API настроен для работы с любыми доменами (CORS)
   - Для production рекомендуется ограничить `allow_origins` только вашими доменами

## Дополнительные настройки

### Переменные окружения (если нужны)
В Render.com Dashboard → Environment можно добавить переменные окружения, например:
- `PYTHON_VERSION=3.10.0`
- `LOG_LEVEL=INFO`

### Кастомный домен
В Render.com можно настроить кастомный домен для API:
1. Dashboard → ваш сервис → Settings → Custom Domain
2. Добавьте ваш домен и следуйте инструкциям

