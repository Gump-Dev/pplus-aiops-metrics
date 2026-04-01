FROM python:3.12-slim
WORKDIR /app
RUN pip install requests
COPY collect.py .
CMD ["python", "-u", "collect.py"]
