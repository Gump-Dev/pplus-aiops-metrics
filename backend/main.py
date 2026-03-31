from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import Optional, List
import requests, os, json, jwt
from datetime import datetime, timezone, timedelta

app = FastAPI(title="PPLUS AI-Ops Metrics", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

# ── Config ──────────────────────────────────────────────
ZABBIX_URL   = "http://172.24.2.243/zabbix/api_jsonrpc.php"
ZABBIX_TOKEN = "c0507cfc75f77bc480c6929e6527236e"

AI_URL   = os.getenv("AI_URL",   "http://10.1.10.202:18789")
AI_KEY   = os.getenv("AI_KEY",   "613f25c27932059e3ba70a4e85fa1626b9c0d7a4cd902a77")
AI_MODEL = os.getenv("AI_MODEL", "anthropic/claude-haiku-4-5")

JWT_SECRET = "pplus-ai-metrics-secret-2026"
JWT_ALGO   = "HS256"

security = HTTPBearer(auto_error=False)

SYSTEM_PROMPT = """คุณเป็น AI Infrastructure Analyst ของ PPLUS ชื่อ "PPLUS-AIOps-M1.0"
สำคัญ: standalone AI ไม่มี memory search/tools/functions - ตอบจาก Context เท่านั้น
ข้อมูล: Zabbix 40 hosts, real-time CPU/memory/disk/network/problems
ตอบภาษาไทยหรืออังกฤษตามที่ถาม, ใช้ markdown table เมื่อเหมาะสม"""

# ── Zabbix Helper ────────────────────────────────────────
def zabbix_api(method: str, params: dict):
    try:
        r = requests.post(ZABBIX_URL, json={
            "jsonrpc": "2.0", "method": method,
            "params": params, "auth": ZABBIX_TOKEN, "id": 1
        }, timeout=10)
        return r.json().get("result", [])
    except Exception as e:
        return []

def get_zabbix_summary():
    hosts = zabbix_api("host.get", {"countOutput": True})
    problems = zabbix_api("problem.get", {"countOutput": True, "recent": True})
    return {
        "hosts": int(hosts) if hosts else 0,
        "problems": int(problems) if problems else 0
    }

def build_context(message: str) -> str:
    msg_lower = message.lower()
    context_parts = []

    # Always include summary
    summary = get_zabbix_summary()
    context_parts.append(f"=== Zabbix Summary ===\nHosts: {summary['hosts']}, Active Problems: {summary['problems']}")

    # Problems
    if any(k in msg_lower for k in ["problem", "alert", "critical", "ปัญหา", "warning"]):
        probs = zabbix_api("problem.get", {
            "recent": True, "limit": 20,
            "selectHosts": ["host", "name"],
            "sortfield": "severity", "sortorder": "DESC",
            "output": ["eventid", "name", "severity", "clock"]
        })
        if probs:
            context_parts.append("=== Active Problems (Top 20) ===")
            severity_map = {"0":"Not classified","1":"Info","2":"Warning","3":"Average","4":"High","5":"Disaster"}
            for p in probs:
                host_name = p.get("hosts", [{}])[0].get("name", "unknown") if p.get("hosts") else "unknown"
                sev = severity_map.get(str(p.get("severity","0")), "unknown")
                ts = datetime.fromtimestamp(int(p.get("clock",0)), tz=timezone(timedelta(hours=7))).strftime("%Y-%m-%d %H:%M")
                context_parts.append(f"- [{sev}] {p.get('name','')} | Host: {host_name} | Time: {ts}")

    # CPU
    if any(k in msg_lower for k in ["cpu", "load", "process"]):
        items = zabbix_api("item.get", {
            "output": ["name", "lastvalue", "hosts"],
            "selectHosts": ["name"],
            "search": {"key_": "system.cpu.util"},
            "sortfield": "lastvalue", "sortorder": "DESC",
            "limit": 10
        })
        if items:
            context_parts.append("=== Top CPU Utilization (Top 10) ===")
            for it in items:
                host_name = it.get("hosts", [{}])[0].get("name", "unknown") if it.get("hosts") else "unknown"
                val = float(it.get("lastvalue", 0))
                context_parts.append(f"- {host_name}: {val:.1f}%")

    # Memory
    if any(k in msg_lower for k in ["memory", "ram", "mem", "หน่วยความจำ"]):
        items = zabbix_api("item.get", {
            "output": ["name", "lastvalue"],
            "selectHosts": ["name"],
            "search": {"key_": "vm.memory.utilization"},
            "sortfield": "lastvalue", "sortorder": "DESC",
            "limit": 10
        })
        if items:
            context_parts.append("=== Top Memory Utilization (Top 10) ===")
            for it in items:
                host_name = it.get("hosts", [{}])[0].get("name", "unknown") if it.get("hosts") else "unknown"
                val = float(it.get("lastvalue", 0))
                context_parts.append(f"- {host_name}: {val:.1f}%")

    # Hosts
    if any(k in msg_lower for k in ["host", "device", "server", "status", "list", "รายการ", "ทั้งหมด"]):
        hosts = zabbix_api("host.get", {
            "output": ["host", "name", "available", "status"],
            "limit": 50
        })
        if hosts:
            avail_map = {"0":"unknown","1":"available","2":"unavailable"}
            context_parts.append("=== All Hosts ===")
            for h in hosts:
                avail = avail_map.get(str(h.get("available","0")), "unknown")
                status = "Enabled" if str(h.get("status","0")) == "0" else "Disabled"
                context_parts.append(f"- {h.get('name',h.get('host',''))} | Availability: {avail} | Status: {status}")

    # Network
    if any(k in msg_lower for k in ["bandwidth", "traffic", "interface", "network", "เน็ต"]):
        items = zabbix_api("item.get", {
            "output": ["name", "lastvalue"],
            "selectHosts": ["name"],
            "search": {"name": "Bits received"},
            "sortfield": "lastvalue", "sortorder": "DESC",
            "limit": 10
        })
        if items:
            context_parts.append("=== Top Network Interface Traffic ===")
            for it in items:
                host_name = it.get("hosts", [{}])[0].get("name", "unknown") if it.get("hosts") else "unknown"
                val = float(it.get("lastvalue", 0))
                mbps = val / 1_000_000
                context_parts.append(f"- {host_name} | {it.get('name','')} | {mbps:.2f} Mbps")

    return "\n".join(context_parts)

# ── Auth ──────────────────────────────────────────────────
class LoginRequest(BaseModel):
    username: str
    password: str

@app.post("/api/auth/login")
def login(req: LoginRequest):
    if req.username != "admin" or req.password != "admin":
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = jwt.encode({
        "sub": req.username,
        "exp": datetime.utcnow() + timedelta(hours=24)
    }, JWT_SECRET, algorithm=JWT_ALGO)
    return {"access_token": token, "token_type": "bearer"}

def verify_token(creds: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    if not creds:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALGO])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    return True

