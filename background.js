// Background script for IPeed
chrome.runtime.onInstalled.addListener(() => {
  // Create context menu
  chrome.contextMenus.create({
    id: "checkIpLocation",
    title: "Check IP Location",
    contexts: ["selection"]
  });
});


// Handle context menu click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "checkIpLocation") {
    // Check if the tab can receive messages
    if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://') && !tab.url.startsWith('edge://') && !tab.url.startsWith('moz-extension://')) {
      const selectedText = info.selectionText.trim();
      if (selectedText) {
        processIP(selectedText, tab.id);
      }
    }
  }
});


// Process IP address
function processIP(text, tabId) {
  const ip = extractAndValidateIP(text);
  
  if (ip) {
    // Fetch IP location data and open popup
    fetchIPLocation(ip, tabId, true);
  } else {
    // Store error and open popup
    chrome.storage.local.set({
      lastError: `No valid IP address found in: ${text}`
    });
    openPopup();
  }
}

// Extract and strictly validate IP from text
function extractAndValidateIP(text) {
  // First extract potential IPs
  const ipRegex = /(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)/g;
  const matches = text.match(ipRegex);
  
  if (!matches) return null;
  
  // Validate each match strictly
  for (const match of matches) {
    if (isValidIP(match)) {
      return match;
    }
  }
  
  return null;
}

// Strict IP validation - only allows valid IPv4 addresses
function isValidIP(ip) {
  // Must match exact IPv4 format
  const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  
  if (!ipRegex.test(ip)) {
    return false;
  }
  
  // Additional validation: split and check each octet
  const parts = ip.split('.');
  
  // Must have exactly 4 parts
  if (parts.length !== 4) {
    return false;
  }
  
  // Each part must be a valid number 0-255
  for (const part of parts) {
    const num = parseInt(part, 10);
    
    // Check for leading zeros (except for "0" itself)
    if (part.length > 1 && part[0] === '0') {
      return false;
    }
    
    // Check range
    if (isNaN(num) || num < 0 || num > 255) {
      return false;
    }
    
    // Ensure the string representation matches the number
    if (part !== num.toString()) {
      return false;
    }
  }
  
  return true;
}

// Open popup window
function openPopup() {
  chrome.action.openPopup().catch(() => {
    // Fallback: popup opening failed
  });
}

// Get flag emoji for country code
function getFlagEmoji(countryCode) {
  try {
    if (!countryCode || typeof countryCode !== 'string' || countryCode.length !== 2) {
      return '';
    }
    
    const upperCode = countryCode.toUpperCase();
    const codePoints = [];
    
    for (let i = 0; i < upperCode.length; i++) {
      const char = upperCode[i];
      const charCode = char.charCodeAt(0);
      
      if (charCode < 65 || charCode > 90) {
        return '';
      }
      
      codePoints.push(127397 + charCode);
    }
    
    return String.fromCodePoint(...codePoints);
  } catch (error) {
    console.warn('IPeed: Error generating flag emoji for country code:', countryCode, error.message);
    return '';
  }
}

// API configurations for different providers
const API_PROVIDERS = [
  {
    name: 'ipinfo.io',
    url: (ip) => `https://ipinfo.io/${ip}/json`,
    transform: (data) => {
      const [lat, lon] = (data.loc || ',').split(',');
      return {
        ip: data.ip,
        country_name: data.country,
        country_code: data.country,
        region: data.region,
        city: data.city,
        latitude: lat ? parseFloat(lat) : null,
        longitude: lon ? parseFloat(lon) : null,
        timezone: data.timezone,
        org: data.org,
        postal: data.postal,
        provider: 'ipinfo.io'
      };
    },
    validate: (data) => !data.error && data.ip
  },
  {
    name: 'ipapi.co',
    url: (ip) => `https://ipapi.co/${ip}/json/`,
    transform: (data) => ({
      ip: data.ip,
      country_name: data.country_name,
      country_code: data.country_code,
      region: data.region,
      city: data.city,
      latitude: data.latitude,
      longitude: data.longitude,
      timezone: data.timezone,
      org: data.org,
      as: data.asn,
      asname: data.org,
      postal: data.postal,
      currency: data.currency,
      languages: data.languages,
      provider: 'ipapi.co'
    }),
    validate: (data) => !data.error && data.ip
  },
  {
    name: 'ip-api.com',
    url: (ip) => `https://ip-api.com/json/${ip}?fields=status,message,country,countryCode,region,regionName,city,lat,lon,timezone,isp,org,as,asname,zip,mobile,proxy,hosting,query`,
    transform: (data) => ({
      ip: data.query,
      country_name: data.country,
      country_code: data.countryCode,
      region: data.regionName,
      city: data.city,
      latitude: data.lat,
      longitude: data.lon,
      timezone: data.timezone,
      org: data.org || data.isp,
      as: data.as,
      asname: data.asname,
      zip: data.zip,
      mobile: data.mobile,
      proxy: data.proxy,
      hosting: data.hosting,
      provider: 'ip-api.com'
    }),
    validate: (data) => data.status === 'success' && data.query
  }
];

