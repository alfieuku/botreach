// Global variables
let csvData = [];
let currentTab = null;

// DOM elements
const csvFileInput = document.getElementById('csvFile');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const previewSection = document.getElementById('previewSection');
const previewTable = document.getElementById('previewTable');
const previewHeader = document.getElementById('previewHeader');
const previewBody = document.getElementById('previewBody');
const subjectTemplate = document.getElementById('subjectTemplate');
const bodyTemplate = document.getElementById('bodyTemplate');
const createDraftsButton = document.getElementById('createDrafts');
const status = document.getElementById('status');

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
    // Get current tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tabs[0];
    
    // Check if we're on Gmail
    if (!currentTab.url.includes('mail.google.com')) {
        showStatus('Please navigate to Gmail first', 'error');
        createDraftsButton.disabled = true;
    }
    
    // Set default templates
    subjectTemplate.value = 'Hello [name], regarding [company]';
    bodyTemplate.value = `Dear [name],

I hope this email finds you well. I'm reaching out regarding [company] and would like to discuss potential opportunities.

I would appreciate the opportunity to connect with you and learn more about your current initiatives.

Best regards,
[Your Name]`;

    // Load saved templates and CSV (if any)
    await loadSavedData();
    await restoreSavedCsv();
    
    // Check if there's an ongoing draft session
    await checkOngoingSession();
});

async function checkOngoingSession() {
    try {
        // Check storage directly - more reliable than content script communication
        const result = await chrome.storage.local.get(['emailData', 'currentRowIndex', 'csvData', 'templates']);
        
        if (result.emailData && result.currentRowIndex !== undefined) {
            const { currentRow, totalRows, remaining } = {
                currentRow: result.currentRowIndex + 1,
                totalRows: result.emailData.length,
                remaining: result.emailData.length - result.currentRowIndex
            };
            
            // Restore CSV data if available
            if (result.csvData && Array.isArray(result.csvData)) {
                csvData = result.csvData;
                showPreview();
                console.log('Restored CSV data:', csvData.length, 'rows');
            }
            
            // Restore templates if available
            if (result.templates) {
                subjectTemplate.value = result.templates.subject || '';
                bodyTemplate.value = result.templates.body || '';
                console.log('Restored templates');
            }
            
            showStatus(`Continuing draft session: ${currentRow}/${totalRows} (${remaining} remaining)`, 'info');
            createDraftsButton.textContent = 'Fill Next Draft';
            createDraftsButton.onclick = fillNextDraft;
        }
    } catch (error) {
        console.log('No ongoing session found');
    }
}

// File input change handler
csvFileInput.addEventListener('change', handleFileSelect);

// Create drafts button handler
createDraftsButton.addEventListener('click', createDrafts);

// Template change handlers
subjectTemplate.addEventListener('input', saveTemplates);
bodyTemplate.addEventListener('input', saveTemplates);

async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (!file.name.toLowerCase().endsWith('.csv')) {
        showStatus('Please select a CSV file', 'error');
        return;
    }
    
    // Show file info
    fileName.textContent = `File: ${file.name}`;
    fileSize.textContent = `Size: ${(file.size / 1024).toFixed(1)} KB`;
    fileInfo.style.display = 'block';
    
    // Read and parse CSV
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            csvData = parseCSV(e.target.result);
            if (csvData.length === 0) {
                showStatus('CSV file is empty', 'error');
                return;
            }
            
            // Validate CSV structure
            const requiredColumns = ['name', 'email', 'company'];
            const headers = Object.keys(csvData[0]);
            const missingColumns = requiredColumns.filter(col => !headers.includes(col.toLowerCase()));
            
            if (missingColumns.length > 0) {
                showStatus(`Missing required columns: ${missingColumns.join(', ')}`, 'error');
                return;
            }
            
            // Show preview
            showPreview();
            createDraftsButton.disabled = false;
            showStatus(`Loaded ${csvData.length} records`, 'success');
            // Persist CSV immediately
            try {
                await chrome.storage.local.set({ csvData });
                console.log('CSV data saved:', csvData.length, 'rows');
            } catch (storageError) {
                console.error('Failed to save CSV data:', storageError);
            }
            
        } catch (error) {
            showStatus('Error parsing CSV file: ' + error.message, 'error');
        }
    };
    reader.readAsText(file);
}

function parseCSV(csvText) {
    const lines = csvText.split('\n').filter(line => line.trim());
    if (lines.length < 2) return [];
    
    // Parse header
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
    
    // Parse data rows
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length === headers.length) {
            const row = {};
            headers.forEach((header, index) => {
                row[header] = values[index].trim().replace(/"/g, '');
            });
            data.push(row);
        }
    }
    
    return data;
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    
    result.push(current);
    return result;
}

