# Gmail Draft Creator Chrome Extension

A Chrome extension that allows you to create multiple Gmail draft emails from a CSV file containing contact information.

## Features

- Upload CSV files with name, email, and company information
- Customizable email templates with variable substitution
- Preview CSV data before creating drafts
- Automatic draft creation in Gmail
- Beautiful, modern user interface

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the extension folder
5. The extension icon should appear in your Chrome toolbar

## Usage

1. **Navigate to Gmail**: Make sure you're on `mail.google.com`
2. **Click the extension icon** in your Chrome toolbar
3. **Upload a CSV file** with the following columns:
   - `name` - Contact's name
   - `email` - Contact's email address
   - `company` - Company name
4. **Customize your email template** using these variables:
   - `[name]` - Will be replaced with the contact's name
   - `[email]` - Will be replaced with the contact's email
   - `[company]` - Will be replaced with the company name
5. **Click "Create Drafts"** to generate draft emails in Gmail

## CSV Format

Your CSV file should have headers in the first row and look like this:

```csv
name,email,company
John Doe,john@example.com,Acme Corp
Jane Smith,jane@company.com,Tech Solutions
Bob Johnson,bob@startup.io,Innovation Inc
```

## Email Template Variables

- `[name]` - Contact's name
- `[email]` - Contact's email address  
- `[company]` - Company name

## Example Email Template

**Subject:** `Hello [name], regarding [company]`

**Body:**
```
Dear [name],

I hope this email finds you well. I'm reaching out regarding [company] and would like to discuss potential opportunities.

I would appreciate the opportunity to connect with you and learn more about your current initiatives.

Best regards,
[Your Name]
```

## Permissions

This extension requires the following permissions:
- `activeTab` - To interact with the current Gmail tab
- `storage` - To save your email templates
- `https://mail.google.com/*` - To access Gmail functionality

## Troubleshooting

- **Extension not working**: Make sure you're on Gmail (mail.google.com)
- **CSV not loading**: Ensure your CSV has the required columns: name, email, company
- **Drafts not creating**: Check that Gmail is fully loaded and try refreshing the page
- **Template variables not working**: Make sure to use the exact format: `[name]`, `[email]`, `[company]`

## Development

To modify or extend this extension:

1. Make your changes to the source files
2. Go to `chrome://extensions/`
3. Click the refresh icon on the extension card
4. Test your changes

## File Structure

```
├── manifest.json          # Extension configuration
├── popup.html            # Extension popup interface
├── popup.css             # Popup styling
├── popup.js              # Popup functionality
├── content.js            # Gmail interaction script
├── background.js         # Background service worker
├── icon16.png            # 16x16 extension icon
├── icon48.png            # 48x48 extension icon
├── icon128.png           # 128x128 extension icon
└── README.md             # This file
```

## License

This project is open source and available under the MIT License.