# ── Endpoints ─────────────────────────────────────────────
@app.get("/health")
def health():
    summary = get_zabbix_summary()
    return {
        "status": "ok",
        "zabbix_hosts": summary["hosts"],
        "zabbix_problems": summary["problems"],
        "time": datetime.now(timezone(timedelta(hours=7))).strftime("%Y-%m-%d %H:%M BKK")
    }

@app.get("/api/zabbix/summary")
def zabbix_summary(auth=Depends(verify_token)):
    return get_zabbix_summary()

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    message: str
    messages: Optional[List[ChatMessage]] = []

@app.post("/api/chat")
def chat(req: ChatRequest, auth=Depends(verify_token)):
    context = build_context(req.message)
    user_content = f"Context:\n{context}\n\nคำถาม: {req.message}"

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    # Add history (last 6 messages)
    for m in (req.messages or [])[-6:]:
        messages.append({"role": m.role, "content": m.content})
    messages.append({"role": "user", "content": user_content})

    try:
        r = requests.post(
            AI_URL + "/v1/chat/completions",
            headers={"Authorization": f"Bearer {AI_KEY}", "Content-Type": "application/json"},
            json={"model": AI_MODEL, "messages": messages, "max_tokens": 1024},
            timeout=60
        )
        data = r.json()
        answer = data["choices"][0]["message"]["content"]
        return {"reply": answer}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
