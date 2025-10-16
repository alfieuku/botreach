// Gmail Draft Creator Background Script
console.log('Gmail Draft Creator background script loaded');

// Extension installation/update handler
chrome.runtime.onInstalled.addListener((details) => {
    console.log('Extension installed/updated:', details.reason);
    
    if (details.reason === 'install') {
        // Set default settings
        chrome.storage.local.set({
            templates: {
                subject: 'Hello [name], regarding [company]',
                body: `Dear [name],

I hope this email finds you well. I'm reaching out regarding [company] and would like to discuss potential opportunities.

I would appreciate the opportunity to connect with you and learn more about your current initiatives.

Best regards,
[Your Name]`
            }
        });
    }
});

// Handle messages from content script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Background received message:', request);
    
    switch (request.action) {
        case 'checkGmailTab':
            checkGmailTab(sendResponse);
            return true; // Keep message channel open
            
        case 'getExtensionInfo':
            sendResponse({
                name: 'Gmail Draft Creator',
                version: '1.0',
                description: 'Create Gmail drafts from CSV data'
            });
            break;
            
        default:
            console.log('Unknown action:', request.action);
    }
});

async function checkGmailTab(sendResponse) {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentTab = tabs[0];
        
        const isGmail = currentTab.url && currentTab.url.includes('mail.google.com');
        
        sendResponse({
            success: true,
            isGmail: isGmail,
            url: currentTab.url
        });
    } catch (error) {
        sendResponse({
            success: false,
            error: error.message
        });
    }
}

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
    console.log('Extension icon clicked on tab:', tab.url);
});

// Error handling
chrome.runtime.onStartup.addListener(() => {
    console.log('Extension startup');
});

chrome.runtime.onSuspend.addListener(() => {
    console.log('Extension suspending');
});