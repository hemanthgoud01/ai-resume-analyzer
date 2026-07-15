# AI Resume Analyzer

A lightweight browser-based resume analyzer that scores ATS fit, flags missing keywords, checks for common grammar issues, and suggests improvements.

## Run

1. Set `OPENAI_API_KEY` in your environment if you want AI-generated feedback.
2. Run `npm start`.
3. Open `http://localhost:3000`.

## Notes

- Upload plain-text resumes with the file picker or drag and drop.
- You can also paste resume text directly into the editor.
- Paste a job description to tailor keyword matching to a real posting.
- PDF and DOCX uploads are parsed in-browser when the helper libraries load successfully.
- You can still paste extracted text manually if a file parser is unavailable.
- If the API key is missing, the app falls back to local heuristic analysis.
- GitHub Actions runs `npm run validate` on pushes and pull requests.

## Deploy

This app is ready for free deployment on Vercel Hobby.

1. Import the GitHub repo into Vercel.
2. Leave the framework as the default auto-detect option.
3. Add `OPENAI_API_KEY` in the project environment variables.
4. Deploy — the free Hobby plan is listed at `$0/mo` and includes serverless functions.

GitHub Pages is still fine for a static-only version, but this app needs an API route for AI analysis, so Vercel is the better free fit.
