# Payroll System

A professional payroll management web application for managing workers, payment batches, and payroll status.

## Current version
- Login/authentication
- Dashboard
- Worker management
- Payment batches
- Pay All Workers (mock/sandbox provider)
- Payment status tracking
- Webhook endpoint
- Audit log
- Maximum 100 workers per payment batch

> **Important:** The current payment provider is a safe mock provider. It does not move real money.

## Run locally
1. Install Node.js 18+.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Run `npm start`.
5. Open `http://localhost:3000`.

Admin credentials are configured through the `ADMIN_EMAIL` and `ADMIN_PASSWORD` environment variables. Do not commit real credentials to the repository. For an existing deployment, update both variables in the hosting provider and restart the application.
