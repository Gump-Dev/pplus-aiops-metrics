from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import Optional, List
import requests, os, json, jwt, time
from datetime import datetime, timezone, timedelta

app = FastAPI(title="PPLUS AI-Ops Metrics", version="1.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

# ── Config ──────────────────────────────────────────────
ZABBIX_URL   = "http://172.24.2.243/zabbix/api_jsonrpc.php"
ZABBIX_TOKEN = "c0507cfc75f77bc480c6929e6527236e"
VM_URL       = os.getenv("VM_URL", "http://host-gateway:8428")

AI_URL   = os.getenv("AI_URL",   "http://10.1.10.202:18789")
AI_KEY   = os.getenv("AI_KEY",   "613f25c27932059e3ba70a4e85fa1626b9c0d7a4cd902a77")
AI_MODEL = os.getenv("AI_MODEL", "anthropic/claude-haiku-4-5")

JWT_SECRET = "pplus-ai-metrics-secret-2026"
JWT_ALGO   = "HS256"

security = HTTPBearer(auto_error=False)

SYSTEM_PROMPT = """คุณเป็น AI Infrastructure Analyst ของ PPLUS ชื่อ "PPLUS-AIOps-M1.0"
สำคัญ: standalone AI ไม่มี memory search/tools/functions - ตอบจาก Context เท่านั้น
ข้อมูล: Zabbix 40 hosts, real-time CPU/memory/disk/network/problems + VictoriaMetrics historical trends
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

# ── VictoriaMetrics Helper ───────────────────────────────
def query_vm(promql: str) -> list:
    """Query VictoriaMetrics with PromQL (instant query)"""
    try:
        r = requests.get(f"{VM_URL}/api/v1/query",
                        params={"query": promql},
                        timeout=5)
        if r.status_code == 200:
            data = r.json().get("data", {}).get("result", [])
            return data
    except:
        pass
    return []

def query_vm_range(promql: str, hours: int = 1) -> list:
    """Query VictoriaMetrics range for trends"""
    try:
        end = int(time.time())
        start = end - (hours * 3600)
        r = requests.get(f"{VM_URL}/api/v1/query_range",
                        params={"query": promql, "start": start, "end": end, "step": "5m"},
                        timeout=10)
        if r.status_code == 200:
            return r.json().get("data", {}).get("result", [])
    except:
        pass
    return []

def build_context(message: str) -> str:
    """Always-rich context: fetch all Zabbix data + VM historical trends every query"""
    context_parts = []

    # 1. Summary
    summary = get_zabbix_summary()
    context_parts.append(f"=== Zabbix Summary ===\nTotal Hosts: {summary['hosts']}, Active Problems: {summary['problems']}")

    # 2. ALL Active Problems (always)
    probs = zabbix_api("problem.get", {
        "recent": True, "limit": 30,
        "selectHosts": ["host", "name"],
        "sortfield": "severity", "sortorder": "DESC",
        "output": ["eventid", "name", "severity", "clock"]
    })
    if probs:
        context_parts.append("=== Active Problems ===")
        severity_map = {"0":"Not classified","1":"Info","2":"Warning","3":"Average","4":"High","5":"Disaster"}
        for p in probs:
            host_name = p.get("hosts", [{}])[0].get("name", "unknown") if p.get("hosts") else "unknown"
            sev = severity_map.get(str(p.get("severity","0")), "unknown")
            ts = datetime.fromtimestamp(int(p.get("clock",0)), tz=timezone(timedelta(hours=7))).strftime("%Y-%m-%d %H:%M")
            context_parts.append(f"- [{sev}] {p.get('name','')} | Host: {host_name} | Time: {ts}")
    else:
        context_parts.append("=== Active Problems ===\n- No active problems")

    # 3. ALL Hosts with availability (always)
    hosts = zabbix_api("host.get", {
        "output": ["host", "name", "available", "status"],
        "limit": 60
    })
    if hosts:
        avail_map = {"0":"unknown","1":"available","2":"unavailable"}
        context_parts.append("=== All Hosts Status ===")
        for h in hosts:
            avail = avail_map.get(str(h.get("available","0")), "unknown")
            status = "Enabled" if str(h.get("status","0")) == "0" else "Disabled"
            context_parts.append(f"- {h.get('name',h.get('host',''))} | {avail} | {status}")

    # 4. Top CPU (always)
    cpu_items = zabbix_api("item.get", {
        "output": ["name", "lastvalue"],
        "selectHosts": ["name"],
        "search": {"key_": "system.cpu.util"},
        "sortfield": "lastvalue", "sortorder": "DESC",
        "limit": 10
    })
    if cpu_items:
        context_parts.append("=== Top CPU Utilization ===")
        for it in cpu_items:
            host_name = it.get("hosts", [{}])[0].get("name", "unknown") if it.get("hosts") else "unknown"
            val = float(it.get("lastvalue", 0))
            context_parts.append(f"- {host_name}: {val:.1f}%")

    # 5. Top Memory (always)
    mem_items = zabbix_api("item.get", {
        "output": ["name", "lastvalue"],
        "selectHosts": ["name"],
        "search": {"key_": "vm.memory.utilization"},
        "sortfield": "lastvalue", "sortorder": "DESC",
        "limit": 10
    })
    if mem_items:
        context_parts.append("=== Top Memory Utilization ===")
        for it in mem_items:
            host_name = it.get("hosts", [{}])[0].get("name", "unknown") if it.get("hosts") else "unknown"
            val = float(it.get("lastvalue", 0))
            context_parts.append(f"- {host_name}: {val:.1f}%")

    # 6. Network (always - top 10 interfaces)
    net_items = zabbix_api("item.get", {
        "output": ["name", "lastvalue"],
        "selectHosts": ["name"],
        "search": {"name": "Bits received"},
        "sortfield": "lastvalue", "sortorder": "DESC",
        "limit": 10
    })
    if net_items:
        context_parts.append("=== Top Network Interface Traffic ===")
        for it in net_items:
            host_name = it.get("hosts", [{}])[0].get("name", "unknown") if it.get("hosts") else "unknown"
            val = float(it.get("lastvalue", 0))
            mbps = val / 1_000_000
            context_parts.append(f"- {host_name} | {it.get('name','')} | {mbps:.2f} Mbps")

    # 7. Historical trends from VictoriaMetrics (last 1h)
    cpu_trend = query_vm("topk(5, zabbix_cpu_util)")
    if cpu_trend:
        context_parts.append("=== CPU Trend (current top 5, from VictoriaMetrics) ===")
        for metric in cpu_trend:
            host = metric.get("metric", {}).get("host", "unknown")
            val = float(metric.get("value", [0, "0"])[1])
            context_parts.append(f"- {host}: {val:.1f}%")

    # CPU hosts that spiked in last 1h
    cpu_history = query_vm_range("max_over_time(zabbix_cpu_util[1h])", hours=1)
    if cpu_history:
        high_cpu = []
        for m in cpu_history:
            if m.get("values"):
                host = m.get("metric", {}).get("host", "?")
                max_val = max(float(v[1]) for v in m["values"])
                high_cpu.append((host, max_val))
        high_cpu = [(h, v) for h, v in high_cpu if v > 80]
        if high_cpu:
            context_parts.append("=== Hosts with CPU > 80% in last 1h (VictoriaMetrics) ===")
            for host, val in sorted(high_cpu, key=lambda x: -x[1])[:5]:
                context_parts.append(f"- {host}: max {val:.1f}%")

    # Memory trend from VM
    mem_trend = query_vm("topk(5, zabbix_memory_util)")
    if mem_trend:
        context_parts.append("=== Memory Trend (current top 5, from VictoriaMetrics) ===")
        for metric in mem_trend:
            host = metric.get("metric", {}).get("host", "unknown")
            val = float(metric.get("value", [0, "0"])[1])
            context_parts.append(f"- {host}: {val:.1f}%")

    # 7. Device-specific: FortiGate
    forti_hosts = zabbix_api("host.get", {
        "output": ["hostid", "host", "name", "available"],
        "search": {"name": "Fortigate"},
        "searchCaseSensitive": False
    })
    if forti_hosts:
        context_parts.append("=== FortiGate Devices ===")
        for h in forti_hosts:
            avail = {"0":"unknown","1":"available","2":"unavailable"}.get(str(h.get("available","0")), "unknown")
            context_parts.append(f"- {h['name']} ({h['host']}) | Status: {avail}")
            # Get FortiGate items
            items = zabbix_api("item.get", {
                "output": ["name", "lastvalue", "units", "key_"],
                "hostids": [h["hostid"]],
                "limit": 20,
                "sortfield": "name"
            })
            for it in items[:10]:
                val = it.get("lastvalue","")
                if val and val != "0":
                    context_parts.append(f"  · {it['name']}: {val} {it.get('units','')}")

    # 8. Device-specific: Juniper EX4300
    juniper_hosts = zabbix_api("host.get", {
        "output": ["hostid", "host", "name", "available"],
        "search": {"name": "EX4300"},
        "searchCaseSensitive": False
    })
    if juniper_hosts:
        context_parts.append("=== Juniper EX4300 Devices ===")
        for h in juniper_hosts:
            avail = {"0":"unknown","1":"available","2":"unavailable"}.get(str(h.get("available","0")), "unknown")
            context_parts.append(f"- {h['name']} ({h['host']}) | Status: {avail}")
            items = zabbix_api("item.get", {
                "output": ["name", "lastvalue", "units", "key_"],
                "hostids": [h["hostid"]],
                "limit": 20,
                "sortfield": "name"
            })
            for it in items[:10]:
                val = it.get("lastvalue","")
                if val and val != "0":
                    context_parts.append(f"  · {it['name']}: {val} {it.get('units','')}")

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
    # Check VM status
    vm_status = "ok"
    try:
        r = requests.get(f"{VM_URL}/health", timeout=3)
        vm_status = "ok" if r.status_code == 200 else "error"
    except:
        vm_status = "unavailable"
    return {
        "status": "ok",
        "zabbix_hosts": summary["hosts"],
        "zabbix_problems": summary["problems"],
        "victoriametrics": vm_status,
        "time": datetime.now(timezone(timedelta(hours=7))).strftime("%Y-%m-%d %H:%M BKK")
    }

@app.get("/api/zabbix/summary")
def zabbix_summary(auth=Depends(verify_token)):
    return get_zabbix_summary()

@app.get("/api/vm/query")
def vm_query(q: str, auth=Depends(verify_token)):
    """Query VictoriaMetrics directly"""
    return {"result": query_vm(q)}

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
