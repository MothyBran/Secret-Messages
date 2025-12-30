import requests
import json
import time

def run():
    base_url = "http://localhost:3000"

    # 1. Test Ping
    print("Testing /api/ping...")
    try:
        resp = requests.get(f"{base_url}/api/ping", timeout=2)
        if resp.status_code == 200 and resp.json().get('status') == 'ok':
            print("Ping Success!")
        else:
            print(f"Ping Failed: {resp.status_code} {resp.text}")
    except Exception as e:
        print(f"Ping Error: {e}")

    # 2. Test Support Endpoint (Expect 500 or 200, but not timeout)
    print("Testing /api/support...")
    payload = {
        "username": "TestUser",
        "subject": "Robustness Test",
        "email": "test@example.com",
        "message": "Testing backend timeout handling."
    }

    start_time = time.time()
    try:
        # We expect a response within 8-9 seconds max due to backend timeout
        resp = requests.post(f"{base_url}/api/support", json=payload, timeout=10)
        elapsed = time.time() - start_time
        print(f"Support Request took {elapsed:.2f} seconds")
        print(f"Status Code: {resp.status_code}")
        print(f"Response: {resp.text}")

        if elapsed > 9:
            print("Warning: Response took a long time, possibly hitting timeout fallback.")

    except Exception as e:
        print(f"Support Error: {e}")

if __name__ == "__main__":
    run()
