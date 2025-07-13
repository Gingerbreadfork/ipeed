// Content script for IPeed
(function() {
  'use strict';

  let currentTooltip = null;
  let quickLookupDialog = null;

  // Safe runtime messaging wrapper
  function safeRuntimeSendMessage(message, callback) {
    try {
      if (chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(message, callback);
      } else {
        console.warn('IPeed: Extension context invalidated');
        if (callback) callback(null);
      }
    } catch (error) {
      console.warn('IPeed: Extension context invalidated -', error.message);
      if (callback) callback(null);
    }
  }

  // Listen for messages from background script
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      try {
        switch (request.action) {
          case "ping":
            sendResponse({ready: true});
            break;
          case "checkSelectedIP":
            handleSelectedIP();
            break;
          case "showQuickLookup":
            showQuickLookupDialog();
            break;
          case "instantCheck":
            handleInstantCheck();
            break;
          case "showLoading":
            showLoadingTooltip(request.ip);
            break;
          case "showLocation":
            showLocationTooltip(request.data);
            break;
          case "showError":
            showErrorTooltip(request.message);
            break;
        }
        return true; // Keep the message channel open for async responses
      } catch (error) {
        console.warn('IPeed: Error handling message -', error.message);
        return false;
      }
    });
  }

  // Handle selected IP checking
  function handleSelectedIP() {
    const selectedText = window.getSelection().toString().trim();
    if (selectedText) {
      safeRuntimeSendMessage({
        action: "checkIP",
        ip: selectedText
      });
    } else {
      showErrorTooltip("No text selected");
    }
  }

  // Handle instant check (IP under cursor)
  function handleInstantCheck() {
    const element = document.elementFromPoint(lastMouseX || 0, lastMouseY || 0);
    if (element) {
      const text = element.textContent || element.innerText || "";
      const ip = extractIPFromText(text);
      if (ip) {
        safeRuntimeSendMessage({
          action: "checkIP",
          ip: ip
        });
      } else {
        showErrorTooltip("No IP found under cursor");
      }
    }
  }

  // Extract IP from text
  function extractIPFromText(text) {
    const ipRegex = /(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)/g;
    const matches = text.match(ipRegex);
    
    if (!matches) return null;
    
    // Return first valid IP found
    for (const match of matches) {
      if (isValidIP(match)) {
        return match;
      }
    }
    
    return null;
  }

  // Validate IP address
  function isValidIP(ip) {
    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    
    if (!ipRegex.test(ip)) {
      return false;
    }
    
    const parts = ip.split('.');
    
    if (parts.length !== 4) {
      return false;
    }
    
    for (const part of parts) {
      const num = parseInt(part, 10);
      
      if (part.length > 1 && part[0] === '0') {
        return false;
      }
      
      if (isNaN(num) || num < 0 || num > 255) {
        return false;
      }
      
      if (part !== num.toString()) {
        return false;
      }
    }
    
    return true;
  }

  // Show quick lookup dialog
  function showQuickLookupDialog() {
    if (quickLookupDialog) {
      quickLookupDialog.remove();
    }

    quickLookupDialog = document.createElement('div');
    quickLookupDialog.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      border: 2px solid #007bff;
      border-radius: 8px;
      padding: 20px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-width: 300px;
    `;

    quickLookupDialog.innerHTML = `
      <div style="margin-bottom: 15px; font-weight: bold; color: #333;">IPeed - Quick IP Lookup</div>
      <input type="text" id="quickIpInput" placeholder="Enter IP address" style="
        width: 100%;
        padding: 8px 12px;
        border: 1px solid #ddd;
        border-radius: 4px;
        font-size: 14px;
        margin-bottom: 10px;
        box-sizing: border-box;
      ">
      <div style="display: flex; gap: 10px; justify-content: flex-end;">
        <button id="quickCheckBtn" style="
          padding: 8px 16px;
          background: #007bff;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
        ">Check</button>
        <button id="quickCancelBtn" style="
          padding: 8px 16px;
          background: #6c757d;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
        ">Cancel</button>
      </div>
    `;

    document.body.appendChild(quickLookupDialog);

    const input = quickLookupDialog.querySelector('#quickIpInput');
    const checkBtn = quickLookupDialog.querySelector('#quickCheckBtn');
    const cancelBtn = quickLookupDialog.querySelector('#quickCancelBtn');

    input.focus();

    function handleCheck() {
      const ip = input.value.trim();
      if (ip) {
        quickLookupDialog.remove();
        quickLookupDialog = null;
        safeRuntimeSendMessage({
          action: "checkIP",
          ip: ip
        });
      }
    }

    checkBtn.addEventListener('click', handleCheck);
    cancelBtn.addEventListener('click', () => {
      quickLookupDialog.remove();
      quickLookupDialog = null;
    });

    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleCheck();
      } else if (e.key === 'Escape') {
        quickLookupDialog.remove();
        quickLookupDialog = null;
      }
    });

    // Close on outside click
    document.addEventListener('click', function closeDialog(e) {
      if (!quickLookupDialog.contains(e.target)) {
        quickLookupDialog.remove();
        quickLookupDialog = null;
        document.removeEventListener('click', closeDialog);
      }
    });
  }

  // Show loading tooltip
  function showLoadingTooltip(ip) {
    hideTooltip();
    
    currentTooltip = document.createElement('div');
    currentTooltip.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #007bff;
      color: white;
      padding: 12px 16px;
      border-radius: 6px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      z-index: 10000;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
      display: flex;
      align-items: center;
      gap: 8px;
    `;

    currentTooltip.innerHTML = `
      <div style="
        width: 16px;
        height: 16px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top: 2px solid white;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      "></div>
      <span>Looking up ${ip}...</span>
    `;

    // Add spinner animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);

    document.body.appendChild(currentTooltip);
  }

  // Show location tooltip
  function showLocationTooltip(data) {
    hideTooltip();
    
    const flagEmoji = data.country_code ? getFlagEmoji(data.country_code) : '';
    
    currentTooltip = document.createElement('div');
    currentTooltip.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: white;
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      z-index: 10000;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      max-width: 300px;
      min-width: 250px;
    `;

    currentTooltip.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 12px; color: #007bff;">IPeed - IP Location Info</div>
      <div style="margin-bottom: 8px;"><strong>IP:</strong> ${data.ip}</div>
      <div style="margin-bottom: 8px;"><strong>Country:</strong> ${flagEmoji} ${data.country_name || 'Unknown'}</div>
      <div style="margin-bottom: 8px;"><strong>Region:</strong> ${data.region || 'Unknown'}</div>
      <div style="margin-bottom: 8px;"><strong>City:</strong> ${data.city || 'Unknown'}</div>
      <div style="margin-bottom: 8px;"><strong>ISP:</strong> ${data.org || 'Unknown'}</div>
      <div style="margin-bottom: 8px;"><strong>Timezone:</strong> ${data.timezone || 'Unknown'}</div>
      ${data.latitude && data.longitude ? `<div style="margin-bottom: 8px;"><strong>Coordinates:</strong> ${data.latitude}, ${data.longitude}</div>` : ''}
      ${data.provider ? `<div style="margin-bottom: 8px; opacity: 0.7; font-size: 12px;"><strong>Source:</strong> ${data.provider}</div>` : ''}
      <div style="text-align: center; margin-top: 12px;">
        <button id="closeTooltip" style="
          background: #007bff;
          color: white;
          border: none;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
        ">Close</button>
      </div>
    `;

    document.body.appendChild(currentTooltip);

    // Auto-hide after 10 seconds
    setTimeout(hideTooltip, 10000);

    // Close button
    currentTooltip.querySelector('#closeTooltip').addEventListener('click', hideTooltip);
  }

  // Show error tooltip
  function showErrorTooltip(message) {
    hideTooltip();
    
    currentTooltip = document.createElement('div');
    currentTooltip.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #dc3545;
      color: white;
      padding: 12px 16px;
      border-radius: 6px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      z-index: 10000;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
      max-width: 300px;
    `;

    currentTooltip.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 4px;">Error</div>
      <div>${message}</div>
    `;

    document.body.appendChild(currentTooltip);

    // Auto-hide after 5 seconds
    setTimeout(hideTooltip, 5000);
  }

  // Hide tooltip
  function hideTooltip() {
    if (currentTooltip) {
      currentTooltip.remove();
      currentTooltip = null;
    }
  }

  // Get flag emoji for country code
  function getFlagEmoji(countryCode) {
    try {
      if (!countryCode || typeof countryCode !== 'string' || countryCode.length !== 2) {
        console.warn('IPeed: Invalid country code format:', countryCode);
        return '';
      }
      
      const upperCode = countryCode.toUpperCase();
      const codePoints = [];
      
      for (let i = 0; i < upperCode.length; i++) {
        const char = upperCode[i];
        const charCode = char.charCodeAt(0);
        
        if (charCode < 65 || charCode > 90) {
          console.warn('IPeed: Invalid country code character:', char, 'in', countryCode);
          return '';
        }
        
        codePoints.push(127397 + charCode);
      }
      
      if (codePoints.length !== 2) {
        console.warn('IPeed: Unexpected codePoints length:', codePoints.length, 'for', countryCode);
        return '';
      }
      
      return String.fromCodePoint(...codePoints);
    } catch (error) {
      console.error('IPeed: Error in getFlagEmoji for country code:', countryCode, error);
      return '';
    }
  }

  // Track mouse position for instant check
  let lastMouseX = 0;
  let lastMouseY = 0;

  document.addEventListener('mousemove', (e) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  });

})();