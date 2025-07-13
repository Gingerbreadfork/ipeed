// Popup script for IPeed
document.addEventListener('DOMContentLoaded', function() {
  const ipInput = document.getElementById('ipInput');
  const checkButton = document.getElementById('checkButton');
  const tryAnotherButton = document.getElementById('tryAnotherButton');
  const clearCacheButton = document.getElementById('clearCacheButton');
  const resultDiv = document.getElementById('result');
  const resultContent = document.getElementById('resultContent');
  const statsDiv = document.getElementById('stats');
  const additionalInfo = document.getElementById('additionalInfo');
  
  // Load last checked IP data or error
  chrome.storage.local.get(['lastIP', 'lastData', 'lastError'], function(result) {
    if (result.lastError) {
      showError(result.lastError);
      // Clear the error after showing it
      chrome.storage.local.remove('lastError');
    } else if (result.lastIP && result.lastData) {
      ipInput.value = result.lastIP;
      displayResult(result.lastData);
    }
  });
  
  // Check button click handler
  checkButton.addEventListener('click', function() {
    const ip = ipInput.value.trim();
    if (ip) {
      checkIPLocation(ip);
    }
  });
  
  // Enter key handler
  ipInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      const ip = ipInput.value.trim();
      if (ip) {
        checkIPLocation(ip);
      }
    }
  });
  
  // Try another provider button handler
  tryAnotherButton.addEventListener('click', function() {
    const currentIP = ipInput.value.trim();
    if (currentIP) {
      // Force check with next provider by clearing cache for this IP only
      const cacheKey = `ip_cache_${currentIP}`;
      chrome.storage.local.remove(cacheKey, function() {
        checkIPLocation(currentIP, true); // true = force different provider
      });
    }
  });
  
  // Clear cache button handler
  clearCacheButton.addEventListener('click', function() {
    chrome.storage.local.clear(function() {
      clearCacheButton.textContent = 'Cleared!';
      setTimeout(() => {
        clearCacheButton.textContent = 'Clear Cache';
      }, 1000);
    });
  });
  
  // API configurations (same as background script)
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

  // Round-robin provider selection for popup
  let popupProviderIndex = 0;
  function getNextPopupProvider() {
    const provider = API_PROVIDERS[popupProviderIndex];
    popupProviderIndex = (popupProviderIndex + 1) % API_PROVIDERS.length;
    return provider;
  }
  
  function getShuffledPopupProviders() {
    return [...API_PROVIDERS].sort(() => Math.random() - 0.5);
  }

  // Check IP location with API rotation
  async function checkIPLocation(ip, forceDifferentProvider = false) {
    const validIP = extractAndValidateIP(ip);
    
    if (!validIP) {
      showError('Invalid IP address format');
      return;
    }
    
    showLoading();
    
    try {
      // Use round-robin for primary attempt, then fallback
      let primaryProvider;
      
      if (forceDifferentProvider) {
        // Skip to next provider if forcing different provider
        primaryProvider = getNextPopupProvider();
        // Skip one more to ensure we get a different provider
        primaryProvider = getNextPopupProvider();
      } else {
        primaryProvider = getNextPopupProvider();
      }
      
      let lastError;
      
      // First try the round-robin selected provider
      try {
        const data = await fetchFromProvider(primaryProvider, validIP);
        
        // Validate that the API returned data for the same IP we requested
        if (data.ip !== validIP) {
          throw new Error(`${primaryProvider.name} returned data for different IP`);
        }
        
        // Store in chrome storage
        chrome.storage.local.set({
          lastIP: validIP,
          lastData: data
        });
        
        displayResult(data);
        // Show try another provider button
        tryAnotherButton.style.display = 'inline-block';
        return; // Success, exit the function
        
      } catch (error) {
        lastError = error;
      }
      
      // If primary provider failed, try others in random order
      const fallbackProviders = getShuffledPopupProviders().filter(p => p.name !== primaryProvider.name);
      
      for (const provider of fallbackProviders) {
        try {
          const data = await fetchFromProvider(provider, validIP);
          
          // Validate that the API returned data for the same IP we requested
          if (data.ip !== validIP) {
            throw new Error(`${provider.name} returned data for different IP`);
          }
          
          // Store in chrome storage
          chrome.storage.local.set({
            lastIP: validIP,
            lastData: data
          });
          
          displayResult(data);
          // Show try another provider button
          tryAnotherButton.style.display = 'inline-block';
          return; // Success, exit the function
          
        } catch (error) {
          lastError = error;
          continue; // Try next provider
        }
      }
      
      // If we get here, all providers failed
      throw new Error(`All API providers failed. Last error: ${lastError?.message || 'Unknown error'}`);
      
    } catch (error) {
      showError(error.message);
    }
  }
  
  // Extract and strictly validate IP from text
  function extractAndValidateIP(text) {
    // Extract potential IPs using regex
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
  
  // Validate IP address
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
  
  // Show loading state
  function showLoading() {
    checkButton.disabled = true;
    checkButton.textContent = 'Checking...';
    resultDiv.style.display = 'block';
    resultContent.innerHTML = `
      <div class="loading">
        <div class="spinner"></div>
        <div>Looking up location...</div>
      </div>
    `;
  }
  
  // Display result
  function displayResult(data) {
    checkButton.disabled = false;
    checkButton.textContent = 'Check';
    resultDiv.style.display = 'block';
    
    const flagEmoji = data.country_code ? getFlagEmoji(data.country_code) : '';
    
    resultContent.innerHTML = `
      <div class="result-row">
        <span class="result-label">IP Address:</span>
        <span class="result-value">${data.ip}</span>
      </div>
      <div class="result-row">
        <span class="result-label">Country:</span>
        <span class="result-value">${flagEmoji} ${data.country_name || 'Unknown'}</span>
      </div>
      <div class="result-row">
        <span class="result-label">Region:</span>
        <span class="result-value">${data.region || 'Unknown'}</span>
      </div>
      <div class="result-row">
        <span class="result-label">City:</span>
        <span class="result-value">${data.city || 'Unknown'}</span>
      </div>
      <div class="result-row">
        <span class="result-label">ISP:</span>
        <span class="result-value">${data.org || 'Unknown'}</span>
      </div>
      <div class="result-row">
        <span class="result-label">Timezone:</span>
        <span class="result-value">${data.timezone || 'Unknown'}</span>
      </div>
      ${data.latitude && data.longitude ? `
      <div class="result-row">
        <span class="result-label">Coordinates:</span>
        <span class="result-value">${data.latitude}, ${data.longitude}</span>
      </div>` : ''}
    `;
    
    // Check cache status and show additional information
    checkCacheStatusAndDisplay(data);
  }
  
  // Show error
  function showError(message) {
    checkButton.disabled = false;
    checkButton.textContent = 'Check';
    resultDiv.style.display = 'block';
    resultContent.innerHTML = `<div class="error">Error: ${message}</div>`;
    // Hide try another provider button on error
    tryAnotherButton.style.display = 'none';
  }
  
  // Check cache status and display additional information
  function checkCacheStatusAndDisplay(data) {
    const cacheKey = `ip_cache_${data.ip}`;
    
    chrome.storage.local.get(cacheKey, function(result) {
      const additionalItems = [];
      let cacheInfo = '';
      
      // Check if this data came from cache
      if (result[cacheKey] && result[cacheKey].timestamp) {
        const cacheTime = new Date(result[cacheKey].timestamp);
        const now = new Date();
        const ageMs = now - cacheTime;
        const ageSeconds = Math.floor(ageMs / 1000);
        const ageMinutes = Math.floor(ageSeconds / 60);
        const ageHours = Math.floor(ageMinutes / 60);
        const ageDays = Math.floor(ageHours / 24);
        
        let ageText;
        if (ageSeconds < 60) {
          ageText = `${ageSeconds}s ago`;
        } else if (ageMinutes < 60) {
          ageText = `${ageMinutes}m ago`;
        } else if (ageHours < 24) {
          const remainingMinutes = ageMinutes % 60;
          ageText = remainingMinutes > 0 ? `${ageHours}h ${remainingMinutes}m ago` : `${ageHours}h ago`;
        } else {
          const remainingHours = ageHours % 24;
          ageText = remainingHours > 0 ? `${ageDays}d ${remainingHours}h ago` : `${ageDays}d ago`;
        }
        
        cacheInfo = `🗄️ Cached ${ageText}`;
      } else {
        cacheInfo = '🔄 Fresh lookup';
      }
      
      // Add cache info and provider info in a compact format
      const sourceInfo = data.provider ? `${data.provider} • ${cacheInfo}` : cacheInfo;
      
      // Add ISP/ASN info if available
      if (data.as || data.asname) {
        additionalItems.push({
          label: 'ASN',
          value: `${data.as || 'Unknown'} ${data.asname ? '(' + data.asname + ')' : ''}`
        });
      }
      
      // Add postal code if available
      if (data.zip || data.postal) {
        additionalItems.push({
          label: 'Postal Code',
          value: data.zip || data.postal
        });
      }
      
      // Add currency info if available
      if (data.currency) {
        additionalItems.push({
          label: 'Currency',
          value: data.currency
        });
      }
      
      // Add languages if available
      if (data.languages) {
        additionalItems.push({
          label: 'Languages',
          value: data.languages
        });
      }
      
      // Add connection type if available
      if (data.mobile || data.proxy || data.hosting) {
        const connectionTypes = [];
        if (data.mobile) connectionTypes.push('Mobile');
        if (data.proxy) connectionTypes.push('Proxy');
        if (data.hosting) connectionTypes.push('Hosting');
        if (connectionTypes.length > 0) {
          additionalItems.push({
            label: 'Connection',
            value: connectionTypes.join(', ')
          });
        }
      }
      
      // Add threat info if available
      if (data.threat) {
        additionalItems.push({
          label: 'Threat Level',
          value: data.threat
        });
      }
      
      // Always add source info at the end
      additionalItems.push({
        label: 'Source',
        value: sourceInfo,
        isSource: true
      });
      
      if (additionalItems.length > 0) {
        additionalInfo.innerHTML = additionalItems.map(item => `
          <div class="info-item${item.isSource ? ' source-info' : ''}">
            <span class="info-label">${item.label}:</span>
            <span class="info-value">${item.value}</span>
          </div>
        `).join('');
        statsDiv.style.display = 'block';
      } else {
        statsDiv.style.display = 'none';
      }
    });
  }
  
  // Get flag emoji for country code
  function getFlagEmoji(countryCode) {
    try {
      if (!countryCode || countryCode.length !== 2) {
        return '';
      }
      
      const codePoints = countryCode
        .toUpperCase()
        .split('')
        .map(char => {
          const charCode = char.charCodeAt(0);
          if (charCode < 65 || charCode > 90) {
            throw new Error('Invalid country code character');
          }
          return 127397 + charCode;
        });
      
      return String.fromCodePoint(...codePoints);
    } catch (error) {
      console.warn('IPeed: Error generating flag emoji for country code:', countryCode, error.message);
      return '';
    }
  }
});
