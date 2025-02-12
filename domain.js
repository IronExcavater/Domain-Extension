const parser = new DOMParser();

const chromeStorageKeys = ['excludeKeys', 'strataMax', 'preferences', 'otherPreference'];

const strataRegex = /(?<=strata.*)(\d+(?:,\d{3})*(?:\.\d{1,2})?)/i;
const strataMaxValue = 1000;
const preferencesMap = new Map([
    ['Gym', 'gym|fitness.{0,10}center|exercise'],
    ['Pool', 'pool|swimming|jacuzzi|hot.{0,10}tub'],
    ['Spa', 'spa|sauna|steam.{0,10}room'],
    ['Dishwasher', 'dishwasher'],
    ['Dryer', 'dryer'],
    ['Glazed Windows', 'double.{0,10}glazed|glazed.{0,10}window|soundproof'],
    ['Electric Stove', '(electric|induction){0,10}{stove|cooktop}']
]);
const preferredAllColor = '#e7c94f';
const preferredSomeColor = '#a6d035';

const isHome = window.location.href === 'https://www.domain.com.au/';
let isStudioType;

let listingCoords = {}
let listings;

const listObserver = new MutationObserver(async (mutations) => {
    for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            await parseListings(Array.from(mutation.addedNodes)
                .filter(marker => marker.nodeType === Node.ELEMENT_NODE));
        }
    }
});

let markers;

let parseMarkersTimer;
let markerChange = new Set();
const mapObserver = new MutationObserver(async (mutations) => {
    for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            Array.from(mutation.addedNodes)
                .filter(marker => marker.nodeType === Node.ELEMENT_NODE)
                .forEach(marker => markerChange.add(marker));

            await scheduleParseMarkers();
        }
    }
});

console.log('Domain extension loaded');

(async () => {
    await injectDoc();
})();

async function injectDoc() {
    if (!isHome) { // *://www.domain.com.au/sale
        await injectBase();
        await injectSearch();
    } else { // *://www.domain.com.au
        const filterButton = document.querySelector('button[data-testid*="search-filters-button"]')
        filterButton.addEventListener('click', () => {
            const observer = new MutationObserver(() => {
                const filters = document.querySelectorAll('[data-testid*="dynamic-search-filters"]');
                if (filters.length > 0) {
                    injectBase();
                    observer.disconnect();
                }
            })
            observer.observe(document.body, { childList: true, subtree: true });
        })
    }
}

