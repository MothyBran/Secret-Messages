# SECURE MESSAGES Enterprise - Quick Start Guide

This guide explains how to start the Enterprise Server and perform the initial activation.

## 1. Prerequisites

- **Node.js** (v18 or higher) must be installed.
- The project files must be present on the target machine.

## 2. Installation

Open a terminal in the project root directory and run:

```bash
npm install
```

This installs all necessary dependencies (including the local SQLite driver).

## 3. Starting the Server

To start the Enterprise Server (which operates completely offline after activation), run:

```bash
npm run start
```

*Note: By default, the server listens on **Port 3000** (Standard) or **Port 4000** (Enterprise Mode if configured). Ensure the port is free.*

## 4. Initial Activation

1.  Open your browser and navigate to: `http://localhost:3000` (or `http://localhost:4000` depending on configuration).
2.  You will be redirected to the **Setup / Activation** page.
3.  Enter your **Enterprise Master Key** (provided by sales).
4.  The system will perform a **one-time** check against the central license server.
    *   *Requirement: Internet connection is needed for this single step.*
5.  After successful validation, the system creates the local **Admin Account**.
6.  **Disconnect from the Internet.** The system is now fully operational in air-gapped mode.

## 5. Admin Access

-   **Username:** `admin` (or as defined during setup)
-   **Password:** (The one you set during setup)

You can now manage users, quotas, and view system status via the local dashboard.

## 6. Client Connection

-   Other devices in the local network can access the application via the Host IP: `http://<HOST-IP>:3000`.
-   Encryption keys and contacts are stored strictly locally on each client device.

---
**Security Note:** Do not expose this server to the public internet. It is designed for isolated Intranet/LAN usage.