// Get next API provider using round-robin rotation
let currentProviderIndex = 0;
function getNextProvider() {
  const provider = API_PROVIDERS[currentProviderIndex];
  currentProviderIndex = (currentProviderIndex + 1) % API_PROVIDERS.length;
  return provider;
}

// Get shuffled providers for fallback
function getShuffledProviders() {
  return [...API_PROVIDERS].sort(() => Math.random() - 0.5);
}

// Fetch from a specific provider
async function fetchFromProvider(provider, ip) {
  const response = await fetch(provider.url(ip));
  
  if (!response.ok) {
    throw new Error(`${provider.name} HTTP error: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  
  if (!provider.validate(data)) {
    throw new Error(`${provider.name} returned invalid data: ${data.error || data.message || data.reason || 'Unknown error'}`);
  }
  
  return provider.transform(data);
}

// Fetch IP location data with API rotation and fallback
async function fetchIPLocation(ip, tabId, openPopupAfter = false) {
  // Final validation before API call
  if (!isValidIP(ip)) {
    const errorMsg = "Invalid IP address format";
    chrome.storage.local.set({
      lastError: errorMsg
    });
    if (openPopupAfter) {
      openPopup();
    }
    return;
  }
  
  try {
    // Check cache first
    const cacheKey = `ip_cache_${ip}`;
    const cached = await chrome.storage.local.get(cacheKey);
    
    if (cached[cacheKey] && Date.now() - cached[cacheKey].timestamp < 86400000) { // 24 hour cache
      if (openPopupAfter) {
        openPopup();
      }
      return;
    }
    
    // Use round-robin for primary attempt, then fallback to shuffled order
    const primaryProvider = getNextProvider();
    let lastError;
    
    // First try the round-robin selected provider
    try {
      const data = await fetchFromProvider(primaryProvider, ip);
      
      // Validate that the API returned data for the same IP we requested
      if (data.ip !== ip) {
        throw new Error(`${primaryProvider.name} returned data for different IP`);
      }
      
      // Cache the result
      chrome.storage.local.set({
        [cacheKey]: {
          data: data,
          timestamp: Date.now()
        }
      });
      
      // Open popup to show results
      if (openPopupAfter) {
        openPopup();
      }
      
      // Store in chrome storage for popup
      chrome.storage.local.set({
        lastIP: ip,
        lastData: data
      });
      
      return; // Success, exit the function
      
    } catch (error) {
      lastError = error;
    }
    
    // If primary provider failed, try others in random order
    const fallbackProviders = getShuffledProviders().filter(p => p.name !== primaryProvider.name);
    
    for (const provider of fallbackProviders) {
      try {
        const data = await fetchFromProvider(provider, ip);
        
        // Validate that the API returned data for the same IP we requested
        if (data.ip !== ip) {
          throw new Error(`${provider.name} returned data for different IP`);
        }
        
        // Cache the result
        chrome.storage.local.set({
          [cacheKey]: {
            data: data,
            timestamp: Date.now()
          }
        });
        
        // Open popup to show results
        if (openPopupAfter) {
          openPopup();
        }
        
        // Store in chrome storage for popup
        chrome.storage.local.set({
          lastIP: ip,
          lastData: data
        });
        
        return; // Success, exit the function
        
      } catch (error) {
        lastError = error;
        continue; // Try next provider
      }
    }
    
    // If we get here, all providers failed
    throw new Error(`All API providers failed. Last error: ${lastError?.message || 'Unknown error'}`);
    
  } catch (error) {
    // Store error and open popup
    chrome.storage.local.set({
      lastError: error.message
    });
    if (openPopupAfter) {
      openPopup();
    }
  }
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "checkIP") {
    // Validate IP before processing
    const validatedIP = extractAndValidateIP(request.ip);
    if (validatedIP) {
      processIP(validatedIP, sender.tab.id);
    } else {
      chrome.tabs.sendMessage(sender.tab.id, {
        action: "showError",
        message: "Invalid IP address format"
      }).catch(error => {
        console.log('Content script not available for validation error:', error.message);
      });
    }
  }
});
