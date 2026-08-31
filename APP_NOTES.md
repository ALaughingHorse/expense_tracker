# Expense Tracker Notes


## User Goals And Feedback

- Build a personal expense tracking and budgeting app to monitor financial health after a recent home purchase.
- Use exported data from Sharkapp as the source for day-to-day expenses.
- Keep financial data local. The app should use local folders and CSV files instead of a remote database.
- Ignore local financial data in git so private expense records are not uploaded to GitHub.
- Support importing raw Sharkapp export files, merging them into one aggregate history file, and deleting processed raw files from `local_data/`.
- Provide a UI where raw CSV files can be dragged into the app for import.
- Allow creation of aggregate spending categories that map multiple granular Sharkapp categories into broader budget categories.
- Allow budgets by year, month, or one-time yearly allocation for either aggregate categories or granular categories.
- Show a pacing chart comparing actual cumulative spend against a linear budget pacing line.
- Allow income entry, with edit and delete support for incorrect income records.
- Show year-over-year cumulative comparison for:
  - current year income
  - previous year income
  - current year spend
  - previous year spend
- If previous-year data is empty, leave those chart series empty.

## Sharkapp Export Findings

- Sample file: `local_data/记账l365_jul31.csv`
- Encoding: `UTF-16LE`
- Delimiter: tab-separated, despite the `.csv` extension.
- Columns:
  - `日期`
  - `收支类型`
  - `类别`
  - `账户`
  - `金额`
  - `备注`
- Date format: Chinese date strings like `2025年08月01日`, normalized by the app to ISO dates like `2025-08-01`.
- Transaction types:
  - `支出` maps to `expense`
  - `收入` maps to `income`
- Initial sample import found 1,156 rows, imported 1,151 canonical transactions, and skipped 5 duplicates.

## App Updates Made

- Created a dependency-free Python web app in `app.py`.
- Created a static frontend under `public/`.
- Added local CSV-backed storage under ignored `app_data/`.
- Added `.gitignore` rules for:
  - `app_data/`
  - raw files under `local_data/*.csv`, `*.tsv`, `*.xlsx`, `*.xls`
  - Python cache files
- Added API endpoints for:
  - loading app state
  - importing Sharkapp file text from drag-and-drop
  - importing and deleting raw files from `local_data/`
  - adding/updating income
  - deleting income
  - saving category mappings
  - saving budgets
- Added UI features:
  - summary metrics for selected year
  - Sharkapp drag-and-drop import
  - local folder import button
  - year-over-year cumulative income/spend chart
  - budget pacing chart
  - aggregate category mapping controls
  - budget creation controls
  - income entry, edit, and delete controls
- Removed `Default yearly budget` from category mappings. Category mappings now only define grouped categories; budgets are created only in the Budgets section.
- Updated chart visuals:
  - Y/Y comparison now defaults to the most recent year found in imported data.
  - Y/Y comparison now has four independent year dropdowns: income A, income B, expense A, and expense B.
  - Each Y/Y dropdown includes a `None` option to hide that individual series.
  - Income B and Expense B now default to `None`; Income A and Expense A default to the latest imported data year.
  - Current-year income is a solid green line.
  - Previous-year income is a dotted green line.
  - Current-year expense is a solid red line.
  - Previous-year expense is a dotted red line.
  - Charts now show hover tooltips with actual dollar values for the nearest point.
  - Y/Y chart tooltip values are now full-year cumulative values carried forward for every x-axis day, not only days with transaction entries.
  - Actual cumulative chart values stop at the latest recorded expense or income date for the selected year/month. Future x-axis dates render as `NULL` in the tooltip instead of carrying forward the latest known value.
  - Added a `Latest data` summary metric showing the latest available transaction date in the local dataset.
  - Added a Y/Y expense-by-category widget. It supports grouped or granular categories, two selectable comparison years, solid/dotted line styling, hover tooltips, and the same latest-data cutoff behavior.
  - Rearranged the dashboard layout: data import and the main Y/Y comparison share the first row; budget pacing and Y/Y expense-by-category share the second row.
  - Added a `One-time yearly` budget period. It applies to a selected category and year, and the pacing chart renders its budget line as a flat full-year allocation instead of a linear pacing line.
  - Added visible labels to budget form fields, including category type, category, period, year, and amount.
  - Changed monthly budgets to recurring monthly amounts. The budget form no longer asks for a month; monthly pacing uses the latest available data month in the selected budget year.
  - Added budget tracking controls for comparison year and, for monthly recurring budgets, comparison month. The selected budget supplies category/type/amount while the controls choose the actual period to chart.
  - Added edit and delete controls for existing category budgets. Editing repopulates the budget form and saving replaces the existing budget row.
  - Made the bottom management panels equal height and made their list/data areas scroll internally, so the income widget no longer grows taller than the neighboring panels.
  - Added edit and delete controls for existing category mappings. Editing repopulates the mapping form and selected granular category chips; deleting removes the mapping from `category_mappings.json`.
  - Updated the income section so all income rows can be edited or deleted, including imported Sharkapp income rows. Edits preserve existing source/account metadata where possible.
  - Removed the in-app assistant/chatbot section and removed OpenAI API calls from the local server.
  - Added RSU vest post-tax income entries to the local transaction database with category `RSU` and note `RSU vest post tax`.

## Current Run Command

```bash
python3 app.py
```

Local URL:

```text
http://127.0.0.1:4177/
```

## Verification Completed

- `python3 -m py_compile app.py`
- Confirmed the local page responds at `/`.
- Confirmed `/api/state` responds with imported app state.
- Confirmed app data and raw local data are ignored by git.

## Known Follow-Ups

- Add transaction table filters by date, category, type, and note.
- Add a table view for transactions with filters by date, category, type, and note.
- Add clearer import review before committing newly imported rows.
- Improve charts with hover details and empty-state messaging.
- Consider backup/export buttons for `app_data/transactions.csv`, mappings, and budgets.
