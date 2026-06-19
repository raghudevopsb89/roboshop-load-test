FROM python:3.12-slim
WORKDIR /app

ARG BUILD_ID=dev
ENV BUILD_ID=${BUILD_ID}

COPY pyproject.toml ./
RUN pip install --no-cache-dir .

COPY app.py ./
COPY entrypoint.sh /entrypoint.sh
COPY load-test.js ./

RUN chmod +x /entrypoint.sh

EXPOSE 5000

ENTRYPOINT ["/entrypoint.sh"]
