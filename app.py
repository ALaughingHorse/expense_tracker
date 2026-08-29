from __future__ import annotations

import csv
import hashlib
import json
import re
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4


ROOT = Path(__file__).parent.resolve()
PUBLIC = ROOT / "public"
DATA = ROOT / "app_data"
TRANSACTIONS = DATA / "transactions.csv"
MAPPINGS = DATA / "category_mappings.json"
BUDGETS = DATA / "budgets.json"
TRANSACTION_FIELDS = ["id", "date", "type", "granularCategory", "account", "amount", "note", "source", "importedAt"]


def ensure_data_dir() -> None:
    DATA.mkdir(exist_ok=True)


def read_json(path: Path, fallback):
    if not path.exists():
        return fallback
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, value) -> None:
    ensure_data_dir()
    with path.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)


def read_transactions() -> list[dict]:
    if not TRANSACTIONS.exists():
        return []
    with TRANSACTIONS.open("r", encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    for row in rows:
        row["amount"] = float(row["amount"])
    return rows


def write_transactions(rows: list[dict]) -> None:
    ensure_data_dir()
    rows = sorted(rows, key=lambda row: (row["date"], row["id"]))
    with TRANSACTIONS.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=TRANSACTION_FIELDS)
        writer.writeheader()
        for row in rows:
            copy = {field: row.get(field, "") for field in TRANSACTION_FIELDS}
            copy["amount"] = f'{float(copy["amount"]):.2f}'
            writer.writerow(copy)


def normalize_date(value: str) -> str:
    match = re.match(r"^(\d{4})年(\d{1,2})月(\d{1,2})日$", value.strip().lstrip("\ufeff"))
    if not match:
        raise ValueError(f"Unsupported date format: {value}")
    year, month, day = match.groups()
    return f"{year}-{month.zfill(2)}-{day.zfill(2)}"


def normalize_type(value: str) -> str:
    value = value.strip()
    if value == "支出":
        return "expense"
    if value == "收入":
        return "income"
    raise ValueError(f"Unsupported transaction type: {value}")


def parse_sharkapp(text: str) -> list[dict]:
    rows = list(csv.reader(text.lstrip("\ufeff").splitlines(), delimiter="\t"))
    if not rows:
        return []
    header = [cell.strip().lstrip("\ufeff") for cell in rows[0]]
    expected = ["日期", "收支类型", "类别", "账户", "金额", "备注"]
    if header[:6] != expected:
        raise ValueError(f"Unsupported Sharkapp header: {', '.join(header)}")

    parsed = []
    for index, row in enumerate(rows[1:], start=2):
        if not row or all(not cell.strip() for cell in row):
            continue
        if len(row) != 6:
            raise ValueError(f"Row {index} has {len(row)} fields; expected 6.")
        parsed.append(
            {
                "date": normalize_date(row[0]),
                "type": normalize_type(row[1]),
                "granularCategory": row[2].strip(),
                "account": row[3].strip(),
                "amount": float(row[4]),
                "note": row[5].strip(),
            }
        )
    return parsed


def stable_id(row: dict) -> str:
    raw = "|".join(
        [
            row["date"],
            row["type"],
            row["granularCategory"],
            row["account"],
            f'{float(row["amount"]):.2f}',
            row.get("note", ""),
        ]
    )
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def import_sharkapp_rows(rows: list[dict]) -> dict:
    existing = read_transactions()
    known = {row["id"] for row in existing}
    imported = []
    imported_at = datetime.utcnow().isoformat() + "Z"
    for row in rows:
        row_id = stable_id(row)
        if row_id in known:
            continue
        known.add(row_id)
        imported.append({**row, "id": row_id, "source": "sharkapp", "importedAt": imported_at})
    write_transactions(existing + imported)
    return {
        "imported": len(imported),
        "skippedDuplicates": len(rows) - len(imported),
        "totalRows": len(rows),
    }


def app_state() -> dict:
    transactions = read_transactions()
    mappings = read_json(MAPPINGS, [])
    budgets = read_json(BUDGETS, [])
    categories = sorted({row["granularCategory"] for row in transactions if row.get("granularCategory")})
    return {
        "transactions": transactions,
        "mappings": mappings,
        "budgets": budgets,
        "granularCategories": categories,
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC), **kwargs)

    def do_GET(self):
        if self.path == "/api/state":
            self.send_json(app_state())
            return
        if self.path == "/":
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            payload = self.read_json_body()
            if parsed.path == "/api/import/sharkapp":
                rows = parse_sharkapp(payload.get("text", ""))
                self.send_json(import_sharkapp_rows(rows))
                return

            if parsed.path == "/api/import/local-data":
                files = sorted((ROOT / "local_data").glob("*.csv")) + sorted((ROOT / "local_data").glob("*.tsv"))
                total = {"imported": 0, "skippedDuplicates": 0, "totalRows": 0, "processedFiles": []}
                for source in files:
                    text = source.read_text(encoding="utf-16le")
                    result = import_sharkapp_rows(parse_sharkapp(text))
                    total["imported"] += result["imported"]
                    total["skippedDuplicates"] += result["skippedDuplicates"]
                    total["totalRows"] += result["totalRows"]
                    total["processedFiles"].append(source.name)
                    source.unlink()
                self.send_json(total)
                return

            if parsed.path == "/api/income":
                existing = read_transactions()
                row_id = payload.get("id") or str(uuid4())
                prior = next((row for row in existing if row["id"] == row_id and row["type"] == "income"), None)
                income = {
                    "id": row_id,
                    "date": payload["date"],
                    "type": "income",
                    "granularCategory": payload.get("granularCategory") or "工资",
                    "account": payload.get("account") or (prior["account"] if prior else "manual"),
                    "amount": float(payload["amount"]),
                    "note": payload.get("note") or "",
                    "source": prior["source"] if prior else "manual",
                    "importedAt": prior["importedAt"] if prior else datetime.utcnow().isoformat() + "Z",
                }
                write_transactions([row for row in existing if row["id"] != row_id] + [income])
                self.send_json(income)
                return

            self.send_error(404)
        except Exception as error:
            self.send_json({"error": str(error)}, status=400)

    def do_PUT(self):
        try:
            payload = self.read_json_body()
            if self.path == "/api/mappings":
                write_json(MAPPINGS, payload)
                self.send_json(payload)
                return
            if self.path == "/api/budgets":
                write_json(BUDGETS, payload)
                self.send_json(payload)
                return
            self.send_error(404)
        except Exception as error:
            self.send_json({"error": str(error)}, status=400)

    def do_DELETE(self):
        if not self.path.startswith("/api/income/"):
            self.send_error(404)
            return
        row_id = self.path.rsplit("/", 1)[-1]
        rows = read_transactions()
        target = next((row for row in rows if row["id"] == row_id), None)
        if not target or target["type"] != "income":
            self.send_error(404)
            return
        write_transactions([row for row in rows if row["id"] != row_id])
        self.send_response(204)
        self.end_headers()

    def read_json_body(self):
        length = int(self.headers.get("content-length", 0))
        body = self.rfile.read(length).decode("utf-8")
        return json.loads(body or "{}")

    def send_json(self, payload, status=200):
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def main() -> None:
    ensure_data_dir()
    server = ThreadingHTTPServer(("127.0.0.1", 4177), Handler)
    print("Expense tracker running at http://127.0.0.1:4177")
    server.serve_forever()


if __name__ == "__main__":
    main()
