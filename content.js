// Gmail Draft Creator - SIMPLE FILL MODE
console.log('🔥 SIMPLE FILL MODE: Gmail Draft Creator loaded');

// Load saved data on startup
loadSavedData();

// Ensure we're always ready to receive messages
console.log('🔥 Content script loaded and ready');

// Listen for messages from popup (top frame only)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
    // Ignore messages in subframes
    if (window.top !== window.self) {
        return;
    }

    if (request.action === 'ping') {
        sendResponse({ ok: true });
        return;
    }
    
    if (request.action === 'createDrafts') {
        // Store the data and reset index
        saveDataToStorage(request.data, 0, request.csvData, request.templates);
        console.log(`🔥 SIMPLE FILL: Ready to fill ${request.data.length} drafts`);
        
        // Fill the first row immediately
        fillCurrentCompose();
        
        sendResponse({ success: true, message: `Ready to fill ${request.data.length} drafts. Click the button for each draft.` });
        return;
    }
    
    if (request.action === 'fillNext') {
        fillCurrentCompose();
        sendResponse({ success: true, message: 'Filled current compose window' });
        return;
    }
    
    if (request.action === 'getStatus') {
        const status = getCurrentStatus();
        sendResponse({ success: true, status: status });
        return;
    }
    
    if (request.action === 'getSavedData') {
        loadSavedData().then((savedData) => {
            sendResponse({ success: true, data: savedData });
        });
        return true; // Keep the message channel open for async response
    }
    } catch (error) {
        console.error('Message handling error:', error);
        sendResponse({ success: false, error: error.message });
        return;
    }
});

async function loadSavedData() {
    try {
        const result = await chrome.storage.local.get(['emailData', 'currentRowIndex', 'csvData', 'templates']);
        if (result.emailData && result.currentRowIndex !== undefined) {
            window.emailData = result.emailData;
            window.currentRowIndex = result.currentRowIndex;
            console.log(`🔥 RESTORED: Row ${currentRowIndex + 1}/${emailData.length} from storage`);
        }
        
        // Return CSV data and templates for popup to use
        return {
            csvData: result.csvData || null,
            templates: result.templates || null,
            hasSession: result.emailData && result.currentRowIndex !== undefined
        };
    } catch (error) {
        console.log('No saved data found');
        return { csvData: null, templates: null, hasSession: false };
    }
}

async function saveDataToStorage(emailData, index, csvData = null, templates = null) {
    try {
        const dataToSave = {
            emailData: emailData,
            currentRowIndex: index
        };
        
        // Save CSV data and templates if provided
        if (csvData) {
            dataToSave.csvData = csvData;
            console.log(`🔥 SAVING CSV: ${csvData.length} rows`);
        }
        if (templates) {
            dataToSave.templates = templates;
            console.log(`🔥 SAVING TEMPLATES: Subject and body`);
        }
        
        await chrome.storage.local.set(dataToSave);
        window.emailData = emailData;
        window.currentRowIndex = index;
        console.log(`🔥 SAVED: ${emailData.length} drafts, starting at row ${index + 1}`);
        
        // Verify what was actually saved
        const verification = await chrome.storage.local.get(['csvData', 'templates']);
        console.log(`🔥 VERIFICATION: CSV rows saved: ${verification.csvData?.length || 0}, Templates saved: ${verification.templates ? 'Yes' : 'No'}`);
        
    } catch (error) {
        console.error('Failed to save data:', error);
        
        // Check if it's a storage quota error
        if (error.message && error.message.includes('quota')) {
            console.error('Storage quota exceeded - CSV data might be too large');
        }
    }
}

async function updateCurrentIndex(index) {
    try {
        await chrome.storage.local.set({ currentRowIndex: index });
        window.currentRowIndex = index;
    } catch (error) {
        console.error('Failed to update index:', error);
    }
}

function getCurrentStatus() {
    if (!window.emailData || window.currentRowIndex === undefined) {
        return { hasData: false };
    }
    
    return {
        hasData: true,
        currentRow: window.currentRowIndex + 1,
        totalRows: window.emailData.length,
        remaining: window.emailData.length - window.currentRowIndex
    };
}

