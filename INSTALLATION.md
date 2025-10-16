# Installation Guide

## Quick Setup

1. **Create Icon Files** (Required):
   - Open `create_icons.html` in your browser
   - Click "Download Icons" to get the required icon files
   - Save them in the extension folder as `icon16.png`, `icon48.png`, and `icon128.png`

2. **Install the Extension**:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the extension folder containing all the files

3. **Test the Extension**:
   - Go to Gmail (mail.google.com)
   - Click the extension icon in your toolbar
   - Upload a test CSV file

## Sample CSV File

Create a file called `sample.csv` with this content:

```csv
name,email,company
John Doe,john@example.com,Acme Corp
Jane Smith,jane@company.com,Tech Solutions
Bob Johnson,bob@startup.io,Innovation Inc
```

## Example Usage

1. Create a CSV file with your contacts
2. Use a template like:
```
Subject: Hello [name], regarding [company]

Body: Dear [name],
I hope this email finds you well. I'm reaching out regarding [company]...
```

## Troubleshooting

- **"Icons not found" error**: Make sure you've downloaded the icon files from `create_icons.html`
- **Extension not loading**: Check that all files are in the same folder
- **Gmail not responding**: Refresh the Gmail page and try again

## File Checklist

Make sure your extension folder contains:
- ✅ manifest.json
- ✅ popup.html
- ✅ popup.css
- ✅ popup.js
- ✅ content.js
- ✅ background.js
- ✅ icon16.png (download from create_icons.html)
- ✅ icon48.png (download from create_icons.html)
- ✅ icon128.png (download from create_icons.html)
- ✅ README.md
- ✅ create_icons.html
- ✅ INSTALLATION.md
