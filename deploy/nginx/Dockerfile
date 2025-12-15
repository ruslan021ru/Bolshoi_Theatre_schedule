FROM nginx:stable-alpine

# Кладём ваш index.html и статику в стандартную папку
COPY ../web /usr/share/nginx/html
# Кладём свой конфиг
COPY nginx.conf /etc/nginx/nginx.conf