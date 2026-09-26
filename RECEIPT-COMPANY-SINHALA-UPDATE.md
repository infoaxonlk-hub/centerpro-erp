# Company name and Sinhala receipt update

## Changes

- Admins and super admins can set the organization/company name from **Centers & Locations → Company name on bills**.
- Receipts show the saved company name, then the selected center code and center name.
- Sales invoices, purchase bills, and draft previews include an **English / සිංහල** language selector.
- Printed bills use the footer `Software solution by InfoAxon`.
- The company name change is scoped to the signed-in admin's organization and recorded in the audit log.

## Database step

Before deploying this code, apply `supabase/migrations/026_organization_receipt_name.sql` to the same Supabase project connected to this deployment. In Supabase SQL Editor, open the migration file, copy and run its contents. It adds one restricted database function; it does not delete or reset any data.

## Use

1. Sign in as an Admin or Super Admin and open **Centers & Locations**.
2. Enter the business name in **Company name on bills** and save it.
3. When creating a sale or purchase, select the collection center as usual. Its code and name will appear beneath the company name.
4. On the bill preview, choose **සිංහල** before printing to print the receipt labels in Sinhala.