async function injectBase() {
    //await loadFiltersFromURL();

    const keywordDiv = document.querySelector('[data-testid="dynamic-search-filters__keywords"]');
    const includeH3 = keywordDiv.children[0];

    const excludeH3 = includeH3.cloneNode(true);
    const excludeInput = keywordDiv.children[1].cloneNode(true).children[0];

    // Modify include and exclude keyword filters
    includeH3.textContent = 'Include Keywords';
    excludeH3.textContent = 'Exclude Keywords';
    excludeInput.name = 'exclude';
    excludeInput.placeholder = 'e.g. studios >w<';

    keywordDiv.append(excludeH3, excludeInput);

    chrome.storage.local.get('excludeKeys', (data) => excludeInput.value = data.excludeKeys ?? '')
    excludeInput.addEventListener('input', async (event) => {
        await chrome.storage.local.set({ excludeKeys: event.target.value });
        //await saveFiltersToURL();
    })
    chrome.storage.local.onChanged.addListener(({ exclude }) => {
        if (exclude) excludeInput.value = exclude.newValue ?? '';
    })

    // Modify price and strata slider filters
    const priceDivs = document.querySelectorAll('[data-testid="dynamic-search-filters__price-range"]');
    for (const priceDiv of priceDivs) {
        const priceH3 = priceDiv.children[0];
        priceH3.textContent = 'Price (Weekly)'

        const strataDiv = priceDiv.cloneNode(true);
        const strataH3 = strataDiv.children[0];
        strataH3.textContent = 'Strata Fees (Quarterly)'
        configureStrataSlider(strataDiv);
        priceDiv.after(strataDiv);
    }

    // Modify features and preferences checkbox filters
    const featureDiv = document.querySelector('[data-testid="dynamic-search-filters__feature-options"]');
    const featureH3 = featureDiv.children[0];
    featureH3.textContent = 'Must-Haves'

    const preferenceDiv = featureDiv.cloneNode(true);
    const preferenceH3 = preferenceDiv.children[0];
    preferenceH3.textContent = 'Could-Haves'

    const prefabCheckbox = preferenceDiv.children[1];
    for (let i = preferenceDiv.children.length - 1; i > 0; i--) {
        preferenceDiv.removeChild(preferenceDiv.children[i]);
    }

    for (const [name, regex] of preferencesMap) {
        createPreferenceCheckbox(preferenceDiv, prefabCheckbox, name, regex);
    }

    const otherPreferenceInput = excludeInput.cloneNode(true);
    otherPreferenceInput.name = 'other_preference';
    otherPreferenceInput.placeholder = 'Other preferences';
    preferenceDiv.append(otherPreferenceInput);

    chrome.storage.local.get('otherPreference', (data) => otherPreferenceInput.value = data.otherPreference ?? '')
    otherPreferenceInput.addEventListener('input', async (event) => {
        await chrome.storage.local.set({ otherPreference: event.target.value });
        //await saveFiltersToURL();
    })
    chrome.storage.local.onChanged.addListener(({ otherPreference }) => {
        if (otherPreference) otherPreferenceInput.value = otherPreference.newValue ?? '';
    })

    const clearButtons = document.querySelectorAll('button[aria-label="Clear all filter selections"]');
    for (const button of clearButtons) {
        button.addEventListener('click', async (event) => {
            await chrome.storage.local.set({
                preferences: [],
                strataMax: strataMaxValue,
                otherPreference: '',
                excludeKeys: ''
            });
            console.log('All filters cleared');
        });
    }

    featureDiv.after(preferenceDiv);
}

async function injectSearch() {
    const documentObserver = new MutationObserver(async () => {
        await observeDocument();
        //await saveFiltersToURL();
    });
    documentObserver.observe(document.body, { childList: true, subtree: true });

    const submitButtons = [
            ...document.querySelectorAll('button[type="submit"]'),
        document.querySelector('button[type="button"][aria-label="perform search"]')
    ];
    for (const submitButton of submitButtons) {
        submitButton.addEventListener('click', async () => {
            if (listings) await parseListings(listings.children);
            if (markers) await parseMarkers(markers.children);
        });
    }

    const allTypeInput = document.querySelector('input[type="checkbox"][name="All"]');
    const apartmentInput = document.querySelector('input[type="checkbox"][name="apartment"]');
    const studioInput = document.querySelector('input[type="checkbox"][name="apartment"][value="studio"]');
    if (allTypeInput) allTypeInput.addEventListener('input', () => handleTypeInput(allTypeInput, studioInput));
    apartmentInput.addEventListener('input', () => handleTypeInput(allTypeInput, studioInput));
    studioInput.addEventListener('input', () => handleTypeInput(allTypeInput, studioInput));
    handleTypeInput(allTypeInput, studioInput);
}

async function observeDocument() {
    const hasListings = document.querySelector('[data-testid="results"]');
    const hasMarkers = document.querySelector('[data-testid="single-marker"]')?.parentElement?.parentElement;

    if (!document.contains(listings)) {
        listings = null;
        listObserver.disconnect();
        if (hasListings) {
            listings = hasListings;
            console.log('List found', listings.children.length, 'listings');
            await parseListings(listings.children);
            listObserver.observe(listings, {childList: true, subtree: false});
        } else {
            console.log('No list found');
        }
    }
    if (!document.contains(markers)) {
        markers = null;
        mapObserver.disconnect();
        if (hasMarkers) {
            markers = hasMarkers;
            console.log('Map found with', markers.children.length, 'markers');
            await parseMarkers(markers.children);
            mapObserver.observe(markers, {childList: true, subtree: false});
        } else {
            console.log('No map found');
        }
    }
}

async function loadFiltersFromURL() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const excludeKeys = urlParams.get('exclude') ?? '';
        const strataMax = urlParams.get('stratamax') ? parseInt(urlParams.get('stratamax')) : strataMaxValue;
        const preferences = urlParams.get('preferences') ? urlParams.get('preferences').split(',') : [];

        await chrome.storage.local.set({excludeKeys, strataMax, preferences});
    } catch (e) {
        console.error('Error loading filters from url', e);
    }
}

