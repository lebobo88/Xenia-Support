---
doc_id: csv-export-troubleshooting
title: "CSV Export Troubleshooting"
as_of: "2026-04-10"
topic_class: active
owner: kb-team
---

## Overview

This article covers common issues encountered when exporting data from Lumenboard as CSV files, including error messages, size limits, and scheduled export failures.

## Error 502 on Large Exports

**Symptom**: The export button triggers a 502 Bad Gateway error, typically when the result set exceeds approximately 50,000 rows.

**Cause**: Large exports are processed asynchronously by Lumenboard's export worker fleet. A 502 during a large export usually indicates one of three conditions:
1. The export worker timed out before generating the file (most common for queries spanning multiple data sources or applying complex aggregations).
2. A transient networking issue between the web frontend and the export service.
3. The export service is temporarily overloaded.

**Resolution steps**:

1. **Reduce the result set**: Apply additional filters to reduce the number of rows before exporting. Exports under 10,000 rows are processed synchronously and do not encounter this issue.
2. **Use scheduled export**: For large recurring exports, configure a scheduled export (Pro and Team plans). Scheduled exports run server-side during off-peak hours and deliver the file via email or webhook, avoiding the browser timeout window.
3. **Split the export**: If you need the full dataset, export date ranges in segments (e.g., export month by month).
4. **Retry after 5 minutes**: Transient 502s from service overload typically self-resolve within 5 minutes.

If the 502 persists after trying the above, contact support with your account ID and the dashboard/query URL.

## Row Limit Errors

**Symptom**: An error banner reads "Export exceeds plan row limit."

**Cause**: Free plan exports are capped at 500 rows. Pro plan exports are capped at 100,000 rows. Team plan has no row limit.

**Resolution**: Either filter the query to reduce the row count, or upgrade to a higher plan.

## Scheduled Export Not Delivering

**Symptom**: A scheduled export is configured but the file never arrives in the destination inbox or webhook.

**Checklist**:

1. Verify the destination email or webhook URL is correct under **Settings → Scheduled Exports**.
2. Check spam/junk folders for delivery emails.
3. For webhook destinations, confirm the endpoint returns a 2xx status code within 10 seconds; otherwise Lumenboard marks the delivery as failed and retries up to 3 times.
4. Review the export run log under **Settings → Scheduled Exports → Run History** for error details.
5. Ensure the API key or OAuth token attached to the export still has valid permissions on the underlying data source.

## Empty CSV Downloads

**Symptom**: The export completes but the downloaded file is empty or contains only the header row.

**Cause**: The query returned no data for the selected time range or filters, or the export worker captured a moment between a data pipeline refresh when the table was temporarily empty.

**Resolution**: Run the underlying query directly in the dashboard to confirm data is present. If data is visible in the dashboard but the export is empty, contact support — this may indicate an export worker caching issue.

## Encoding Issues in CSV

**Symptom**: Characters appear garbled when opening the CSV in Excel.

**Cause**: Lumenboard exports CSV files in UTF-8 encoding. Excel on Windows defaults to the system locale encoding (often Windows-1252).

**Resolution**: When opening in Excel, use **Data → From Text/CSV** and select UTF-8 as the file encoding rather than double-clicking the file.

## Contact Support

If you continue to experience export issues after following the steps above, contact support at support@lumenboard.io with:
- Your account email
- The dashboard URL
- A screenshot of the error
- The approximate number of rows in the export
