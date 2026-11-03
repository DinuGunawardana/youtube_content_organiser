# YouTube Content Organiser — Sequential Import Update

## What changed
- Imports are processed one URL at a time. The next URL is not requested until the current URL has a result.
- The import panel updates after each URL and shows a progress count.
- Each result is classified as ADDED, SKIPPED – DUPLICATE, SKIPPED – INVALID URL, or SKIPPED – EXTRACTION FAILED.
- Successful videos are written to browser localStorage before they are marked ADDED.
- Import results are saved in browser localStorage and can be exported using **Download results CSV**.
- The results CSV includes URL, category, subcategory, status, reason, video title, and processed time.
- Pasted URLs now use the currently selected category and subcategory.
- The API also processes multi-URL requests sequentially as a safeguard.

## Run the updated project
1. Extract this ZIP into a new folder, or copy its `app` folder over the existing project's `app` folder.
2. Open the project folder in VS Code.
3. Open Terminal in that folder.
4. Run `npm install` if dependencies are not already installed.
5. Run `npm run dev`.
6. Open `http://localhost:3000`.
7. Upload one of the batch CSV files. Watch the Import results panel update after each URL.
8. Select **Download results CSV** to save the result report.

## Important
- The organiser stores the library and import report in this browser's localStorage. It is not cloud storage.
- Keep the same browser and localhost origin (for example, `http://localhost:3000`) to continue using the same saved library.
- If you clear browser site data, the locally stored library and import report may be lost. Export the library CSV and import-results CSV as backups.
- This update was statically inspected, but a full Next.js build was not run here because the uploaded ZIP did not include `node_modules`. Run `npm install` and `npm run build` locally to perform the full build check.
