import requests
import json
import time

BASE_URL = "http://localhost:3000/api"

def run_test():
    print(">>> VERIFYING GLOBAL ADMIN PANEL <<<")

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

    # 3. Setup Target User (Provision Key)
    print("3. Setup Target User...")
    res = requests.post(f"{BASE_URL}/admin/create-local-user", json={"username": "TargetUser"}, headers=auth_headers)
    data = res.json()
    key = data.get('key')
    print(f"   Key Generated: {key}")

    # 3b. Activate User
    print("3b. Activating User...")
    act_payload = {
        "licenseKey": key,
        "username": "TargetUser",
        "accessCode": "12345",
        "deviceId": "target-dev-1"
    }
    res = requests.post(f"{BASE_URL}/auth/activate", json=act_payload, headers=headers)
    if res.status_code == 200:
        print("✅ User Activated")
    else:
        print(f"❌ Activation Failed: {res.text}")
        return

    time.sleep(1)

    res_list = requests.get(f"{BASE_URL}/admin/users", headers=auth_headers)
    users = res_list.json()
    print(f"Users found: {len(users)}")

    target = next((u for u in users if u['username'] == "TargetUser"), None)
    if target:
        uid = target['id']
        print(f"   Target ID: {uid}")

        # Block
        print("4. Testing Block User...")
        res = requests.post(f"{BASE_URL}/admin/block-user/{uid}", headers=auth_headers)
        if res.status_code == 200: print("✅ Block Success")
        else: print(f"❌ Block Failed: {res.status_code}")

        # Reset Device
        print("6. Testing Device Reset...")
        res = requests.post(f"{BASE_URL}/admin/reset-device/{uid}", headers=auth_headers)
        if res.status_code == 200: print("✅ Reset Success")
        else: print(f"❌ Reset Failed: {res.status_code}")

        # Delete
        print("7. Testing Delete User...")
        res = requests.delete(f"{BASE_URL}/admin/users/{uid}", headers=auth_headers)
        if res.status_code == 200: print("✅ Delete Success")
        else: print(f"❌ Delete Failed: {res.status_code}")

    else:
        print("❌ Target User Not Found in List")

if __name__ == "__main__":
    run_test()