async function fillCurrentCompose() {
    if (!window.emailData || window.currentRowIndex >= window.emailData.length) {
        console.log('✅ ALL DRAFTS COMPLETE: No more rows to fill');
        showNotification('All drafts completed! 🎉');
        // Clear only session progress, keep CSV and templates
        await chrome.storage.local.remove(['emailData', 'currentRowIndex']);
        return;
    }
    
    const currentEmail = window.emailData[window.currentRowIndex];
    console.log(`🔥 FILLING ROW ${window.currentRowIndex + 1}/${window.emailData.length}: ${currentEmail.email}`);
    
    try {
        // Fill recipients first
        await fillRecipients(currentEmail.email);

        // Fill subject
        fillSubject(currentEmail.subject);
        
        // Fill body
        fillBody(currentEmail.body);
        
        // Update the index and save to storage
        const newIndex = window.currentRowIndex + 1;
        await updateCurrentIndex(newIndex);
        
        const remaining = window.emailData.length - newIndex;
        showNotification(`Filled draft ${newIndex}/${window.emailData.length}. ${remaining} remaining.`);
        
        console.log(`✅ FILLED: Row ${newIndex}/${window.emailData.length}`);
        
    } catch (error) {
        console.error('❌ FILL ERROR:', error);
        showNotification(`Error filling draft: ${error.message}`);
    }
}

async function fillRecipients(email) {
    if (!email) {
        throw new Error('No email address provided');
    }

    console.log(`🔥 FILLING EMAIL FIELD: "${email}"`);

    const composeWindow = getActiveComposeWindow();
    if (!composeWindow) {
        throw new Error('Compose window not found');
    }

    const recipientSelectors = [
        'textarea[name="to"]',
        'input[name="to"]',
        'textarea[aria-label="To"]',
        'input[aria-label="To"]',
        'div[aria-label="To"]',
        'div[aria-label^="To "]',
        'div[aria-label*="Add recipients"]',
        'div[role="combobox"][aria-label*="Recipients"]',
        '.oj div[role="textbox"]',
        '.oj div[contenteditable="true"]'
    ];

    let recipientField = null;
    for (const selector of recipientSelectors) {
        recipientField = composeWindow.querySelector(selector);
        if (recipientField) {
            console.log(`🔥 FOUND EMAIL FIELD: ${selector}`);
            break;
        }
    }

    if (!recipientField) {
        throw new Error('Email field not found');
    }

    let editableElement = recipientField;

    if (recipientField.tagName === 'DIV') {
        const nestedEditable = recipientField.querySelector('textarea, input, div[contenteditable="true"]');
        if (nestedEditable) {
            editableElement = nestedEditable;
        }
    }

    console.log('🔥 EMAIL FIELD TYPE:', editableElement.tagName, editableElement.getAttribute('contenteditable'));

    // Clear existing recipient chips if any
    const chips = composeWindow.querySelectorAll('div[role="listitem"][data-hovercard-id]');
    chips.forEach(chip => {
        const removeButton = chip.querySelector('[aria-label*="Remove"], [aria-label*="Delete"], [tabindex][role="button"]');
        if (removeButton) {
            removeButton.click();
        } else {
            chip.remove();
        }
    });

    editableElement.focus();

    if ('value' in editableElement) {
        editableElement.value = '';
        editableElement.dispatchEvent(new Event('input', { bubbles: true }));
        editableElement.value = email;
        editableElement.dispatchEvent(new Event('input', { bubbles: true }));
        editableElement.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (editableElement.getAttribute && editableElement.getAttribute('contenteditable') === 'true') {
        editableElement.innerHTML = '';
        editableElement.textContent = '';
        editableElement.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'deleteContentBackward' }));
        editableElement.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: email }));
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, email);
    } else {
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, email);
    }

    // As a final fallback, type via keyboard events if the field is still empty
    await sleep(50);
    const currentValue = editableElement.value || editableElement.textContent || '';
    if (!currentValue.trim()) {
        console.log('⚠️ Email field still empty, typing via keyboard events');
        await typeWithKeyboard(editableElement, email);
    }

    await sleep(50);

    // Simulate Enter to convert to Gmail chips
    const enterDown = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true });
    const enterUp = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true });
    editableElement.dispatchEvent(enterDown);
    editableElement.dispatchEvent(enterUp);

    editableElement.dispatchEvent(new Event('blur', { bubbles: true }));

    await sleep(150);

    const addedChips = composeWindow.querySelectorAll(`div[role="listitem"][data-hovercard-id*="${email}"]`);
    if (!addedChips || addedChips.length === 0) {
        console.warn('⚠️ Email chip not detected after insertion');
    }

    console.log('✅ EMAIL FIELD FILLED');
}

