FROM python:3.12-slim

WORKDIR /work

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN pip install --no-cache-dir pytest pytest-json-report

CMD ["pytest", "-q", "--json-report", "--json-report-file=/work/report.json", "/work/tests"]
