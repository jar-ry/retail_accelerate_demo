FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY retailer/frontend/package.json .
RUN npm install
COPY retailer/frontend/ .
RUN npm run build

FROM python:3.11-slim
WORKDIR /app

COPY retailer/backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY retailer/backend/ ./backend/
COPY --from=frontend-builder /app/frontend/dist ./static/

ENV PORT=8080
ENV HOSTNAME=0.0.0.0
ENV SNOWFLAKE_CONNECTION_NAME=default

EXPOSE 8080

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8080"]
