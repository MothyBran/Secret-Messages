import requests
import json

BASE_URL = "http://localhost:3000/api"

def run_test():
    print(">>> STARTING REAL FLOW VERIFICATION <<<")

    # 1. Login as Admin
    print("1. Logging in as Admin...")
    headers = {
        'User-Agent': 'SecureMessages-Desktop',
        'X-App-Client': 'SecureMessages-Desktop',
        'Content-Type': 'application/json'
    }
    payload = {
        "username": "Admin_User",
        "accessCode": "admin123",
        "deviceId": "dev-123"
    }

    try:
        res = requests.post(f"{BASE_URL}/auth/login", json=payload, headers=headers)
        if res.status_code != 200:
            print(f"❌ Login Failed: {res.text}")
            return

        data = res.json()
        token = data.get('token')
        print(f"✅ Login Success. Token: {token[:10]}...")

        # 2. Access Admin Stats (Verify Token)
        print("2. Checking Admin Stats...")
        auth_headers = headers.copy()
        auth_headers['Authorization'] = f"Bearer {token}"

        res = requests.get(f"{BASE_URL}/admin/stats", headers=auth_headers)
        if res.status_code == 200:
            print("✅ Admin Stats Accessible")
            print(res.json())
        else:
            print(f"❌ Admin Stats Failed: {res.status_code}")

        # 3. Create Local User (License Quota)
        print("3. Creating Local User...")
        user_payload = {
            "username": "Local_User_1",
            "dept": "Sales"
        }
        res = requests.post(f"{BASE_URL}/admin/create-local-user", json=user_payload, headers=auth_headers)
        if res.status_code == 200:
            k_data = res.json()
            print(f"✅ User Created. Key: {k_data.get('key')}")
        else:
            print(f"❌ Create User Failed: {res.text}")

        # 4. Create Support Ticket (As Admin for testing, or assume user flow)
        # We can use /api/support
        print("4. Creating Support Ticket...")
        ticket_payload = {
            "username": "Admin_User",
            "subject": "Test Ticket",
            "message": "This is a test.",
            "email": "test@local"
        }
        res = requests.post(f"{BASE_URL}/support", json=ticket_payload, headers=auth_headers)
        if res.status_code == 200:
            print("✅ Ticket Created")
        else:
            print(f"❌ Ticket Failed: {res.text}")

        # 5. Check Inbox (Admin Ticket List)
        print("5. Checking Admin Ticket List...")
        res = requests.get(f"{BASE_URL}/admin/support-tickets", headers=auth_headers)
        if res.status_code == 200:
            tickets = res.json()
            print(f"✅ Tickets Found: {len(tickets)}")
        else:
            print(f"❌ Fetch Tickets Failed")

    except Exception as e:
        print(f"❌ Exception: {e}")

if __name__ == "__main__":
    run_test()
