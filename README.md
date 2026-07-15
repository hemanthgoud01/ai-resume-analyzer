# AI Resume Analyzer

A lightweight browser-based resume analyzer that scores ATS fit, flags missing keywords, checks for common grammar issues, and suggests improvements.

## Run

1. Set `OPENAI_API_KEY` in your environment if you want AI-generated feedback.
2. Run `npm start`.
3. Open `http://localhost:3000`.

## Notes

- Upload plain-text resumes with the file picker or drag and drop.
- You can also paste resume text directly into the editor.
- PDF and DOCX uploads are parsed in-browser when the helper libraries load successfully.
- You can still paste extracted text manually if a file parser is unavailable.
- If the API key is missing, the app falls back to local heuristic analysis.
