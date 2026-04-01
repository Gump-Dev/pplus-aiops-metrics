#!/usr/bin/env python3
"""
Collect Zabbix metrics and push to VictoriaMetrics every 60s
"""
import requests, time, os
from datetime import datetime

ZABBIX_URL = "http://172.24.2.243/zabbix/api_jsonrpc.php"
ZABBIX_TOKEN = "c0507cfc75f77bc480c6929e6527236e"
VM_URL = os.getenv("VM_URL", "http://host-gateway:8428")

def zabbix_api(method, params):
    r = requests.post(ZABBIX_URL, json={
        "jsonrpc": "2.0", "method": method,
        "params": params, "auth": ZABBIX_TOKEN, "id": 1
    }, timeout=15)
    return r.json().get("result", [])

def push_to_vm(metrics_text):
    """Push Prometheus format metrics to VictoriaMetrics"""
    r = requests.post(f"{VM_URL}/api/v1/import/prometheus",
                     data=metrics_text, timeout=15)
    return r.status_code == 204

def safe_label(val):
    """Sanitize label values for Prometheus format"""
    return str(val).replace('"', "'").replace('\n', ' ')

def collect():
    # Get all hosts
    hosts = zabbix_api("host.get", {
        "output": ["hostid", "host", "name", "available"],
        "limit": 100
    })
    host_map = {h["hostid"]: h for h in hosts}

    # Get CPU utilization items
    cpu_items = zabbix_api("item.get", {
        "output": ["itemid", "hostid", "key_", "lastvalue", "lastclock"],
        "search": {"key_": "system.cpu.util"},
        "selectHosts": ["hostid"],
        "limit": 200
    })

    # Get memory items
    mem_items = zabbix_api("item.get", {
        "output": ["itemid", "hostid", "key_", "lastvalue", "lastclock"],
        "search": {"key_": "vm.memory.utilization"},
        "selectHosts": ["hostid"],
        "limit": 200
    })

    # Get network items (bits received/sent)
    net_items = zabbix_api("item.get", {
        "output": ["itemid", "hostid", "name", "key_", "lastvalue", "lastclock"],
        "search": {"name": "Bits"},
        "selectHosts": ["hostid"],
        "limit": 200
    })

    # Build Prometheus format
    lines = []
    now_ms = int(time.time() * 1000)

    # Host availability
    for h in hosts:
        avail = int(h.get("available", 0))
        host_val = safe_label(h["host"])
        name_val = safe_label(h["name"])
        lines.append(
            'zabbix_host_available{host="' + host_val + '",name="' + name_val + '"} ' +
            str(avail) + ' ' + str(now_ms)
        )

    # CPU
    for item in cpu_items:
        hid = item["hostid"]
        host = safe_label(host_map.get(hid, {}).get("host", "unknown"))
        val = item.get("lastvalue", "0")
        ts = int(item.get("lastclock", time.time())) * 1000
        try:
            lines.append('zabbix_cpu_util{host="' + host + '"} ' + str(float(val)) + ' ' + str(ts))
        except: pass

    # Memory
    for item in mem_items:
        hid = item["hostid"]
        host = safe_label(host_map.get(hid, {}).get("host", "unknown"))
        val = item.get("lastvalue", "0")
        ts = int(item.get("lastclock", time.time())) * 1000
        try:
            lines.append('zabbix_memory_util{host="' + host + '"} ' + str(float(val)) + ' ' + str(ts))
        except: pass

    # Network
    for item in net_items:
        hid = item["hostid"]
        host = safe_label(host_map.get(hid, {}).get("host", "unknown"))
        val = item.get("lastvalue", "0")
        metric_name = "bits_recv" if "received" in item.get("name","").lower() else "bits_sent"
        ts = int(item.get("lastclock", time.time())) * 1000
        try:
            lines.append('zabbix_network_' + metric_name + '{host="' + host + '"} ' + str(float(val)) + ' ' + str(ts))
        except: pass

    if lines:
        result = push_to_vm("\n".join(lines))
        ts_str = datetime.now().strftime("%H:%M:%S")
        status = "OK" if result else "FAIL"
        print(f"[{ts_str}] Pushed {len(lines)} metrics to VM ({VM_URL}) - {status}")
    else:
        print("No metrics collected")

if __name__ == "__main__":
    print(f"Starting Zabbix -> VictoriaMetrics collector...")
    print(f"VM_URL: {VM_URL}")
    while True:
        try:
            collect()
        except Exception as e:
            print(f"Error: {e}")
        time.sleep(60)