function showPreview() {
    if (csvData.length === 0) return;
    
    // Clear previous preview
    previewHeader.innerHTML = '';
    previewBody.innerHTML = '';
    
    // Create header
    const headers = Object.keys(csvData[0]);
    const headerRow = document.createElement('tr');
    headers.forEach(header => {
        const th = document.createElement('th');
        th.textContent = header.charAt(0).toUpperCase() + header.slice(1);
        headerRow.appendChild(th);
    });
    previewHeader.appendChild(headerRow);
    
    // Create data rows (show first 5 rows)
    const rowsToShow = Math.min(5, csvData.length);
    for (let i = 0; i < rowsToShow; i++) {
        const row = document.createElement('tr');
        headers.forEach(header => {
            const td = document.createElement('td');
            td.textContent = csvData[i][header] || '';
            row.appendChild(td);
        });
        previewBody.appendChild(row);
    }
    
    if (csvData.length > 5) {
        const moreRow = document.createElement('tr');
        const moreCell = document.createElement('td');
        moreCell.colSpan = headers.length;
        moreCell.textContent = `... and ${csvData.length - 5} more rows`;
        moreCell.style.fontStyle = 'italic';
        moreCell.style.color = '#666';
        moreRow.appendChild(moreCell);
        previewBody.appendChild(moreRow);
    }
    
    previewSection.style.display = 'block';
}

async function restoreSavedCsv() {
    try {
        const result = await chrome.storage.local.get(['csvData']);
        if (result.csvData && Array.isArray(result.csvData) && result.csvData.length > 0) {
            csvData = result.csvData;
            showPreview();
            createDraftsButton.disabled = false;
            fileInfo.style.display = 'block';
            fileName.textContent = 'File: (restored from memory)';
            fileSize.textContent = `Rows: ${csvData.length}`;
            console.log('Restored CSV from storage:', csvData.length, 'rows');
        }
    } catch (e) {
        // ignore
    }
}

async function createDrafts() {
    if (csvData.length === 0) {
        showStatus('No CSV data loaded', 'error');
        return;
    }
    
    if (!currentTab.url.includes('mail.google.com')) {
        showStatus('Please navigate to Gmail first', 'error');
        return;
    }
    
    const subject = subjectTemplate.value.trim();
    const body = bodyTemplate.value.trim();
    
    if (!subject || !body) {
        showStatus('Please fill in both subject and body templates', 'error');
        return;
    }
    
    // Prepare data for content script
    const emailData = csvData.map(row => ({
        name: row.name || '',
        email: row.email || '',
        company: row.company || '',
        subject: replaceTemplateVariables(subject, row),
        body: replaceTemplateVariables(body, row)
    }));
    
    try {
        // Ensure content script is injected
        await ensureContentScriptInjected(currentTab.id);
        
        // Send data to content script for simple fill mode
        const response = await sendMessageWithTimeout(currentTab.id, {
            action: 'createDrafts',
            data: emailData,
            csvData: csvData,
            templates: {
                subject: subjectTemplate.value,
                body: bodyTemplate.value
            }
        }, 10000);

        if (response && response.success) {
            showStatus(response.message, 'success');
            // Change button text to indicate next step
            createDraftsButton.textContent = 'Fill Next Draft';
            createDraftsButton.onclick = fillNextDraft;
        } else {
            showStatus('Error: ' + (response?.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        showStatus('Failed to communicate with Gmail: ' + error.message, 'error');
    }
}

async function fillNextDraft() {
    try {
        const response = await sendMessageWithTimeout(currentTab.id, {
            action: 'fillNext'
        }, 5000);
        
        if (response && response.success) {
            showStatus(response.message, 'success');
        } else {
            showStatus('Error filling draft: ' + (response?.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        showStatus('Failed to fill draft: ' + error.message, 'error');
    }
}

async function ensureContentScriptInjected(tabId, force = false) {
    return new Promise(async (resolve, reject) => {
        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                files: ['content.js']
            });

            const verify = (attempt = 0) => {
                chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => {
                    if (chrome.runtime.lastError || !response) {
                        if (attempt < 3) {
                            setTimeout(() => verify(attempt + 1), 300);
                        } else {
                            const message = chrome.runtime.lastError?.message || 'Content script did not respond';
                            reject(new Error(`Content script not reachable after multiple attempts: ${message}`));
                        }
                    } else {
                        resolve();
                    }
                });
            };

            verify(0);
        } catch (e) {
            reject(e);
        }
    });
}

function sendMessageWithTimeout(tabId, message, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error('Timeout: no response from Gmail'));
        }, timeout);

        chrome.tabs.sendMessage(tabId, message, (response) => {
            clearTimeout(timer);
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(response);
            }
        });
    });
}

function replaceTemplateVariables(template, data) {
    return template
        .replace(/\[name\]/g, data.name || '')
        .replace(/\[email\]/g, data.email || '')
        .replace(/\[company\]/g, data.company || '');
}

function showStatus(message, type = 'info') {
    status.textContent = message;
    status.className = `status ${type}`;
    status.style.display = 'block';
    
    // Auto-hide success messages after 3 seconds
    if (type === 'success') {
        setTimeout(() => {
            status.style.display = 'none';
        }, 3000);
    }
}

function saveTemplates() {
    const templates = {
        subject: subjectTemplate.value,
        body: bodyTemplate.value
    };
    chrome.storage.local.set({ templates });
}

async function loadSavedData() {
    try {
        const result = await chrome.storage.local.get(['templates']);
        if (result.templates) {
            subjectTemplate.value = result.templates.subject || subjectTemplate.value;
            bodyTemplate.value = result.templates.body || bodyTemplate.value;
            console.log('Restored templates from storage');
        }
    } catch (error) {
        console.error('Failed to load saved templates:', error);
    }
}
