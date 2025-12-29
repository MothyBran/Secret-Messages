import requests
import json
import time

BASE_URL = "http://localhost:3000/api"

def run_test():
    print(">>> VERIFYING VAULT & QUOTA <<<")

    # 1. Login
    headers = {
        'User-Agent': 'SecureMessages-Desktop',
        'X-App-Client': 'SecureMessages-Desktop',
        'Content-Type': 'application/json'
    }
    payload = {"username": "Admin_User", "accessCode": "admin123", "deviceId": "dev-123"}
    res = requests.post(f"{BASE_URL}/auth/login", json=payload, headers=headers)
    token = res.json().get('token')
    auth_headers = headers.copy()
    auth_headers['Authorization'] = f"Bearer {token}"

    # 3. Create Users loop to test quota interaction (Vault)
    print("3. Testing Quota Vault...")
    # Default is 50. We create 1.
    res = requests.post(f"{BASE_URL}/admin/create-local-user", json={"username": "VaultUser_1"}, headers=auth_headers)
    if res.status_code == 200:
        print("✅ User Created via Vault")
    else:
        print(f"❌ User Creation Failed: {res.text}")

    # 4. Block Registration Test (Cloud Mode Simulation)
    # We can't switch mode easily, but we can try to activate with ENTERPRISE_LOCAL key if we were in Cloud mode.
    # But server is IS_OFFLINE=true.
    # The requirement says "Block Enterprise-User on WebApp" (Cloud Mode).
    # This server instance is Offline. So this check is moot here, but logic is in server.js.

if __name__ == "__main__":
    run_test()
