# Kamu İlan: Graduation-Filtered Job Listings

An Express and MongoDB job-listing application that serves a web frontend and provides endpoints for searching and viewing job listings, including graduation-related filters.

## Requirements

- Node.js and npm
- MongoDB (the Docker Compose configuration uses MongoDB 7)

## Setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and configure `MONGODB_URI`, `PORT`, and, if needed, `PUBLIC_BASE_URL`.
3. Start the server with `npm start`.

Run the test suite with `npm test`.

## API

- `GET /api/health` — health check
- `GET /api/jobs/mezuniyetler` — available graduation filters
- `GET /api/jobs` — search and list jobs
- `GET /api/jobs/:jobId` — retrieve a job

The public frontend is served by the Express application. The repository also includes a Dockerfile and a development Compose configuration.