async function typeWithKeyboard(element, text) {
    element.focus();
    const chars = text.split('');
    for (const char of chars) {
        const keyDown = new KeyboardEvent('keydown', { key: char, bubbles: true });
        const keyPress = new KeyboardEvent('keypress', { key: char, bubbles: true });
        const keyUp = new KeyboardEvent('keyup', { key: char, bubbles: true });
        element.dispatchEvent(keyDown);
        element.dispatchEvent(keyPress);
        element.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }));
        element.dispatchEvent(keyUp);
        await sleep(10);
    }
}

function getActiveComposeWindow() {
    const composeDialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
    for (const dialog of composeDialogs) {
        if (dialog.offsetParent === null) {
            continue; // hidden
        }
        if (dialog.querySelector('textarea[name="to"], div[aria-label="To"], input[name="to"]')) {
            return dialog;
        }
    }
    return null;
}

function fillSubject(subject) {
    console.log(`🔥 FILLING SUBJECT: "${subject}"`);
    
    // Try multiple subject field selectors
    const subjectSelectors = [
        'input[name="subjectbox"]',
        'input[placeholder*="Subject"]',
        'input[aria-label*="Subject"]',
        '.aoT[role="textbox"]',
        'div[aria-label*="Subject"]',
        'input[placeholder*="subject"]',
        'input[aria-label*="subject"]',
        'div[aria-label*="subject"]',
        '.aoT',
        'input[type="text"]'
    ];
    
    let subjectField = null;
    for (const selector of subjectSelectors) {
        subjectField = document.querySelector(selector);
        if (subjectField) {
            console.log(`🔥 FOUND SUBJECT FIELD: ${selector}`);
            break;
        }
    }
    
    if (!subjectField) {
        throw new Error('Subject field not found');
    }
    
    // Clear and fill subject
    subjectField.focus();
    subjectField.value = '';
    subjectField.textContent = '';
    subjectField.innerHTML = '';
    
    // Set the subject
    if (subjectField.tagName === 'INPUT') {
        subjectField.value = subject;
    } else {
        subjectField.textContent = subject;
    }
    
    // Trigger events
    subjectField.dispatchEvent(new Event('input', { bubbles: true }));
    subjectField.dispatchEvent(new Event('change', { bubbles: true }));
    
    console.log('✅ SUBJECT FILLED');
}

function fillBody(body) {
    console.log(`🔥 FILLING BODY...`);
    
    // Try multiple body field selectors
    const bodySelectors = [
        'div[contenteditable="true"][role="textbox"]',
        'div[aria-label*="Message Body"]',
        'div[aria-label*="Compose"]',
        '.Am.Al.editable',
        '[role="textbox"]',
        'div[contenteditable="true"]',
        'div[aria-label*="message"]',
        'div[aria-label*="body"]',
        'div[aria-label*="Message"]',
        '.Am.Al',
        'div[contenteditable]',
        'div[role="textbox"][contenteditable]'
    ];
    
    let bodyField = null;
    for (const selector of bodySelectors) {
        bodyField = document.querySelector(selector);
        if (bodyField) {
            console.log(`🔥 FOUND BODY FIELD: ${selector}`);
            break;
        }
    }
    
    if (!bodyField) {
        throw new Error('Body field not found');
    }
    
    // Clear and fill body
    bodyField.focus();
    
    // Clear existing content
    bodyField.innerHTML = '';
    bodyField.textContent = '';
    
    // Convert line breaks to HTML
    const htmlBody = body.replace(/\n/g, '<br>');
    bodyField.innerHTML = htmlBody;
    
    // Trigger events
    bodyField.dispatchEvent(new Event('input', { bubbles: true }));
    bodyField.dispatchEvent(new Event('change', { bubbles: true }));
    
    console.log('✅ BODY FILLED');
}

function showNotification(message) {
    // Create a simple notification
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #4CAF50;
        color: white;
        padding: 15px 20px;
        border-radius: 5px;
        z-index: 10000;
        font-family: Arial, sans-serif;
        font-size: 14px;
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Remove after 3 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 3000);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}