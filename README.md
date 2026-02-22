This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## ONLYOFFICE Integration (Word-like Editor)

The project now includes API routes for ONLYOFFICE-based document editing:

- `GET /api/word-docs`
- `POST /api/word-docs`
- `PATCH /api/word-docs/:id`
- `DELETE /api/word-docs/:id`
- `GET /api/word-docs/file/:id`
- `POST /api/word-docs/callback/:id`
- `GET /api/word-docs/editor-config/:id`

### Required Environment Variables

- `ONLYOFFICE_SERVER_URL`
  Browser-accessible Document Server URL (example: `http://localhost:8082`)
- `ONLYOFFICE_APP_BASE_URL`
  App URL that ONLYOFFICE can call back to (example in docker-compose: `http://app:3000`)
- `WORD_DOCS_DIR` (optional)
  Storage directory for `.docx` files (default: `public/word-docs`)

### Docker Compose

`docker-compose.yml` includes an `onlyoffice` service on port `8082` with JWT disabled for local/internal usage.