async function saveFiltersToURL() {
    try {
        const url = new URL(window.location.href);
        const params = url.searchParams;

        const data = await getDataWithRetry(chromeStorageKeys)

        if (data.excludeKeys !== '') params.set('exclude', data.excludeKeys);
        else params.delete('exclude');

        if (data.strataMax !== strataMaxValue) params.set('stratamax', data.strataMax);
        else params.delete('stratamax');

        if (data.preferences && data.preferences.length > 0) params.set('preferences', data.preferences);
        else params.delete('preferences');

        window.history.pushState({}, '', url.toString());
    } catch (e) {
        console.error('Error saving filters to url', e);
    }
}

async function getDataWithRetry(keys, retries = 5, delay = 1000) {
    try {
        return await chrome.storage.local.get(keys);
    } catch (e) {
        if (retries <= 0) {
            throw new Error('Extension context invalidated after multiple retries.');
        } else {
            console.error(`Attempt accessing storage failed, retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return await getDataWithRetry(keys, retries - 1, delay);
        }
    }
}

function configureStrataSlider(sliderWrapper) {
    const sliderLabel = sliderWrapper.children[1];
    const sliderContainer = sliderWrapper.children[2];
    sliderContainer.style.marginLeft = '5px';
    const rheostatContainer = sliderContainer.querySelector('[class*="rheostat"]');
    const handleContainer = sliderContainer.querySelector('[class*="handleContainer"]');

    const background = rheostatContainer.children[0];
    background.style.marginLeft = '0px'
    const foreground = rheostatContainer.children[2];

    const handles = sliderContainer.querySelectorAll('button');
    handles[0].remove();
    const handle = handles[1];

    let isDragging = false;
    let startX = 0;
    let startPercent = 0;

    // Load strataMax values
    chrome.storage.local.get('strataMax', (data) => {
        const strataMax = data.strataMax ?? strataMaxValue;
        sliderShowValue(handle, foreground, sliderLabel, strataMax, strataMaxValue);
    });
    chrome.storage.local.onChanged.addListener(({ strataMax }) => {
        if (strataMax) sliderShowValue(handle, foreground, sliderLabel, strataMax.newValue, strataMaxValue);
    })

    handle.addEventListener('mousedown', (event) => {
        isDragging = true;
        startX = event.clientX;
        startPercent = (handle.offsetLeft / handleContainer.offsetWidth) * 100;
        event.preventDefault();
    })

    document.addEventListener('mousemove', (event) => {
        if (!isDragging) return;

        const deltaX = event.clientX - startX;
        let newPercent = startPercent + (deltaX / handleContainer.offsetWidth) * 100;
        newPercent = Math.max(0, Math.min(100, newPercent));
        handle.style.left = `${newPercent}%`;
        foreground.style.width = `${newPercent}%`;

        let newStrataMax = Math.round(newPercent / 100 * strataMaxValue);
        newStrataMax = Math.round(newStrataMax / 100) * 100;
        sliderLabel.textContent = newStrataMax === 1000 ? 'Any' : `$${newStrataMax}`;
    });

    document.addEventListener('mouseup', async () => {
        if (isDragging) {
            let newStrataMax = Math.round((parseFloat(handle.style.left) / 100) * strataMaxValue);
            newStrataMax = Math.round(newStrataMax / 100) * 100;
            await chrome.storage.local.set({strataMax: newStrataMax});
            //await saveFiltersToURL();
        }
        isDragging = false;
    })
}

function sliderShowValue(handle, foreground, label, value, max) {
    let newPercent = value / max * 100;
    newPercent = Math.max(0, Math.min(100, newPercent));
    handle.style.left = `${newPercent}%`;
    foreground.style.width = `${newPercent}%`;
    label.textContent = value === max ? 'Any' : `$${value}`;
}

function createPreferenceCheckbox(container, prefab, name, regex) {
    const checkbox = prefab.cloneNode(true);
    const checkboxLabel = checkbox.querySelector('div[class*="domain-checkbox__label"]');
    const checkboxInput = checkbox.querySelector('input')

    checkboxLabel.textContent = name;
    container.appendChild(checkbox);

    chrome.storage.local.get('preferences', (data) => {
        checkboxInput.checked = data.preferences.includes(regex)
    })
    checkboxInput.addEventListener('input', () => {
        chrome.storage.local.get('preferences', async (data) => {
            let existingPreferences = data.preferences ?? [];
            if (checkboxInput.checked) {
                if (!existingPreferences.includes(regex)) existingPreferences.push(regex);
            } else {
                existingPreferences = existingPreferences.filter(item => item !== regex);
            }
            await chrome.storage.local.set({preferences: existingPreferences});
            console.log(existingPreferences);
            //await saveFiltersToURL();
        })
    })
    chrome.storage.local.onChanged.addListener(({ preferences }) => {
        if (preferences) checkboxInput.checked = preferences.newValue.includes(regex);
    })
}

function handleTypeInput(allTypeInput, studioInput) {
    isStudioType = (allTypeInput && allTypeInput.checked) || studioInput.checked;
}

async function scheduleParseMarkers() {
    clearTimeout(parseMarkersTimer)

    parseMarkersTimer = setTimeout(async () => {
        if (markerChange.size === 0) return;
        await parseMarkers(markerChange);
        markerChange.clear();
    }, 500);
}

async function parseMarkers(markers) {
    if (markers.length === 0) return;
    console.log('Started parsing', markers.length, 'markers');

    const data = await getDataWithRetry(chromeStorageKeys);
    //if (!hasExtraFilters(data)) return;

    const pageData = JSON.parse(document.querySelector('#__NEXT_DATA__').textContent);
    const listingsMap = pageData.props.pageProps.componentProps.listingsMap;

    listingCoords = [];
    for (const [_, listingData] of Object.entries(listingsMap)) {
        const url = 'https://www.domain.com.au' + listingData.listingModel.url;
        const lat = listingData.listingModel.address.lat;
        const lng = listingData.listingModel.address.lng;
        listingCoords.push({lat, lng, url});
    }

    const mapContainer = document.querySelector('[data-testid="google-map"]');
    const mapWidth = mapContainer.offsetWidth;
    const mapHeight = mapContainer.offsetHeight;

    const url = new URL(document.location.href);
    const params = url.searchParams;

    const northWest = decodeURIComponent(params.get('startloc')).split(',').map(ord => parseFloat(ord)); // Top-left corner of map
    const southEast = decodeURIComponent(params.get('endloc')).split(',').map(ord => parseFloat(ord)); // Bottom-right corner of map

    const markerListings = [];
    for (const marker of markers) {
        const markerCoord = pixelToCoordinates(marker.style.left, marker.style.top, mapWidth, mapHeight, northWest, southEast);
        const nearestListing = findNearestListing(markerCoord);
        if (nearestListing) markerListings.push({ marker, nearestListing });
    }

    const listingPromises = Array.from(markerListings).map(async markerListing => {
        const {marker, nearestListing} = markerListing;
        const content = await parseListing(nearestListing.url);
        const exclude = await excludeListing(data, content);
        marker.style.display = exclude ? 'none' : '';

        const preferred = await preferListing(data, content);
        const preferredColor = preferred === 1 ? preferredAllColor : preferredSomeColor;

        const rects = marker.querySelectorAll('rect');
        for (const rect of rects) {
            if (window.getComputedStyle(rect).fill === 'rgb(124, 124, 123)') continue;
            rect.style.fill = preferred > 0 ? preferredColor : '0B8000';
        }
    });
    await Promise.all(listingPromises);
    console.log('Finished parsing', markers.length, 'markers');
}

function pixelToCoordinates(left, top, mapWidth, mapHeight, northWest, southEast) {
    const pixelX = parseFloat(left);
    const pixelY = parseFloat(top);

    const ratioX = pixelX / mapWidth;
    const ratioY = pixelY / mapHeight;

    const lat = northWest[0] + ratioY * (southEast[0] - northWest[0]);
    const lng = northWest[1] + ratioX * (southEast[1] - northWest[1]);

    return { lat, lng };
}

function findNearestListing(markerCoord) {
    let nearestListing;
    let minDistance = Infinity;

    for (const listingCoord of listingCoords) {
        const distance = Math.sqrt(Math.pow(markerCoord.lat - listingCoord.lat, 2)
            + Math.pow(markerCoord.lng - listingCoord.lng, 2));

        if (distance < minDistance) {
            nearestListing = listingCoord;
            minDistance = distance;
        }
    }

    return nearestListing;
}

async function parseListings(listings) {
    if (listings.length === 0) return;
    console.log('Started parsing', listings.length, 'listings');

    const data = await getDataWithRetry(chromeStorageKeys);
    //if (!hasExtraFilters(data)) return;

    const listingPromises = Array.from(listings).map(async listing => {
        const listingAnchor = listing.querySelector('a');
        if (!listingAnchor) return;

        const content = await parseListing(listingAnchor.href)

        const exclude = await excludeListing(data, content);
        listing.style.display = exclude ? 'none' : '';

        const preferred = await preferListing(data, content);
        const preferredColor = preferred === 1 ? preferredAllColor : preferredSomeColor;

        listing.style.backgroundColor = preferred > 0 ? preferredColor : 'transparent';
        listing.style.padding = '10px';
        listing.style.borderRadius = '10px';
    });
    await Promise.all(listingPromises);
    console.log('Finished parsing', listings.length, 'listings');
}

async function parseListing(listingUrl) {
    try {
        const listingDoc = await fetchListing(listingUrl);

        const [featuresDiv, descriptionDiv] = await Promise.all([
            listingDoc.querySelector('[data-testid="listing-details__additional-features"]'),
            listingDoc.querySelector('[data-testid="listing-details__description"]')
        ])

        const featureContent = featuresDiv
            ? Array.from(featuresDiv.querySelectorAll('li'))
                .map(item => item.textContent.trim())
                .join(', ')
            : '';

        const descriptionContent = descriptionDiv
            ? Array.from(descriptionDiv.querySelectorAll('p, h3'))
                .map(item => item.textContent.trim())
                .join('\n')
            : '';

        return `${featureContent.toLowerCase()}\n${descriptionContent.toLowerCase()}`;
    } catch (e) {
        console.error('Error parsing listing', listingUrl, e);
        return '';
    }
}

async function fetchListing(listingUrl, retries = 3, delay = 1000) {
    try {
        const response = await fetch(listingUrl);
        if (!response.ok) throw new Error('HTTP error, status: ' + response.status);

        const text = await response.text()
        return parser.parseFromString(text, 'text/html');
    } catch (e) {
        if (retries <= 0) {
            throw new Error('Unable to fetch listing after multiple retries.');
        } else {
            console.error(`Attempt fetching listing failed, retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return await fetchListing(listingUrl, retries - 1, delay);
        }
    }
}

async function excludeListing(data, content) {
    const excludeKeywords = (data.excludeKeys ?? '').toLowerCase().split(/\s*,\s*/);
    if (!isStudioType) excludeKeywords.add('studio');

    // Search for excluded keywords
    for (const excludeKey of excludeKeywords) {
        if (excludeKey === '') continue;
        if (content.includes(excludeKey)) return true;
    }

    // Search for strata fees
    if (data.strataMax < 1000) {
        const match = strataRegex.exec(content);
        if (match) {
            const strata = parseFloat(match[0].replace(/,/g, ''));
            if (strata > data.strataMax) return true;
        }
    }

    return false;
}

async function preferListing(data, content) {
    const preferences = data.preferences ?? [];
    preferences.push(data.otherPreference);
    let preferred = 0;
    let allPreferred = preferences.length;

    // Search for preferences
    for (const preference of preferences) {
        if (preference === '') {
            allPreferred--;
            continue;
        }
        if (content.match(preference)) preferred++;
    }

    return preferred / allPreferred;
}

function hasExtraFilters(data) {
    // No filters, then don't parse
    if (data.excludeKeys === '' && data.strataMax === strataMaxValue && data.preferences.length === 0
        && isStudioType === true && data.otherPreference === '') {
        console.log('No extra filters set, stopping parse');
        return false;
    }

    return true;
}